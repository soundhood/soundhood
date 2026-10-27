//! The lossless tag write behind `tags::write`.
//!
//! lofty's generic `Tag` cannot hold everything a concrete tag holds, and saving one replaces the
//! concrete tag: freeform MP4 atoms (iTunSMPB, the gapless info), ID3v2 frames without an
//! `ItemKey` (PRIV, GEOB, described COMM) and FLAC PICTURE blocks were silently dropped. So each
//! format is edited through its concrete tag instead, and only the items behind the `TagSet` fields
//! are touched; every other item is carried over as the bytes the file held.
//!
//! Each write is checked twice, at the item level:
//! - before anything is written, the rebuilt tag is encoded in memory and every untouched item must
//!   come out byte-identical (else `Error::Refused`, file untouched): this catches what lofty would
//!   re-encode differently;
//! - after the write, the file is parsed again and every untouched item, the container structure
//!   and the audio bytes must equal the snapshot taken before (else `Error::Verify`).
//!
//! The snapshots come from small parsers here (MP4 boxes, ID3v2 frames, FLAC blocks, Ogg pages),
//! not from lofty, so a lofty parse that drops something cannot hide its own loss.

mod bytes;
mod id3;
mod mp4;
mod vorbis;

use crate::error::{Error, Result};
use crate::model::TagSet;
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::FileType;
use std::path::Path;

/// The editable fields, in `TagSet` order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Field {
  Title,
  Artist,
  Album,
  AlbumArtist,
  Genre,
  Year,
  Comment,
}

impl Field {
  const ALL: [Field; 7] = [
    Field::Title,
    Field::Artist,
    Field::Album,
    Field::AlbumArtist,
    Field::Genre,
    Field::Year,
    Field::Comment,
  ];
}

/// The edit, resolved per field: `None` = untouched, `Some("")` = clear, else the trimmed value.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Wanted([Option<String>; 7]);

impl Wanted {
  fn new(changes: &TagSet) -> Self {
    let trimmed = |v: &Option<String>| v.as_deref().map(|s| s.trim().to_string());
    Wanted([
      trimmed(&changes.title),
      trimmed(&changes.artist),
      trimmed(&changes.album),
      trimmed(&changes.album_artist),
      trimmed(&changes.genre),
      trimmed(&changes.year),
      trimmed(&changes.comment),
    ])
  }

  /// The field is part of this edit (set or cleared).
  fn touches(&self, f: Field) -> bool {
    self.0[f as usize].is_some()
  }

  /// The value to write for `f`; `None` when the field is untouched or cleared.
  fn value(&self, f: Field) -> Option<&str> {
    self.0[f as usize].as_deref().filter(|v| !v.is_empty())
  }

  fn is_empty(&self) -> bool {
    self.0.iter().all(Option::is_none)
  }

  /// For a file without the tag the writer creates (an ID3v1-only MP3, a FLAC without comments):
  /// untouched fields start from what `tags::read` reported, so they keep their values once the
  /// new tag takes over. The seeded fields count as touched for the item check.
  fn seeded(mut self, path: &Path) -> Result<Self> {
    let r = super::read(path)?;
    let seen = [r.title, r.artist, r.album, r.album_artist, r.genre, r.year, r.comment];
    for (slot, value) in self.0.iter_mut().zip(seen) {
      if slot.is_none() && !value.is_empty() {
        *slot = Some(value);
      }
    }
    Ok(self)
  }
}

/// Which items are compared together, in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Group {
  /// Container structure and audio bytes: FLAC blocks, Ogg header packets and audio pages, the
  /// bytes around an ID3v2 tag, MP4 `mdat` payloads.
  Container,
  /// Tag items in file order: MP4 atoms, ID3v2 frames, Vorbis comments.
  Tag,
  /// Pictures, in their own order: lofty writes Vorbis pictures after the text comments.
  Picture,
  /// Compared only when both sides have it: an ID3v2 version or a Vorbis vendor string disappears
  /// with its tag when an edit clears the last item.
  Header,
}

/// One metadata item as the file stores it, reduced to a hash of its exact bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Item {
  group: Group,
  /// The `TagSet` field the item belongs to; `None` for everything a write must never change.
  field: Option<Field>,
  /// Plain words for messages, e.g. "MP4 atom ----:com.apple.iTunes:iTunSMPB".
  label: String,
  len: u64,
  hash: [u8; 32],
}

impl Item {
  fn of(group: Group, field: Option<Field>, label: impl Into<String>, bytes: &[u8]) -> Self {
    Item {
      group,
      field,
      label: label.into(),
      len: bytes.len() as u64,
      hash: bytes::hash(bytes),
    }
  }

  /// A streamed region (audio), already hashed.
  fn hashed(label: impl Into<String>, len: u64, hash: [u8; 32]) -> Self {
    Item {
      group: Group::Container,
      field: None,
      label: label.into(),
      len,
      hash,
    }
  }
}

