//! Tag reading and the verified tag write used by the write path (lofty 0.25).
//! Zone: core-foundation. Contract: core/CONTRACT.md.

use crate::error::{Error, Result};
use crate::model::TagSet;
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{AudioFile, FileType, TaggedFile, TaggedFileExt};
use lofty::id3::v2::Id3v2Version;
use lofty::picture::{Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag, TagExt};
use serde::{Deserialize, Serialize};
use std::io::BufReader;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

/// Everything the index keeps from one file's tags and audio properties. Strings are trimmed;
/// a missing field is "".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct TagRead {
  pub title: String,
  pub artist: String,
  pub album: String,
  pub album_artist: String,
  pub genre: String,
  /// The recording date as written (usually a year, sometimes a full date).
  pub year: String,
  pub comment: String,
  pub duration_ms: u64,
  /// Lower-case codec name: aac, alac, mp3, flac, opus, vorbis, wav, ...
  pub codec: String,
  /// Audio bitrate, kbps.
  pub bitrate: Option<u32>,
  pub sample_rate: Option<u32>,
  pub has_art: bool,
  /// blake3 hex of the chosen picture's bytes (front cover, else the first picture).
  pub art_hash: Option<String>,
}

/// A file opened through lofty plus the two facts the generic `TaggedFile` loses.
struct Opened {
  file: TaggedFile,
  codec: String,
  /// The file's ID3v2 tag is version 2.3 (kept as 2.3 on write).
  id3v23: bool,
}

/// Reads tags and properties from the primary tag, else the first tag. Never panics: a lofty
/// panic on a malformed file becomes `Error::Tag`.
pub fn read(abs: &Path) -> Result<TagRead> {
  let opened = open(abs)?;
  guarded(abs, || Ok(extract(&opened)))
}

/// The old host's `read_tags` semantics: any error yields empty fields, never a failure.
pub fn read_lenient(abs: &Path) -> TagRead {
  read(abs).unwrap_or_default()
}

/// The embedded cover: front cover preferred, else the first picture of the first tag that has
/// pictures (the old host's `cover_art`). `None` when the file has no picture.
pub fn cover_art(abs: &Path) -> Result<Option<Vec<u8>>> {
  let opened = open(abs)?;
  Ok(chosen_picture(&opened.file).map(|p| p.data().to_vec()))
}

/// Applies `changes` to the file at `path` (always a temp copy): WriteOptions remove_others(false),
/// respect_read_only(true); keeps ID3v2.3 only if the file already had it; creates the primary tag if
/// missing. `Some("")` removes the field.
///
/// Only the primary tag is written; other tags in the file (an ID3v1 trailer, APE) stay
/// byte-identical, and items outside the `TagSet` (track number, pictures, lyrics, freeform
/// atoms) are carried through untouched. A read-only file is refused (`Error::Refused("read-only:
/// …")`) before anything is opened for writing.
#[cfg_attr(not(test), allow(dead_code))] // ingest::tagwrite (zone core-writepath) is the caller
pub(crate) fn write(path: &Path, changes: &TagSet) -> Result<()> {
  if std::fs::metadata(path)?.permissions().readonly() {
    return Err(Error::Refused(format!("read-only: {}", path.display())));
  }
  let mut opened = open(path)?;
  guarded(path, || {
    let file = &mut opened.file;
    if file.primary_tag().is_none() {
      let kind = file.primary_tag_type();
      file.insert_tag(Tag::new(kind));
    }
    let tag = file
      .primary_tag_mut()
      .ok_or_else(|| Error::Tag(format!("{}: no writable tag", path.display())))?;
    apply(tag, changes);
    let mut options = WriteOptions::new().remove_others(false).respect_read_only(true);
    if opened.id3v23 {
      options = options.use_id3v23(true);
    }
    tag
      .save_to_path(path, options)
      .map_err(|e| Error::Tag(format!("{}: cannot write tags: {e}", path.display())))
  })
}

/// Re-reads `tmp` and checks it against what was intended: duration within 1 s and codec equal to
/// `before`; every field in `changes` now holds its (trimmed) value; every other field equals
/// `before`. Returns the re-read tags.
#[cfg_attr(not(test), allow(dead_code))] // ingest::tagwrite (zone core-writepath) is the caller
pub(crate) fn verify(tmp: &Path, before: &TagRead, changes: &TagSet) -> Result<TagRead> {
  let after = read(tmp)?;
  if after.duration_ms.abs_diff(before.duration_ms) > 1000 {
    return Err(Error::Verify(format!(
      "{}: duration changed from {} ms to {} ms",
      tmp.display(),
      before.duration_ms,
      after.duration_ms
    )));
  }
  if after.codec != before.codec {
    return Err(Error::Verify(format!(
      "{}: codec changed from {} to {}",
      tmp.display(),
      before.codec,
      after.codec
    )));
  }
  for (name, change, was, now) in fields(changes, before, &after) {
    let want = change.map_or(was, |v| v.trim());
    if now != want {
      return Err(Error::Verify(format!(
        "{}: {name} is {now:?}, expected {want:?}",
        tmp.display()
      )));
    }
  }
  Ok(after)
}

