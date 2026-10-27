//! ID3v2 at the start of MP3 and ADTS AAC files, and in the `ID3 ` chunk of WAV and AIFF files.
//!
//! The new tag is built from the file's own frames: every frame outside the `TagSet` fields becomes a
//! `BinaryFrame` holding its original content, which lofty writes back verbatim, in the original
//! order. Only TIT2, TPE1, TALB, TPE2, TCON, the date frames (TDRC; TYER/TDAT/TIME in ID3v2.3) and
//! the COMM frame with an empty description are edited; described COMM frames, TXXX, PRIV, APIC,
//! USLT, GEOB and the rest are never touched. An ID3v1 trailer or APE tag lies outside the ID3v2 tag
//! and is left alone. A 2.3 tag stays 2.3; a new tag is 2.4.

use super::bytes::{be16, be32, le32, syncsafe, Source};
use super::{ensure_kept, lofty_error, refused, write_options, Field, Group, Item, Wanted};
use crate::error::{Error, Result};
use lofty::id3::v2::{
  BinaryFrame, CommentFrame, Frame, FrameFlags, FrameId, Id3v2Tag, Id3v2Version, TextInformationFrame,
};
use lofty::tag::TagExt;
use lofty::TextEncoding;
use std::borrow::Cow;
use std::path::Path;

/// Where the ID3v2 tag lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Host {
  /// At the start of the file (MP3, ADTS AAC).
  Leading,
  /// In a RIFF `ID3 ` chunk (WAV).
  Riff,
  /// In a FORM `ID3 ` chunk (AIFF).
  Aiff,
}

/// The parsed ID3v2 tag of one file plus everything around it.
pub(super) struct Meta {
  host: Host,
  tag: Option<RawTag>,
  /// The bytes outside the tag (MP3: the audio, an ID3v1 trailer, an APE tag; WAV/AIFF: the
  /// other chunks).
  container: Vec<Item>,
}

struct RawTag {
  major: u8,
  frames: Vec<RawFrame>,
}

struct RawFrame {
  id: String,
  /// The status flags and group id, as lofty will write them back.
  flags: FrameFlags,
  /// The frame content with unsynchronisation and any data length indicator removed.
  content: Vec<u8>,
  field: Option<Field>,
}

/// The region outside an MP3's ID3v2 tag has the same label with and without a tag, so creating a
/// tag compares the whole old file with what follows the new tag.
const OUTSIDE: &str = "the audio and other tags outside the ID3v2 tag";

pub(super) fn parse(path: &Path, host: Host) -> Result<Meta> {
  let mut src = Source::open(path)?;
  let mut container = Vec::new();
  let tag_bytes = match host {
    Host::Leading => {
      let head = src.peek(0, 10)?;
      if head.len() == 10 && &head[..3] == b"ID3" {
        let footer = if head[3] == 4 && head[5] & 0x10 != 0 { 10 } else { 0 };
        let total = 10 + u64::from(syncsafe(&head[6..10])) + footer;
        let bytes = src.read_at(0, total)?;
        container.push(Item::hashed(OUTSIDE, src.len - total, src.hash_range(total, src.len)?));
        Some(bytes)
      } else {
        // lofty also finds a tag behind up to 1 KiB of junk and would replace it there.
        if src.peek(1, 1024 + 10)?.windows(3).any(|w| w == b"ID3") {
          return Err(refused(
            path,
            "an ID3v2 tag that does not start the file is not written yet",
          ));
        }
        container.push(Item::hashed(OUTSIDE, src.len, src.hash_range(0, src.len)?));
        None
      }
    }
    Host::Riff | Host::Aiff => chunks(&mut src, path, &mut container)?,
  };
  let tag = match tag_bytes {
    Some(b) => Some(parse_tag(path, &b)?),
    None => None,
  };
  Ok(Meta { host, tag, container })
}

