//! Vorbis comments: FLAC (a VORBIS_COMMENT block; pictures in PICTURE blocks) and Ogg Vorbis, Opus
//! and Speex (the comment header packet; pictures as METADATA_BLOCK_PICTURE comments).
//!
//! The new comment list is built from the file's own comments, each untouched one passed to lofty as
//! the exact key and value it had, in order; edited fields keep their position and key spelling.
//! FLAC is saved through `FlacFile`, so its PICTURE blocks are written back (saving the comments
//! alone would delete them); Ogg pictures stay in the comments lofty parsed.

use super::bytes::{be24, le32, syncsafe, Source};
use super::{ensure_kept, lofty_error, parse_options, refused, write_options, Field, Group, Item, Wanted};
use crate::error::Result;
use lofty::config::WriteOptions;
use lofty::file::AudioFile;
use lofty::flac::FlacFile;
use lofty::ogg::tag::VorbisComments;
use lofty::ogg::{OggPictureStorage, OpusFile, SpeexFile, VorbisFile};
use lofty::tag::TagExt;
use std::fs::{File, OpenOptions};
use std::io::BufReader;
use std::path::Path;

/// The Ogg codecs lofty can tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Codec {
  Vorbis,
  Opus,
  Speex,
}

/// A Vorbis comment list as stored: the vendor string and each `KEY=value` entry, raw.
struct Comments {
  vendor: Vec<u8>,
  items: Vec<Vec<u8>>,
}

/// The next `n` bytes of `buf` at `*pos`, advancing it.
fn take<'a>(buf: &'a [u8], pos: &mut usize, n: usize) -> Option<&'a [u8]> {
  let s = buf.get(*pos..pos.checked_add(n)?)?;
  *pos += n;
  Some(s)
}

/// Parses a comment list from the start of `buf`; returns it with the number of bytes it used.
fn parse_comments(buf: &[u8]) -> Option<(Comments, usize)> {
  let mut pos = 0usize;
  let vendor_len = le32(take(buf, &mut pos, 4)?) as usize;
  let vendor = take(buf, &mut pos, vendor_len)?.to_vec();
  let count = le32(take(buf, &mut pos, 4)?);
  let mut items = Vec::new();
  for _ in 0..count {
    let n = le32(take(buf, &mut pos, 4)?) as usize;
    items.push(take(buf, &mut pos, n)?.to_vec());
  }
  Some((Comments { vendor, items }, pos))
}

/// The key of a `KEY=value` entry, if it has a separator.
fn key(item: &[u8]) -> Option<&[u8]> {
  item.iter().position(|&b| b == b'=').map(|i| &item[..i])
}

/// A key lofty writes as given: 0x20..=0x7D without '=', not empty.
fn valid_key(k: &str) -> bool {
  !k.is_empty() && k.bytes().all(|b| (0x20..=0x7d).contains(&b) && b != b'=')
}

/// The group and `TagSet` field of one entry (keys compare case-insensitively, as lofty reads them).
fn classify(item: &[u8]) -> (Group, Option<Field>) {
  let Some(k) = key(item) else {
    return (Group::Tag, None);
  };
  let is = |name: &str| k.eq_ignore_ascii_case(name.as_bytes());
  if is("METADATA_BLOCK_PICTURE") {
    return (Group::Picture, None);
  }
  let field = if is("TITLE") {
    Some(Field::Title)
  } else if is("ARTIST") {
    Some(Field::Artist)
  } else if is("ALBUM") {
    Some(Field::Album)
  } else if is("ALBUMARTIST") || is("ALBUM ARTIST") {
    Some(Field::AlbumArtist)
  } else if is("GENRE") {
    Some(Field::Genre)
  } else if is("DATE") || is("YEAR") {
    Some(Field::Year)
  } else if is("COMMENT") {
    Some(Field::Comment)
  } else {
    None
  };
  (Group::Tag, field)
}

/// The key a field is written under when the file had none.
fn canonical(f: Field) -> &'static str {
  match f {
    Field::Title => "TITLE",
    Field::Artist => "ARTIST",
    Field::Album => "ALBUM",
    Field::AlbumArtist => "ALBUMARTIST",
    Field::Genre => "GENRE",
    Field::Year => "DATE",
    Field::Comment => "COMMENT",
  }
}