/// The first item, outside the fields `wanted` touches, that differs between two snapshots; the
/// message names it.
fn first_difference(before: &[Item], after: &[Item], wanted: &Wanted) -> Option<String> {
  let kept = |items: &[Item], g: Group| -> Vec<Item> {
    items
      .iter()
      .filter(|i| i.group == g && !i.field.is_some_and(|f| wanted.touches(f)))
      .cloned()
      .collect()
  };
  for group in [Group::Container, Group::Tag, Group::Picture] {
    let (b, a) = (kept(before, group), kept(after, group));
    for i in 0..b.len().max(a.len()) {
      match (b.get(i), a.get(i)) {
        (Some(x), Some(y)) if x == y => {}
        (Some(x), Some(y)) if x.label == y.label => return Some(format!("{} changed", x.label)),
        (Some(x), _) if !a.contains(x) => return Some(format!("{} is missing", x.label)),
        (_, Some(y)) if !b.contains(y) => return Some(format!("{} was added", y.label)),
        (Some(x), _) => return Some(format!("{} moved", x.label)),
        (None, _) => return Some("an item was added".into()),
      }
    }
  }
  let header = |items: &[Item], label: &str| {
    items
      .iter()
      .find(|i| i.group == Group::Header && i.label == label)
      .cloned()
  };
  for b in before.iter().filter(|i| i.group == Group::Header) {
    if header(after, &b.label).is_some_and(|a| a != *b) {
      return Some(format!("{} changed", b.label));
    }
  }
  None
}

/// The format-specific writer for a file, chosen from its content (the extension only breaks ties).
#[derive(Clone, Copy, Debug)]
enum Format {
  Mp4,
  Id3(id3::Host),
  Flac,
  Ogg(vorbis::Codec),
}

impl Format {
  fn of(path: &Path) -> Result<Format> {
    let ft = super::probe(path)?;
    Ok(match ft {
      FileType::Mp4 => Format::Mp4,
      FileType::Mpeg | FileType::Aac => Format::Id3(id3::Host::Leading),
      FileType::Wav => Format::Id3(id3::Host::Riff),
      FileType::Aiff => Format::Id3(id3::Host::Aiff),
      FileType::Flac => Format::Flac,
      FileType::Vorbis => Format::Ogg(vorbis::Codec::Vorbis),
      FileType::Opus => Format::Ogg(vorbis::Codec::Opus),
      FileType::Speex => Format::Ogg(vorbis::Codec::Speex),
      other => {
        let ext = path
          .extension()
          .map(|e| e.to_string_lossy().to_lowercase())
          .unwrap_or_else(|| format!("{other:?}").to_lowercase());
        return Err(Error::Refused(format!(
          "tag writes are not supported for {ext} files yet"
        )));
      }
    })
  }

  /// The item snapshot of the file as it is on disk now.
  fn snapshot(self, path: &Path) -> Result<Vec<Item>> {
    Ok(match self {
      Format::Mp4 => mp4::parse(path)?.items(),
      Format::Id3(host) => id3::parse(path, host)?.items(),
      Format::Flac => vorbis::parse_flac(path)?.items(),
      Format::Ogg(codec) => vorbis::parse_ogg(path, codec)?.items(),
    })
  }

  /// Snapshot, then write; returns the snapshot taken before and the edit as applied (seeded).
  fn write(self, path: &Path, wanted: Wanted) -> Result<(Vec<Item>, Wanted)> {
    Ok(match self {
      Format::Mp4 => {
        let meta = mp4::parse(path)?;
        (meta.items(), mp4::write(path, &meta, wanted)?)
      }
      Format::Id3(host) => {
        let meta = id3::parse(path, host)?;
        (meta.items(), id3::write(path, &meta, wanted)?)
      }
      Format::Flac => {
        let meta = vorbis::parse_flac(path)?;
        (meta.items(), vorbis::write_flac(path, &meta, wanted)?)
      }
      Format::Ogg(codec) => {
        let meta = vorbis::parse_ogg(path, codec)?;
        (meta.items(), vorbis::write_ogg(path, &meta, codec, wanted)?)
      }
    })
  }
}

/// See `tags::write`.
pub(super) fn write(path: &Path, changes: &TagSet) -> Result<()> {
  if std::fs::metadata(path)?.permissions().readonly() {
    return Err(Error::Refused(format!("read-only: {}", path.display())));
  }
  let wanted = Wanted::new(changes);
  if wanted.is_empty() {
    return Ok(());
  }
  let format = Format::of(path)?;
  super::guarded(path, || {
    let (before, applied) = format.write(path, wanted)?;
    let after = format.snapshot(path)?;
    match first_difference(&before, &after, &applied) {
      Some(what) => Err(Error::Verify(format!("{}: {what} after the tag write", path.display()))),
      None => Ok(()),
    }
  })
}

/// The pre-write check: `rebuilt` is the tag lofty is about to write, parsed back from memory.
fn ensure_kept(path: &Path, before: &[Item], rebuilt: &[Item], wanted: &Wanted) -> Result<()> {
  match first_difference(before, rebuilt, wanted) {
    Some(what) => Err(refused(
      path,
      format!("{what} in the rebuilt tag, so it cannot be kept byte-for-byte; nothing was written"),
    )),
    None => Ok(()),
  }
}

/// lofty parses for the write path: no implicit conversions (`gnre` -> `©gen`, "3/12" track
/// numbers split), so what lofty hands back is what the file holds.
fn parse_options() -> ParseOptions {
  ParseOptions::new().implicit_conversions(false)
}

/// remove_others(false), respect_read_only(true), never lossy text ('?' for unencodable
/// characters), ID3v2.3 kept as 2.3.
fn write_options(id3v23: bool) -> WriteOptions {
  let mut options = WriteOptions::new().remove_others(false).respect_read_only(true);
  options = options.lossy_text_encoding(false);
  options = options.use_id3v23(id3v23);
  options.parse_options(parse_options())
}

fn refused(path: &Path, why: impl std::fmt::Display) -> Error {
  Error::Refused(format!("{}: {why}", path.display()))
}

/// A lofty failure as `Error::Tag`, with its whole `source()` chain.
fn lofty_error(path: &Path, what: &str, e: &dyn std::error::Error) -> Error {
  Error::Tag(format!("{}: {what}: {}", path.display(), super::error_chain(e)))
}

#[cfg(test)]
mod tests;