/// Walks a RIFF (little-endian) or FORM (big-endian) file: every chunk except the ID3 chunk and
/// padding becomes a container item; returns the ID3 chunk's content.
fn chunks(src: &mut Source<'_>, path: &Path, container: &mut Vec<Item>) -> Result<Option<Vec<u8>>> {
  let head = src.read_at(0, 12)?;
  let little = match &head[..4] {
    b"RIFF" => true,
    b"FORM" => false,
    _ => return Err(src.malformed("not a RIFF or AIFF file")),
  };
  let u32_at = |b: &[u8]| if little { le32(b) } else { be32(b) };
  container.push(Item::of(Group::Container, None, "the IFF form type", &head[8..12]));
  let end = (8 + u64::from(u32_at(&head[4..8]))).min(src.len);
  let mut tag = None;
  let mut pos = 12u64;
  while pos + 8 <= end {
    let h = src.read_at(pos, 8)?;
    let size = u64::from(u32_at(&h[4..8]));
    let (data, data_end) = (pos + 8, pos + 8 + size);
    let name = String::from_utf8_lossy(&h[..4]).into_owned();
    if data_end > end {
      return Err(src.malformed(format!("the {name:?} chunk runs past the end of the file")));
    }
    match &h[..4] {
      b"ID3 " | b"id3 " if tag.is_some() => return Err(refused(path, "the file has more than one ID3 chunk")),
      b"ID3 " | b"id3 " => tag = Some(src.read_at(data, size)?),
      // Padding: lofty may turn an outgrown ID3 chunk into JUNK.
      b"JUNK" | b"junk" | b"PAD " | b"FLLR" => {}
      _ => container.push(Item::hashed(
        format!("the {name:?} chunk"),
        size,
        src.hash_range(data, data_end)?,
      )),
    }
    pos = data_end + (size & 1);
  }
  if end < src.len {
    container.push(Item::hashed(
      "the bytes after the IFF form",
      src.len - end,
      src.hash_range(end, src.len)?,
    ));
  }
  Ok(tag)
}

/// Undoes ID3v2 unsynchronisation: every `FF 00` becomes `FF`.
fn deunsync(b: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(b.len());
  let mut prev = 0u8;
  for &x in b {
    if !(prev == 0xff && x == 0) {
      out.push(x);
    }
    prev = x;
  }
  out
}