fn comment_items(c: &Comments, kind: &str) -> Vec<Item> {
  let mut items = vec![Item::of(
    Group::Header,
    None,
    format!("the {kind} vendor string"),
    &c.vendor,
  )];
  for raw in &c.items {
    let (group, field) = classify(raw);
    let name = String::from_utf8_lossy(key(raw).unwrap_or(raw));
    items.push(Item::of(group, field, format!("the {kind} comment {name}"), raw));
  }
  items
}

/// The comment list to hand lofty: `wanted` applied, everything else exactly as the file has it.
fn rebuild(path: &Path, comments: Option<&Comments>, wanted: &Wanted, flac: bool) -> Result<Vec<(String, String)>> {
  let mut out = Vec::new();
  let mut done = [false; 7];
  for raw in comments.map_or(&[][..], |c| &c.items) {
    let name = String::from_utf8_lossy(key(raw).unwrap_or(raw)).into_owned();
    if name.eq_ignore_ascii_case("COVERART") {
      return Err(refused(
        path,
        "the legacy COVERART comment cannot be kept byte-for-byte; nothing was written",
      ));
    }
    let (group, field) = classify(raw);
    if group == Group::Picture {
      if flac {
        return Err(refused(
          path,
          "a METADATA_BLOCK_PICTURE comment inside a FLAC file cannot be kept byte-for-byte; nothing was written",
        ));
      }
      // The pictures lofty parsed are written back after the text comments (checked before writing).
      continue;
    }
    if let Some(f) = field.filter(|&f| wanted.touches(f)) {
      // The first entry of an edited field takes the new value in place, under its own key.
      if !std::mem::replace(&mut done[f as usize], true) {
        if let Some(v) = wanted.value(f) {
          let k = Some(name.as_str()).filter(|k| valid_key(k)).unwrap_or(canonical(f));
          out.push((k.to_string(), v.to_string()));
        }
      }
      continue;
    }
    // lofty writes "KEY=value" back byte-for-byte, but skips an empty value and an invalid key.
    let kept = key(raw).and_then(|k| {
      let k = std::str::from_utf8(k).ok()?;
      let v = std::str::from_utf8(&raw[k.len() + 1..]).ok()?;
      (valid_key(k) && !v.is_empty()).then(|| (k.to_string(), v.to_string()))
    });
    out.push(kept.ok_or_else(|| {
      refused(
        path,
        format!("the comment {name:?} cannot be kept byte-for-byte; nothing was written"),
      )
    })?);
  }
  for f in Field::ALL {
    if !done[f as usize] {
      if let Some(v) = wanted.value(f) {
        out.push((canonical(f).to_string(), v.to_string()));
      }
    }
  }
  Ok(out)
}

/// The pre-write check: `vc` encoded in memory must keep every untouched comment and picture.
fn precheck(
  path: &Path,
  before: Option<&Comments>,
  vc: &VorbisComments,
  wanted: &Wanted,
  options: WriteOptions,
  kind: &str,
) -> Result<()> {
  let mut encoded = Vec::new();
  vc.dump_to(&mut encoded, options)
    .map_err(|e| lofty_error(path, "cannot encode the comments", &e))?;
  let (rebuilt, _) =
    parse_comments(&encoded).ok_or_else(|| refused(path, "the rebuilt comments are invalid; nothing was written"))?;
  let before = before.map(|c| comment_items(c, kind)).unwrap_or_default();
  ensure_kept(path, &before, &comment_items(&rebuilt, kind), wanted)
}

/// One FLAC file's metadata.
pub(super) struct FlacMeta {
  comments: Option<Comments>,
  /// PICTURE block contents, in order.
  pictures: Vec<Vec<u8>>,
  /// STREAMINFO, SEEKTABLE, APPLICATION, CUESHEET, a leading ID3v2 tag, the audio frames.
  container: Vec<Item>,
}

fn block_name(ty: u8) -> String {
  match ty {
    0 => "STREAMINFO".into(),
    2 => "APPLICATION".into(),
    3 => "SEEKTABLE".into(),
    5 => "CUESHEET".into(),
    other => format!("type {other}"),
  }
}

