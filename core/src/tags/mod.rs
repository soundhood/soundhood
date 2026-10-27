//! Tag reading and the verified tag write used by the write path (lofty 0.25).
//! Zone: core-foundation; the lossless write (`lossless/`): core-tags-lossless.
//! Contract: core/CONTRACT.md.

use crate::error::{Error, Result};
use crate::model::TagSet;
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType, TaggedFile, TaggedFileExt};
use lofty::picture::{Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
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

/// A file opened through lofty plus the fact the generic `TaggedFile` loses.
struct Opened {
  file: TaggedFile,
  codec: String,
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

/// Applies `changes` to the file at `path` (always a temp copy), losslessly: only the items behind
/// the `TagSet` fields change; every other item (pictures, lyrics, track numbers, freeform MP4
/// atoms such as iTunSMPB, described COMM / TXXX / PRIV frames, other Vorbis comments, FLAC
/// PICTURE blocks), an ID3v1 trailer, an APE tag and the audio bytes stay byte-identical. `Some("")`
/// (after trimming) removes the field; a missing tag is created, seeded from what `read` reported.
///
/// WriteOptions remove_others(false), respect_read_only(true), lossy_text_encoding(false); an
/// ID3v2.3 tag stays 2.3. The output is deterministic: the same file and changes give the same
/// bytes. MP4, MP3 / ADTS AAC, WAV / AIFF with an ID3v2 tag, FLAC and Ogg Vorbis / Opus / Speex are
/// written; any other format is `Error::Refused`, as is an item the writer could not keep
/// byte-for-byte (checked in memory before anything is written). After the write the file is
/// parsed again and any difference outside the intended fields is `Error::Verify`. A read-only file
/// is refused (`Error::Refused("read-only file")`) before anything is opened for writing.
///
/// Messages never carry a path (the file is a hidden temp copy). A refusal's message is a plain
/// sentence for the report, optionally followed by a newline and the technical detail, which the
/// write path keeps in the journal instead. A field the file holds several values for (two ARTIST
/// comments, a multi-value TPE1, several ©ART data boxes) is refused when the edit touches it:
/// the journal keeps one value per field, so undo could not bring the others back.
#[cfg_attr(not(test), allow(dead_code))] // ingest::tagwrite (zone core-writepath) is the caller
pub(crate) fn write(path: &Path, changes: &TagSet) -> Result<()> {
  lossless::write(path, changes)
}

/// Re-reads `tmp` and checks it against what was intended: duration within 1 s and codec equal to
/// `before`; every field in `changes` now holds its (trimmed) value; every other field equals
/// `before`. Returns the re-read tags.
#[cfg_attr(not(test), allow(dead_code))] // ingest::tagwrite (zone core-writepath) is the caller
pub(crate) fn verify(tmp: &Path, before: &TagRead, changes: &TagSet) -> Result<TagRead> {
  // The messages never name `tmp`: it is a hidden copy whose path shows where the library lives.
  let after = read(tmp)?;
  if after.duration_ms.abs_diff(before.duration_ms) > 1000 {
    return Err(Error::Verify(format!(
      "duration changed from {} ms to {} ms",
      before.duration_ms, after.duration_ms
    )));
  }
  if after.codec != before.codec {
    return Err(Error::Verify(format!(
      "codec changed from {} to {}",
      before.codec, after.codec
    )));
  }
  for (name, change, was, now) in fields(changes, before, &after) {
    let want = change.map_or(was, |v| v.trim());
    if now != want {
      return Err(Error::Verify(format!("{name} is {now:?}, expected {want:?}")));
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
    // The plain comment: ID3v2 COMM frames with a description (iTunNORM, iTunSMPB, ...) are data,
    // and lofty lists them under the same key.
    comment: text(&|t| {
      t.get_items(ItemKey::Comment)
        .find(|i| i.description().is_empty())
        .and_then(|i| i.value().text())
        .map(str::to_string)
    }),
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
/// (the MP4 codec, the MPEG layer).
fn open(path: &Path) -> Result<Opened> {
  let file = std::fs::File::open(path)?;
  guarded(path, || {
    let err = |e: lofty::error::FileParseError| Error::Tag(format!("{}: {}", path.display(), error_chain(&e)));
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
        }
      }
      FileType::Mpeg => {
        let f = lofty::mpeg::MpegFile::read_from(&mut reader, options).map_err(err)?;
        let codec = match f.properties().layer() {
          lofty::mpeg::Layer::Layer1 => "mp1",
          lofty::mpeg::Layer::Layer2 => "mp2",
          _ => "mp3",
        };
        Opened {
          file: f.into(),
          codec: codec.into(),
        }
      }
      FileType::Aac => {
        let f = lofty::aac::AacFile::read_from(&mut reader, options).map_err(err)?;
        Opened {
          file: f.into(),
          codec: "aac".into(),
        }
      }
      FileType::Wav => {
        let f = lofty::iff::wav::WavFile::read_from(&mut reader, options).map_err(err)?;
        Opened {
          file: f.into(),
          codec: "wav".into(),
        }
      }
      FileType::Aiff => {
        let f = lofty::iff::aiff::AiffFile::read_from(&mut reader, options).map_err(err)?;
        Opened {
          file: f.into(),
          codec: "aiff".into(),
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
        }
      }
    };
    Ok(opened)
  })
}

/// The file type lofty detects from the content (the extension only breaks ties).
fn probe(path: &Path) -> Result<FileType> {
  let file = std::fs::File::open(path)?;
  guarded(path, || {
    let mut probe = Probe::new(BufReader::new(file));
    if let Some(ft) = FileType::from_path(path) {
      probe = probe.set_file_type(ft);
    }
    probe
      .guess_file_type()?
      .file_type()
      .ok_or_else(|| Error::Tag(format!("{}: unknown audio format", path.display())))
  })
}

/// An error with its whole `source()` chain: lofty 0.25's own message is often only "failed to
/// write Mp4 file", with the cause one level down.
fn error_chain(e: &dyn std::error::Error) -> String {
  let mut out = e.to_string();
  let mut cause = e.source();
  while let Some(c) = cause {
    let msg = c.to_string();
    if !out.contains(&msg) {
      out.push_str(": ");
      out.push_str(&msg);
    }
    cause = c.source();
  }
  out
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

mod lossless;

#[cfg(test)]
mod tests;