fn valid_id(id: &[u8]) -> bool {
  id.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// A frame header (or the end of the frames) starts at `pos`.
fn lands(body: &[u8], pos: usize) -> bool {
  pos == body.len() || body.get(pos) == Some(&0) || (pos + 10 <= body.len() && valid_id(&body[pos..pos + 4]))
}

/// The size of the frame at `pos`. ID3v2.4 sizes are synchsafe, but some writers (old iTunes) wrote
/// plain integers: like TagLib, the plain reading wins when only it lands on the next frame.
fn frame_size(body: &[u8], pos: usize, major: u8) -> usize {
  let plain = be32(&body[pos + 4..pos + 8]) as usize;
  // A byte with its top bit set cannot be synchsafe.
  if major == 3 || plain & 0x8080_8080 != 0 {
    return plain;
  }
  let safe = syncsafe(&body[pos + 4..pos + 8]) as usize;
  if !lands(body, pos + 10 + safe) && lands(body, pos + 10 + plain) {
    plain
  } else {
    safe
  }
}

fn parse_tag(path: &Path, bytes: &[u8]) -> Result<RawTag> {
  let malformed = |what: String| Error::Tag(format!("{}: {what}", path.display()));
  if bytes.len() < 10 || &bytes[..3] != b"ID3" {
    return Err(malformed("the ID3v2 header is missing".into()));
  }
  let (major, flags) = (bytes[3], bytes[5]);
  match major {
    3 | 4 => {}
    2 => return Err(refused(path, "ID3v2.2 tags are not written yet")),
    v => return Err(refused(path, format!("ID3v2.{v} tags are not written"))),
  }
  if major == 4 && flags & 0x80 != 0 {
    return Err(refused(path, "unsynchronised ID3v2.4 tags are not written yet"));
  }
  let size = syncsafe(&bytes[6..10]) as usize;
  let body = bytes
    .get(10..10 + size)
    .ok_or_else(|| malformed("the ID3v2 tag is larger than the file".into()))?;
  // ID3v2.3 unsynchronises the whole tag after the frames are built.
  let body: Cow<[u8]> = if major == 3 && flags & 0x80 != 0 {
    Cow::Owned(deunsync(body))
  } else {
    Cow::Borrowed(body)
  };
  let mut pos = 0usize;
  if flags & 0x40 != 0 {
    let ext = body
      .get(..4)
      .ok_or_else(|| malformed("the ID3v2 extended header is truncated".into()))?;
    pos = if major == 3 {
      4 + be32(ext) as usize
    } else {
      syncsafe(ext) as usize
    };
    if pos > body.len() {
      return Err(malformed("the ID3v2 extended header is larger than the tag".into()));
    }
  }
  let mut frames = Vec::new();
  while pos + 10 <= body.len() && body[pos] != 0 {
    let id = &body[pos..pos + 4];
    if !valid_id(id) {
      return Err(malformed(format!("unreadable data at offset {pos} of the ID3v2 tag")));
    }
    let id = String::from_utf8_lossy(id).into_owned();
    let size = frame_size(&body, pos, major);
    let start = pos + 10;
    let end = start
      .checked_add(size)
      .filter(|&e| e <= body.len())
      .ok_or_else(|| malformed(format!("the ID3v2 frame {id} is larger than the tag")))?;
    let (flags, content) = frame_content(path, major, &id, be16(&body[pos + 8..]), &body[start..end])?;
    frames.push(RawFrame {
      field: field_of(&id, &content),
      id,
      flags,
      content,
    });
    pos = end;
  }
  Ok(RawTag { major, frames })
}

/// The status flags and the plain content of one frame.
fn frame_content(path: &Path, major: u8, id: &str, raw: u16, data: &[u8]) -> Result<(FrameFlags, Vec<u8>)> {
  let mut flags = FrameFlags::default();
  let (grouped, packed, unsync, dli);
  if major == 4 {
    flags.tag_alter_preservation = raw & 0x4000 != 0;
    flags.file_alter_preservation = raw & 0x2000 != 0;
    flags.read_only = raw & 0x1000 != 0;
    grouped = raw & 0x0040 != 0;
    packed = raw & 0x000c != 0;
    unsync = raw & 0x0002 != 0;
    dli = raw & 0x0001 != 0;
  } else {
    flags.tag_alter_preservation = raw & 0x8000 != 0;
    flags.file_alter_preservation = raw & 0x4000 != 0;
    flags.read_only = raw & 0x2000 != 0;
    grouped = raw & 0x0020 != 0;
    packed = raw & 0x00c0 != 0;
    unsync = false;
    dli = false;
  }
  if packed {
    return Err(refused(
      path,
      format!("the ID3v2 frame {id} is compressed or encrypted"),
    ));
  }
  // Extra header bytes, in flag order: group id, then (2.4) the data length indicator.
  let mut at = 0;
  if grouped {
    flags.grouping_identity = data.first().copied();
    at += 1;
  }
  if dli {
    at += 4;
  }
  let content = data
    .get(at..)
    .ok_or_else(|| Error::Tag(format!("{}: the ID3v2 frame {id} is truncated", path.display())))?;
  Ok((flags, if unsync { deunsync(content) } else { content.to_vec() }))
}

/// A COMM frame whose description is empty: the plain comment field.
fn empty_description(content: &[u8]) -> bool {
  let rest = content.get(4..).unwrap_or_default();
  match content.first() {
    Some(1) => {
      rest.starts_with(&[0, 0]) || rest.starts_with(&[0xff, 0xfe, 0, 0]) || rest.starts_with(&[0xfe, 0xff, 0, 0])
    }
    Some(2) => rest.starts_with(&[0, 0]),
    _ => rest.first().is_none_or(|&b| b == 0),
  }
}

/// The frames behind each `TagSet` field. TDAT and TIME hold the day and time of an ID3v2.3 date, so
/// they go with the year.
fn field_of(id: &str, content: &[u8]) -> Option<Field> {
  match id {
    "TIT2" => Some(Field::Title),
    "TPE1" => Some(Field::Artist),
    "TALB" => Some(Field::Album),
    "TPE2" => Some(Field::AlbumArtist),
    "TCON" => Some(Field::Genre),
    "TDRC" | "TYER" | "TDAT" | "TIME" => Some(Field::Year),
    "COMM" if empty_description(content) => Some(Field::Comment),
    _ => None,
  }
}

impl Meta {
  pub(super) fn items(&self) -> Vec<Item> {
    let mut items = self.container.clone();
    if let Some(tag) = &self.tag {
      items.push(Item::of(Group::Header, None, "the ID3v2 version", &[tag.major]));
      items.extend(frame_items(&tag.frames));
    }
    items
  }
}

fn frame_items(frames: &[RawFrame]) -> Vec<Item> {
  frames
    .iter()
    .map(|f| {
      let g = f.flags.grouping_identity;
      let mut bytes = vec![
        u8::from(f.flags.tag_alter_preservation),
        u8::from(f.flags.file_alter_preservation),
        u8::from(f.flags.read_only),
        u8::from(g.is_some()),
        g.unwrap_or(0),
      ];
      bytes.extend_from_slice(&f.content);
      Item::of(Group::Tag, f.field, format!("ID3v2 frame {}", f.id), &bytes)
    })
    .collect()
}

/// Plain ASCII as Latin-1 (readable by every player), else UTF-8 in 2.4 and UTF-16 in 2.3.
fn encoding(value: &str, id3v23: bool) -> TextEncoding {
  if value.is_ascii() {
    TextEncoding::Latin1
  } else if id3v23 {
    TextEncoding::UTF16
  } else {
    TextEncoding::UTF8
  }
}

/// An ID3v2.3 date: TYER, plus TDAT (DDMM) and TIME (HHMM) for "YYYY-MM-DD[THH:MM]". `None` when 2.3
/// cannot hold the value exactly.
fn v23_date(v: &str) -> Option<Vec<(&'static str, String)>> {
  let b = v.as_bytes();
  let digits = |from: usize, to: usize| b.get(from..to).is_some_and(|s| s.iter().all(u8::is_ascii_digit));
  if b.len() == 4 && digits(0, 4) {
    return Some(vec![("TYER", v.to_string())]);
  }
  if !(b.len() == 10 || b.len() == 16)
    || !(digits(0, 4) && b[4] == b'-' && digits(5, 7) && b[7] == b'-' && digits(8, 10))
  {
    return None;
  }
  let mut out = vec![
    ("TYER", v[..4].to_string()),
    ("TDAT", format!("{}{}", &v[8..10], &v[5..7])),
  ];
  if b.len() == 16 {
    if !(b[10] == b'T' && digits(11, 13) && b[13] == b':' && digits(14, 16)) {
      return None;
    }
    out.push(("TIME", format!("{}{}", &v[11..13], &v[14..16])));
  }
  Some(out)
}

/// The frames that carry `f` after the edit (none when it is cleared or untouched).
fn new_frames(
  path: &Path,
  f: Field,
  wanted: &Wanted,
  id3v23: bool,
  replaced: Option<&RawFrame>,
) -> Result<Vec<Frame<'static>>> {
  let Some(v) = wanted.value(f) else {
    return Ok(Vec::new());
  };
  let text = |id: &'static str, value: String| {
    Frame::Text(TextInformationFrame::new(
      FrameId::Valid(Cow::Borrowed(id)),
      encoding(&value, id3v23),
      value,
    ))
  };
  Ok(match f {
    Field::Title => vec![text("TIT2", v.into())],
    Field::Artist => vec![text("TPE1", v.into())],
    Field::Album => vec![text("TALB", v.into())],
    Field::AlbumArtist => vec![text("TPE2", v.into())],
    Field::Genre => vec![text("TCON", v.into())],
    Field::Year if id3v23 => v23_date(v)
      .ok_or_else(|| refused(path, format!("an ID3v2.3 tag cannot hold the date {v:?}")))?
      .into_iter()
      .map(|(id, s)| text(id, s))
      .collect(),
    Field::Year => vec![text("TDRC", v.into())],
    Field::Comment => {
      // Keep the language of the comment being replaced.
      let lang = replaced
        .and_then(|r| r.content.get(1..4))
        .filter(|l| l.iter().all(u8::is_ascii_alphabetic))
        .map_or(*b"XXX", |l| [l[0], l[1], l[2]]);
      vec![Frame::Comment(CommentFrame::new(
        encoding(v, id3v23),
        lang,
        "",
        v.to_string(),
      ))]
    }
  })
}