pub(super) fn parse_flac(path: &Path) -> Result<FlacMeta> {
  let mut src = Source::open(path)?;
  let mut container = Vec::new();
  let mut pos = 0u64;
  let head = src.peek(0, 10)?;
  if head.len() == 10 && &head[..3] == b"ID3" {
    let footer = if head[3] == 4 && head[5] & 0x10 != 0 { 10 } else { 0 };
    pos = 10 + u64::from(syncsafe(&head[6..10])) + footer;
    container.push(Item::hashed(
      "the ID3v2 tag before the FLAC stream",
      pos,
      src.hash_range(0, pos)?,
    ));
  }
  if src.read_at(pos, 4)? != b"fLaC" {
    return Err(src.malformed("no FLAC stream marker"));
  }
  pos += 4;
  let (mut comments, mut pictures) = (None, Vec::new());
  loop {
    let h = src.read_at(pos, 4)?;
    let (last, ty, len) = (h[0] & 0x80 != 0, h[0] & 0x7f, u64::from(be24(&h[1..4])));
    let (start, end) = (pos + 4, pos + 4 + len);
    match ty {
      1 => {} // PADDING: lofty adds one when there was none
      4 if comments.is_some() => return Err(refused(path, "the file has more than one VORBIS_COMMENT block")),
      4 => {
        let block = src.read_at(start, len)?;
        let parsed = parse_comments(&block).ok_or_else(|| src.malformed("the VORBIS_COMMENT block is malformed"))?;
        comments = Some(parsed.0);
      }
      6 => pictures.push(src.read_at(start, len)?),
      127 => return Err(src.malformed("an invalid FLAC metadata block")),
      _ => container.push(Item::hashed(
        format!("the FLAC {} block", block_name(ty)),
        len,
        src.hash_range(start, end)?,
      )),
    }
    pos = end;
    if last {
      break;
    }
  }
  container.push(Item::hashed(
    "the FLAC audio frames",
    src.len - pos,
    src.hash_range(pos, src.len)?,
  ));
  Ok(FlacMeta {
    comments,
    pictures,
    container,
  })
}

impl FlacMeta {
  pub(super) fn items(&self) -> Vec<Item> {
    let mut items = self.container.clone();
    if let Some(c) = &self.comments {
      items.extend(comment_items(c, "FLAC"));
    }
    for p in &self.pictures {
      items.push(Item::of(Group::Picture, None, "a FLAC PICTURE block", p));
    }
    items
  }
}

/// Rewrites the FLAC comments with `wanted` applied; returns the edit as applied.
pub(super) fn write_flac(path: &Path, meta: &FlacMeta, wanted: Wanted) -> Result<Wanted> {
  let wanted = if meta.comments.is_some() {
    wanted
  } else {
    wanted.seeded(path)?
  };
  let items = rebuild(path, meta.comments.as_ref(), &wanted, true)?;
  let mut flac = FlacFile::read_from(&mut BufReader::new(File::open(path)?), parse_options())
    .map_err(|e| lofty_error(path, "cannot read the FLAC file", &e))?;
  // lofty re-encodes the PICTURE blocks it parsed; they must come out as they went in.
  let pictures: Vec<Vec<u8>> = flac
    .pictures()
    .iter()
    .map(|(p, info)| p.as_flac_bytes(*info, false))
    .collect();
  if pictures != meta.pictures {
    return Err(refused(
      path,
      "a FLAC PICTURE block cannot be kept byte-for-byte; nothing was written",
    ));
  }
  let mut vc = flac.remove_vorbis_comments().unwrap_or_default();
  let _ = vc.take_items();
  for (k, v) in items {
    vc.push(k, v);
  }
  let options = write_options(false);
  precheck(path, meta.comments.as_ref(), &vc, &wanted, options, "FLAC")?;
  let _ = flac.set_vorbis_comments(vc);
  // A FLAC's ID3v2 tag is read-only in lofty; out of the struct, it is left in the file untouched.
  let _ = flac.remove_id3v2();
  let mut file = OpenOptions::new().read(true).write(true).open(path)?;
  flac
    .save_to(&mut file, options)
    .map_err(|e| lofty_error(path, "cannot write the FLAC tags", &e))?;
  Ok(wanted)
}

/// One Ogg file's metadata (the first logical stream; multiplexed files are refused).
pub(super) struct OggMeta {
  comments: Comments,
  /// The identification and setup headers, extra Opus comment data, and the audio pages.
  container: Vec<Item>,
}