/// The full pre-image of a file's editable fields, for the journal (empty fields as `Some("")`,
/// so replaying it also clears what was empty).
pub fn tagset_of(r: &TagRead) -> TagSet {
  TagSet {
    title: Some(r.title.clone()),
    artist: Some(r.artist.clone()),
    album: Some(r.album.clone()),
    album_artist: Some(r.album_artist.clone()),
    genre: Some(r.genre.clone()),
    year: Some(r.year.clone()),
    comment: Some(r.comment.clone()),
  }
}

/// `(name, change, before, after)` for each editable field, in `TagSet` order.
fn fields<'a>(c: &'a TagSet, b: &'a TagRead, a: &'a TagRead) -> [(&'static str, Option<&'a str>, &'a str, &'a str); 7] {
  [
    ("title", c.title.as_deref(), &b.title, &a.title),
    ("artist", c.artist.as_deref(), &b.artist, &a.artist),
    ("album", c.album.as_deref(), &b.album, &a.album),
    (
      "album artist",
      c.album_artist.as_deref(),
      &b.album_artist,
      &a.album_artist,
    ),
    ("genre", c.genre.as_deref(), &b.genre, &a.genre),
    ("year", c.year.as_deref(), &b.year, &a.year),
    ("comment", c.comment.as_deref(), &b.comment, &a.comment),
  ]
}

/// Sets or (for "" after trimming) removes each field present in `changes`; nothing else.
fn apply(tag: &mut Tag, changes: &TagSet) {
  let value = |v: &Option<String>| v.as_deref().map(|s| s.trim().to_string());
  if let Some(v) = value(&changes.title) {
    if v.is_empty() {
      tag.remove_title();
    } else {
      tag.set_title(v);
    }
  }
  if let Some(v) = value(&changes.artist) {
    if v.is_empty() {
      tag.remove_artist();
    } else {
      tag.set_artist(v);
    }
  }
  if let Some(v) = value(&changes.album) {
    if v.is_empty() {
      tag.remove_album();
    } else {
      tag.set_album(v);
    }
  }
  if let Some(v) = value(&changes.genre) {
    if v.is_empty() {
      tag.remove_genre();
    } else {
      tag.set_genre(v);
    }
  }
  if let Some(v) = value(&changes.comment) {
    if v.is_empty() {
      tag.remove_comment();
    } else {
      tag.set_comment(v);
    }
  }
  if let Some(v) = value(&changes.album_artist) {
    tag.remove_key(ItemKey::AlbumArtist);
    if !v.is_empty() {
      tag.insert_text(ItemKey::AlbumArtist, v);
    }
  }
  if let Some(v) = value(&changes.year) {
    // One logical field, two keys in the wild (DATE/©day/TDRC and the rarer YEAR): a write leaves
    // exactly one, so the next read cannot see a stale year.
    tag.remove_key(ItemKey::RecordingDate);
    tag.remove_key(ItemKey::Year);
    if !v.is_empty() {
      tag.insert_text(ItemKey::RecordingDate, v);
    }
  }
}

fn extract(o: &Opened) -> TagRead {
  let f = &o.file;
  let props = f.properties();
  let tag = f.primary_tag().or_else(|| f.first_tag());
  let text = |get: &dyn Fn(&Tag) -> Option<String>| tag.and_then(get).map(|s| s.trim().to_string()).unwrap_or_default();
  let picture = chosen_picture(f);
  TagRead {
    title: text(&|t| t.title().map(|s| s.to_string())),
    artist: text(&|t| t.artist().map(|s| s.to_string())),
    album: text(&|t| t.album().map(|s| s.to_string())),
    album_artist: text(&|t| t.get_string(ItemKey::AlbumArtist).map(str::to_string)),
    genre: text(&|t| t.genre().map(|s| s.to_string())),
    year: text(&|t| {
      t.get_string(ItemKey::RecordingDate)
        .or_else(|| t.get_string(ItemKey::Year))
        .map(str::to_string)
    }),
    comment: text(&|t| t.comment().map(|s| s.to_string())),
    duration_ms: u64::try_from(props.duration().as_millis()).unwrap_or(u64::MAX),
    codec: o.codec.clone(),
    bitrate: props.audio_bitrate(),
    sample_rate: props.sample_rate(),
    has_art: picture.is_some(),
    art_hash: picture.map(|p| blake3::hash(p.data()).to_hex().to_string()),
  }
}