/// An untouched frame, as lofty will write it back unchanged.
fn keep(path: &Path, raw: &RawFrame, id3v23: bool) -> Result<Frame<'static>> {
  let id = FrameId::new(raw.id.clone()).map_err(|e| refused(path, format!("the ID3v2 frame id {}: {e}", raw.id)))?;
  if id3v23 && raw.id == "TCON" {
    // lofty's 2.3 writer drops a TCON that is not a text frame; as a text frame it is re-encoded,
    // which the pre-write comparison checks.
    if let Ok(Some(t)) =
      TextInformationFrame::parse(&mut raw.content.as_slice(), id.clone(), raw.flags, Id3v2Version::V3)
    {
      return Ok(Frame::Text(t));
    }
  }
  let mut frame = BinaryFrame::new(id, raw.content.clone());
  frame.set_flags(raw.flags);
  Ok(Frame::Binary(frame))
}

/// Rewrites the ID3v2 tag with `wanted` applied; returns the edit as applied.
pub(super) fn write(path: &Path, meta: &Meta, wanted: Wanted) -> Result<Wanted> {
  let (id3v23, wanted) = match (&meta.tag, meta.host) {
    (Some(tag), _) => (tag.major == 3, wanted),
    (None, Host::Leading) => (false, wanted.seeded(path)?),
    (None, _) => {
      let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
      return Err(Error::Refused(format!(
        "tag writes are not supported for {ext} files without an ID3v2 tag yet"
      )));
    }
  };
  let frames = meta.tag.as_ref().map_or(&[][..], |t| &t.frames);
  let mut out = Vec::new();
  let mut done = [false; 7];
  for raw in frames {
    match raw.field.filter(|&f| wanted.touches(f)) {
      // The first frame of an edited field takes the new value in place; the others go.
      Some(f) => {
        if !std::mem::replace(&mut done[f as usize], true) {
          out.extend(new_frames(path, f, &wanted, id3v23, Some(raw))?);
        }
      }
      None => out.push(keep(path, raw, id3v23)?),
    }
  }
  for f in Field::ALL {
    if !done[f as usize] {
      out.extend(new_frames(path, f, &wanted, id3v23, None)?);
    }
  }
  let mut tag = Id3v2Tag::new();
  for frame in out {
    let _ = tag.insert(frame);
  }

  let options = write_options(id3v23);
  let mut encoded = Vec::new();
  tag
    .dump_to(&mut encoded, options)
    .map_err(|e| lofty_error(path, "cannot encode the ID3v2 tag", &e))?;
  let rebuilt = if encoded.is_empty() {
    Vec::new()
  } else {
    parse_tag(path, &encoded)?.frames
  };
  ensure_kept(path, &frame_items(frames), &frame_items(&rebuilt), &wanted)?;

  tag
    .save_to_path(path, options)
    .map_err(|e| lofty_error(path, "cannot write the ID3v2 tag", &e))?;
  Ok(wanted)
}