pub(super) fn parse_ogg(path: &Path, codec: Codec) -> Result<OggMeta> {
  let mut src = Source::open(path)?;
  let headers = if codec == Codec::Vorbis { 3 } else { 2 };
  let (mut packets, mut partial) = (Vec::<Vec<u8>>::new(), Vec::new());
  let mut serial = None;
  let mut audio = blake3::Hasher::new();
  let mut audio_pages = 0u64;
  let mut pos = 0u64;
  while pos < src.len {
    let h = src.read_at(pos, 27)?;
    if &h[..4] != b"OggS" {
      return Err(src.malformed(format!("no Ogg page at offset {pos}")));
    }
    let lacing = src.read_at(pos + 27, u64::from(h[26]))?;
    let body = pos + 27 + u64::from(h[26]);
    let body_len: u64 = lacing.iter().map(|&l| u64::from(l)).sum();
    let page_serial = le32(&h[14..18]);
    if *serial.get_or_insert(page_serial) != page_serial {
      return Err(refused(path, "Ogg files with more than one stream are not written yet"));
    }
    if packets.len() < headers {
      let data = src.read_at(body, body_len)?;
      let mut at = 0usize;
      for &l in &lacing {
        if packets.len() == headers {
          return Err(refused(path, "audio data shares a page with the Ogg headers"));
        }
        partial.extend_from_slice(&data[at..at + usize::from(l)]);
        at += usize::from(l);
        if l < 255 {
          packets.push(std::mem::take(&mut partial));
        }
      }
    } else {
      // Version, header type, granule position and serial; not the sequence number or the CRC,
      // which lofty renumbers when the header pages change.
      audio.update(&h[4..18]);
      audio.update(&lacing);
      src.hash_into(&mut audio, body, body + body_len)?;
      audio_pages += 1;
    }
    pos = body + body_len;
  }
  if packets.len() < headers {
    return Err(src.malformed("the Ogg header packets are incomplete"));
  }
  let signature: &[u8] = match codec {
    Codec::Vorbis => b"\x03vorbis",
    Codec::Opus => b"OpusTags",
    Codec::Speex => b"",
  };
  let packet = &packets[1];
  let (comments, used) = packet
    .strip_prefix(signature)
    .and_then(parse_comments)
    .ok_or_else(|| src.malformed("the Ogg comment header is malformed"))?;
  let mut container = vec![Item::of(
    Group::Container,
    None,
    "the Ogg identification header",
    &packets[0],
  )];
  if codec == Codec::Vorbis {
    container.push(Item::of(Group::Container, None, "the Ogg setup header", &packets[2]));
  }
  // Opus: data after the comments is padding, unless its first bit says to keep it.
  let rest = &packet[signature.len() + used..];
  if codec == Codec::Opus && rest.first().is_some_and(|b| b & 1 == 1) {
    container.push(Item::of(
      Group::Container,
      None,
      "the extra data after the Opus comments",
      rest,
    ));
  }
  container.push(Item::hashed(
    "the Ogg audio pages",
    audio_pages,
    *audio.finalize().as_bytes(),
  ));
  Ok(OggMeta { comments, container })
}

impl OggMeta {
  pub(super) fn items(&self) -> Vec<Item> {
    let mut items = self.container.clone();
    items.extend(comment_items(&self.comments, "Ogg"));
    items
  }
}

/// Rewrites the Ogg comment header with `wanted` applied; returns the edit as applied.
pub(super) fn write_ogg(path: &Path, meta: &OggMeta, codec: Codec, wanted: Wanted) -> Result<Wanted> {
  let items = rebuild(path, Some(&meta.comments), &wanted, false)?;
  let mut reader = BufReader::new(File::open(path)?);
  let read_error = |e: lofty::error::FileParseError| lofty_error(path, "cannot read the Ogg file", &e);
  let mut vc = match codec {
    Codec::Vorbis => VorbisFile::read_from(&mut reader, parse_options())
      .map_err(read_error)?
      .remove_vorbis_comments(),
    Codec::Opus => OpusFile::read_from(&mut reader, parse_options())
      .map_err(read_error)?
      .remove_vorbis_comments(),
    Codec::Speex => SpeexFile::read_from(&mut reader, parse_options())
      .map_err(read_error)?
      .remove_vorbis_comments(),
  };
  let _ = vc.take_items();
  for (k, v) in items {
    vc.push(k, v);
  }
  let options = write_options(false);
  precheck(path, Some(&meta.comments), &vc, &wanted, options, "Ogg")?;
  vc.save_to_path(path, options)
    .map_err(|e| lofty_error(path, "cannot write the Ogg tags", &e))?;
  Ok(wanted)
}