/// Front cover, else the first picture, of the first tag that carries pictures.
fn chosen_picture(f: &TaggedFile) -> Option<&Picture> {
  let pics = f.tags().iter().map(|t| t.pictures()).find(|p| !p.is_empty())?;
  pics
    .iter()
    .find(|p| p.pic_type() == PictureType::CoverFront)
    .or(pics.first())
}

/// Opens `path` through lofty: the file type is guessed from the content (falling back to the
/// extension), and the format-specific reader is used where it knows more than the generic one
/// (the MP4 codec, the ID3v2 version).
fn open(path: &Path) -> Result<Opened> {
  let file = std::fs::File::open(path)?;
  guarded(path, || {
    let err = |e: lofty::error::FileParseError| Error::Tag(format!("{}: {e}", path.display()));
    let options = ParseOptions::new();
    let mut probe = Probe::new(BufReader::new(file)).options(options);
    if let Some(ft) = FileType::from_path(path) {
      probe = probe.set_file_type(ft);
    }
    let probe = probe.guess_file_type()?;
    let Some(ft) = probe.file_type() else {
      return Err(Error::Tag(format!("{}: unknown audio format", path.display())));
    };
    let mut reader = probe.into_inner();
    let opened = match ft {
      FileType::Mp4 => {
        let f = lofty::mp4::Mp4File::read_from(&mut reader, options).map_err(err)?;
        let codec = match f.properties().codec() {
          Some(lofty::mp4::Mp4Codec::AAC) => "aac",
          Some(lofty::mp4::Mp4Codec::ALAC) => "alac",
          Some(lofty::mp4::Mp4Codec::MP3) => "mp3",
          Some(lofty::mp4::Mp4Codec::FLAC) => "flac",
          _ => "mp4",
        };
        Opened {
          file: f.into(),
          codec: codec.into(),
          id3v23: false,
        }
      }
      FileType::Mpeg => {
        let f = lofty::mpeg::MpegFile::read_from(&mut reader, options).map_err(err)?;
        let codec = match f.properties().layer() {
          lofty::mpeg::Layer::Layer1 => "mp1",
          lofty::mpeg::Layer::Layer2 => "mp2",
          _ => "mp3",
        };
        let id3v23 = f.id3v2().is_some_and(|t| t.original_version() == Id3v2Version::V3);
        Opened {
          file: f.into(),
          codec: codec.into(),
          id3v23,
        }
      }
      FileType::Aac => {
        let f = lofty::aac::AacFile::read_from(&mut reader, options).map_err(err)?;
        let id3v23 = f.id3v2().is_some_and(|t| t.original_version() == Id3v2Version::V3);
        Opened {
          file: f.into(),
          codec: "aac".into(),
          id3v23,
        }
      }
      FileType::Wav => {
        let f = lofty::iff::wav::WavFile::read_from(&mut reader, options).map_err(err)?;
        let id3v23 = f.id3v2().is_some_and(|t| t.original_version() == Id3v2Version::V3);
        Opened {
          file: f.into(),
          codec: "wav".into(),
          id3v23,
        }
      }
      FileType::Aiff => {
        let f = lofty::iff::aiff::AiffFile::read_from(&mut reader, options).map_err(err)?;
        let id3v23 = f.id3v2().is_some_and(|t| t.original_version() == Id3v2Version::V3);
        Opened {
          file: f.into(),
          codec: "aiff".into(),
          id3v23,
        }
      }
      other => {
        let file = Probe::with_file_type(reader, other)
          .options(options)
          .read()
          .map_err(err)?;
        Opened {
          file,
          codec: codec_name(other),
          id3v23: false,
        }
      }
    };
    Ok(opened)
  })
}

fn codec_name(ft: FileType) -> String {
  match ft {
    FileType::Ape => "ape".into(),
    FileType::Flac => "flac".into(),
    FileType::Mpc => "musepack".into(),
    FileType::Opus => "opus".into(),
    FileType::Vorbis => "vorbis".into(),
    FileType::Speex => "speex".into(),
    FileType::WavPack => "wavpack".into(),
    FileType::Custom(name) => name.to_lowercase(),
    other => format!("{other:?}").to_lowercase(),
  }
}

/// Runs lofty work so that a panic inside it (a malformed file) is an error, not a crash.
fn guarded<T>(path: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
  catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err(Error::Tag(format!("{}: lofty panicked", path.display()))))
}

#[cfg(test)]
mod tests;