/// The ID3v2 version and frames of a file as (id, plain content), for tests.
#[cfg(test)]
pub(super) fn raw_frames(path: &Path, host: Host) -> (Option<u8>, Vec<(String, Vec<u8>)>) {
  match parse(path, host).expect("parse the ID3v2 metadata").tag {
    Some(t) => (Some(t.major), t.frames.into_iter().map(|f| (f.id, f.content)).collect()),
    None => (None, Vec::new()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn frame(id: &[u8; 4], size: [u8; 4], content: &[u8]) -> Vec<u8> {
    let mut f = id.to_vec();
    f.extend_from_slice(&size);
    f.extend_from_slice(&[0, 0]);
    f.extend_from_slice(content);
    f
  }

  fn tag(major: u8, flags: u8, frames: &[u8]) -> Vec<u8> {
    let n = frames.len() as u32;
    let mut t = vec![b'I', b'D', b'3', major, 0, flags];
    t.extend_from_slice(&[
      (n >> 21) as u8 & 0x7f,
      (n >> 14) as u8 & 0x7f,
      (n >> 7) as u8 & 0x7f,
      n as u8 & 0x7f,
    ]);
    t.extend_from_slice(frames);
    t
  }

  #[test]
  fn reads_an_id3v24_frame_size_written_as_a_plain_integer() {
    // Old iTunes wrote 2.4 frame sizes as plain integers: 0x100 read as synchsafe would be 128.
    let mut long = vec![0u8];
    long.extend(std::iter::repeat_n(b'a', 255));
    let mut frames = frame(b"TIT2", 256u32.to_be_bytes(), &long);
    frames.extend(frame(b"TPE1", [0, 0, 0, 3], b"\0ab"));
    let parsed = parse_tag(Path::new("t.mp3"), &tag(4, 0, &frames)).unwrap();
    let ids: Vec<&str> = parsed.frames.iter().map(|f| f.id.as_str()).collect();
    assert_eq!(ids, ["TIT2", "TPE1"]);
    assert_eq!(parsed.frames[0].content.len(), 256);
  }

  #[test]
  fn undoes_whole_tag_unsynchronisation_in_id3v23() {
    // Content `o 00 FF 00` is stored unsynchronised as `o 00 FF 00 00`; the frame size counts the
    // plain content.
    let frames = frame(b"PRIV", [0, 0, 0, 4], &[b'o', 0, 0xff, 0x00, 0x00]);
    let parsed = parse_tag(Path::new("t.mp3"), &tag(3, 0x80, &frames)).unwrap();
    assert_eq!(parsed.frames.len(), 1);
    assert_eq!(parsed.frames[0].content, [b'o', 0, 0xff, 0]);
    assert_eq!(
      deunsync(&[0xff, 0x00, 0xe0, 0xff, 0x00, 0x00]),
      [0xff, 0xe0, 0xff, 0x00]
    );
  }

  #[test]
  fn refuses_id3v22_and_compressed_frames() {
    let v22 = tag(2, 0, b"TT2\0\0\x02\0a");
    assert!(matches!(parse_tag(Path::new("t.mp3"), &v22), Err(Error::Refused(_))));
    let mut compressed = frame(b"TIT2", [0, 0, 0, 2], b"\0a");
    compressed[9] = 0x08;
    assert!(matches!(
      parse_tag(Path::new("t.mp3"), &tag(4, 0, &compressed)),
      Err(Error::Refused(m)) if m.contains("TIT2")
    ));
  }

  #[test]
  fn strips_the_group_id_and_data_length_indicator() {
    let mut f = frame(b"PRIV", [0, 0, 0, 7], &[0x42, 0, 0, 0, 2, b'o', 0]);
    f[9] = 0x41; // grouping + data length indicator
    let parsed = parse_tag(Path::new("t.mp3"), &tag(4, 0, &f)).unwrap();
    assert_eq!(parsed.frames[0].content, [b'o', 0]);
    assert_eq!(parsed.frames[0].flags.grouping_identity, Some(0x42));
  }

  #[test]
  fn the_plain_comment_is_the_one_without_a_description() {
    assert!(empty_description(b"\0eng\0text"));
    assert!(empty_description(b"\x03eng\0text"));
    assert!(!empty_description(b"\0engiTunNORM\0 0000"));
    assert!(empty_description(&[
      1, b'e', b'n', b'g', 0xff, 0xfe, 0, 0, 0xff, 0xfe, b'a', 0
    ]));
    assert!(!empty_description(&[1, b'e', b'n', b'g', 0xff, 0xfe, b'a', 0, 0, 0]));
    assert_eq!(field_of("COMM", b"\0engiTunNORM\0x"), None);
    assert_eq!(field_of("COMM", b"\0eng\0x"), Some(Field::Comment));
    assert_eq!(field_of("TXXX", b"\0\0x"), None);
  }

  #[test]
  fn id3v23_dates_split_into_tyer_tdat_time() {
    assert_eq!(v23_date("1999"), Some(vec![("TYER", "1999".to_string())]));
    assert_eq!(
      v23_date("2001-02-03"),
      Some(vec![("TYER", "2001".to_string()), ("TDAT", "0302".to_string())])
    );
    assert_eq!(
      v23_date("2001-02-03T04:05"),
      Some(vec![
        ("TYER", "2001".to_string()),
        ("TDAT", "0302".to_string()),
        ("TIME", "0405".to_string())
      ])
    );
    for unfit in ["2001-02", "2001-02-03T04:05:06", "99", "circa 1999"] {
      assert_eq!(v23_date(unfit), None, "{unfit}");
    }
  }
}