/// A file's raw comments and (FLAC) PICTURE blocks, for tests. `codec` is `None` for FLAC.
#[cfg(test)]
pub(super) fn raw_comments(path: &Path, codec: Option<Codec>) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
  match codec {
    None => {
      let meta = parse_flac(path).expect("parse the FLAC metadata");
      (meta.comments.map(|c| c.items).unwrap_or_default(), meta.pictures)
    }
    Some(codec) => {
      let meta = parse_ogg(path, codec).expect("parse the Ogg metadata");
      (meta.comments.items, Vec::new())
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::model::TagSet;

  fn list(vendor: &[u8], items: &[&[u8]]) -> Vec<u8> {
    let mut b = (vendor.len() as u32).to_le_bytes().to_vec();
    b.extend_from_slice(vendor);
    b.extend_from_slice(&(items.len() as u32).to_le_bytes());
    for i in items {
      b.extend_from_slice(&(i.len() as u32).to_le_bytes());
      b.extend_from_slice(i);
    }
    b
  }

  #[test]
  fn parses_a_comment_list_and_reports_its_length() {
    let mut b = list(b"enc", &[b"TITLE=a", b"x=y"]);
    let used = b.len();
    b.push(1); // Vorbis framing bit
    let (c, n) = parse_comments(&b).unwrap();
    assert_eq!((c.vendor.as_slice(), c.items.len(), n), (&b"enc"[..], 2, used));
  }

  #[test]
  fn a_truncated_comment_list_is_rejected() {
    let b = list(b"enc", &[b"TITLE=a"]);
    assert!(parse_comments(&b[..b.len() - 1]).is_none());
    let mut huge = list(b"enc", &[]);
    huge[7..11].copy_from_slice(&u32::MAX.to_le_bytes()); // a count the buffer cannot hold
    assert!(parse_comments(&huge).is_none());
  }

  #[test]
  fn keys_classify_case_insensitively() {
    assert_eq!(classify(b"title=x"), (Group::Tag, Some(Field::Title)));
    assert_eq!(classify(b"Album Artist=x"), (Group::Tag, Some(Field::AlbumArtist)));
    assert_eq!(classify(b"YEAR=1999"), (Group::Tag, Some(Field::Year)));
    assert_eq!(classify(b"metadata_block_picture=AAAA"), (Group::Picture, None));
    assert_eq!(classify(b"DESCRIPTION=x"), (Group::Tag, None));
    assert_eq!(classify(b"TITLE"), (Group::Tag, None), "no separator, no field");
  }

  #[test]
  fn rebuild_keeps_untouched_entries_and_edits_in_place() {
    let c = Comments {
      vendor: b"v".to_vec(),
      items: vec![
        b"title=Old".to_vec(),
        b"REPLAYGAIN_TRACK_GAIN=-6.48 dB".to_vec(),
        b"ARTIST=One".to_vec(),
        b"ARTIST=Two".to_vec(),
      ],
    };
    let wanted = Wanted::new(&TagSet {
      title: Some("New".into()),
      artist: Some("Both".into()),
      album: Some("Album".into()),
      ..TagSet::default()
    });
    let out = rebuild(Path::new("t.flac"), Some(&c), &wanted, true).unwrap();
    let pairs: Vec<(&str, &str)> = out.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    assert_eq!(
      pairs,
      [
        ("title", "New"),
        ("REPLAYGAIN_TRACK_GAIN", "-6.48 dB"),
        ("ARTIST", "Both"),
        ("ALBUM", "Album")
      ]
    );
  }

  #[test]
  fn rebuild_refuses_what_lofty_would_drop() {
    let wanted = Wanted::new(&TagSet {
      title: Some("New".into()),
      ..TagSet::default()
    });
    for bad in [&b"EMPTY="[..], b"NOSEPARATOR", b"BAD\xffVALUE=\xff", b"COVERART=AAAA"] {
      let c = Comments {
        vendor: Vec::new(),
        items: vec![bad.to_vec()],
      };
      let err = rebuild(Path::new("t.ogg"), Some(&c), &wanted, false).unwrap_err();
      assert!(matches!(err, crate::Error::Refused(_)), "{bad:?}: {err}");
    }
    let picture = Comments {
      vendor: Vec::new(),
      items: vec![b"METADATA_BLOCK_PICTURE=AAAA".to_vec()],
    };
    assert!(rebuild(Path::new("t.flac"), Some(&picture), &wanted, true).is_err());
    assert!(rebuild(Path::new("t.ogg"), Some(&picture), &wanted, false).is_ok());
  }
}
