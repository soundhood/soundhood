//! MP4 (m4a, m4b, mp4, AAC/ALAC in MP4): the `moov.udta.meta.ilst` atoms.
//!
//! The new `Ilst` is built from the file's own atom bytes: every atom outside the `TagSet` fields
//! becomes `AtomData::Unknown { code, data }` with its original type code and payload, which lofty
//! writes back byte-for-byte (its typed values would not: a 2-byte `tmpo` comes back as 4 bytes, an
//! unknown `covr` type is dropped). Edited atoms keep their position; new ones go at the end.

use super::bytes::{be24, be32, be64, Source};
use super::{crowded, ensure_kept, lofty_error, refused, write_options, Field, Group, Item, Wanted};
use crate::error::Result;
use lofty::mp4::{Atom, AtomData, AtomIdent, DataType, Ilst};
use lofty::tag::TagExt;
use std::borrow::Cow;
use std::path::Path;

/// The parsed metadata of one MP4 file.
pub(super) struct Meta {
  /// `ilst` children in file order, padding (`free`, `skip`) left out.
  atoms: Vec<RawAtom>,
  has_ilst: bool,
  /// Boxes a tag write must leave alone: other top-level boxes, `mdat` payloads, `udta` siblings of
  /// `meta`.
  container: Vec<Item>,
}

struct RawAtom {
  kind: [u8; 4],
  /// The whole child box, header included.
  bytes: Vec<u8>,
  label: String,
  field: Option<Field>,
}

/// One box inside a buffer: `start..end` is the whole box, `body` the offset after its header.
struct BoxRef {
  kind: [u8; 4],
  start: usize,
  body: usize,
  end: usize,
}

/// The boxes laid out back to back in `buf[from..to]`.
fn children(buf: &[u8], from: usize, to: usize) -> std::result::Result<Vec<BoxRef>, String> {
  let mut out = Vec::new();
  let mut pos = from;
  while pos + 8 <= to {
    let mut kind = [0u8; 4];
    kind.copy_from_slice(&buf[pos + 4..pos + 8]);
    let (header, size) = match be32(&buf[pos..]) {
      0 => (8, (to - pos) as u64),
      1 if pos + 16 <= to => (16, be64(&buf[pos + 8..])),
      1 => return Err(format!("truncated {} box", fourcc(kind))),
      n => (8, u64::from(n)),
    };
    let end = usize::try_from(size)
      .ok()
      .and_then(|s| pos.checked_add(s))
      .filter(|&e| size >= header as u64 && e <= to)
      .ok_or_else(|| format!("the {} box at {pos} has an impossible size", fourcc(kind)))?;
    out.push(BoxRef {
      kind,
      start: pos,
      body: pos + header,
      end,
    });
    pos = end;
  }
  Ok(out)
}

/// A fourcc for messages: `©` for 0xA9, `?` for anything unprintable.
fn fourcc(kind: [u8; 4]) -> String {
  kind
    .iter()
    .map(|&b| match b {
      0xa9 => '©',
      b if b.is_ascii_graphic() || b == b' ' => b as char,
      _ => '?',
    })
    .collect()
}

const FREEFORM: [u8; 4] = *b"----";

/// The atoms behind each `TagSet` field. `gnre` (the numeric ID3v1 genre) is read as the genre, so a
/// genre edit replaces it with `©gen`.
fn field_of(kind: [u8; 4]) -> Option<Field> {
  match &kind {
    b"\xa9nam" => Some(Field::Title),
    b"\xa9ART" => Some(Field::Artist),
    b"\xa9alb" => Some(Field::Album),
    b"aART" => Some(Field::AlbumArtist),
    b"\xa9gen" | b"gnre" => Some(Field::Genre),
    b"\xa9day" => Some(Field::Year),
    b"\xa9cmt" => Some(Field::Comment),
    _ => None,
  }
}

/// The fourcc a field is written as.
fn kind_of(field: Field) -> [u8; 4] {
  match field {
    Field::Title => *b"\xa9nam",
    Field::Artist => *b"\xa9ART",
    Field::Album => *b"\xa9alb",
    Field::AlbumArtist => *b"aART",
    Field::Genre => *b"\xa9gen",
    Field::Year => *b"\xa9day",
    Field::Comment => *b"\xa9cmt",
  }
}

/// The `mean` and `name` strings of a freeform (`----`) atom, as raw bytes after their version and
/// flags.
fn freeform_names(atom: &[u8], body: usize) -> (Option<&[u8]>, Option<&[u8]>) {
  let (mut mean, mut name) = (None, None);
  for k in children(atom, body, atom.len()).unwrap_or_default() {
    let payload = atom.get(k.body + 4..k.end);
    match &k.kind {
      b"mean" => mean = payload,
      b"name" => name = payload,
      _ => {}
    }
  }
  (mean, name)
}

/// The `ilst` children in `buf[from..to]`.
fn atoms(buf: &[u8], from: usize, to: usize) -> std::result::Result<Vec<RawAtom>, String> {
  let mut out = Vec::new();
  for b in children(buf, from, to)? {
    if matches!(&b.kind, b"free" | b"skip") {
      continue;
    }
    let bytes = buf[b.start..b.end].to_vec();
    let label = if b.kind == FREEFORM {
      let (mean, name) = freeform_names(&bytes, b.body - b.start);
      let text = |s: Option<&[u8]>| String::from_utf8_lossy(s.unwrap_or_default()).into_owned();
      format!("----:{}:{}", text(mean), text(name))
    } else {
      fourcc(b.kind)
    };
    out.push(RawAtom {
      kind: b.kind,
      bytes,
      label,
      field: field_of(b.kind),
    });
  }
  Ok(out)
}

/// The atoms of `moov.udta.meta.ilst` (the only `ilst` lofty reads and writes).
pub(super) fn parse(path: &Path) -> Result<Meta> {
  let mut src = Source::open(path)?;
  let mut container = Vec::new();
  let mut moov = None;
  let mut pos = 0u64;
  let mut mdats = 0;
  while pos + 8 <= src.len {
    let head = src.read_at(pos, 8)?;
    let mut kind = [0u8; 4];
    kind.copy_from_slice(&head[4..8]);
    let (header, size) = match be32(&head) {
      0 => (8, src.len - pos),
      1 => (16, be64(&src.read_at(pos + 8, 8)?)),
      n => (8, u64::from(n)),
    };
    if size < header || pos.checked_add(size).is_none_or(|e| e > src.len) {
      return Err(src.malformed(format!("the {} box at {pos} has an impossible size", fourcc(kind))));
    }
    match &kind {
      b"moov" if moov.is_some() => return Err(refused("the file has more than one moov box")),
      b"moov" => moov = Some(src.read_at(pos, size)?),
      b"mdat" => {
        let hash = src.hash_range(pos + header, pos + size)?;
        container.push(Item::hashed(format!("MP4 mdat #{mdats} payload"), size - header, hash));
        mdats += 1;
      }
      b"free" | b"skip" => {}
      _ => {
        let hash = src.hash_range(pos, pos + size)?;
        container.push(Item::hashed(format!("MP4 {} box", fourcc(kind)), size, hash));
      }
    }
    pos += size;
  }
  let moov = moov.ok_or_else(|| src.malformed("no moov box"))?;
  let bad = |e: String| src.malformed(e);

  let moov_kids = children(&moov, 8, moov.len()).map_err(bad)?;
  let udtas: Vec<&BoxRef> = moov_kids.iter().filter(|b| &b.kind == b"udta").collect();
  if udtas.len() > 1 {
    return Err(refused("the file has more than one moov.udta box"));
  }
  let mut ilst = None;
  if let Some(udta) = udtas.first() {
    let mut meta = None;
    for b in children(&moov, udta.body, udta.end).map_err(bad)? {
      if &b.kind == b"meta" && meta.is_none() {
        meta = Some(b);
      } else {
        container.push(Item::of(
          Group::Container,
          None,
          format!("MP4 udta.{} box", fourcc(b.kind)),
          &moov[b.start..b.end],
        ));
      }
    }
    if let Some(meta) = meta {
      // A "full" meta box carries 4 bytes of version and flags before its children; some
      // QuickTime files omit them (the same test lofty uses).
      let full = !matches!(
        moov.get(meta.body + 4..meta.body + 8),
        Some(b"hdlr" | b"ilst" | b"mhdr" | b"ctry" | b"lang")
      );
      let first = meta.body + if full { 4 } else { 0 };
      ilst = children(&moov, first.min(meta.end), meta.end)
        .map_err(bad)?
        .into_iter()
        .find(|b| &b.kind == b"ilst");
    }
  }
  let atoms = match &ilst {
    Some(b) => atoms(&moov, b.body, b.end).map_err(bad)?,
    None => Vec::new(),
  };
  for (n, trak) in moov_kids.iter().filter(|b| &b.kind == b"trak").enumerate() {
    if let Some(item) = track_samples(&moov, trak, n, &mut src)? {
      container.push(item);
    }
  }
  Ok(Meta {
    atoms,
    has_ilst: ilst.is_some(),
    container,
  })
}

/// The first child of `parent` with this kind.
fn child(buf: &[u8], parent: &BoxRef, kind: &[u8; 4]) -> Option<BoxRef> {
  children(buf, parent.body, parent.end)
    .ok()?
    .into_iter()
    .find(|b| &b.kind == kind)
}

/// The `count` big-endian integers of `width` bytes at `at` in a box body, if they fit.
fn table(body: &[u8], at: usize, count: usize, width: usize) -> Option<Vec<u64>> {
  let bytes = body.get(at..at.checked_add(count.checked_mul(width)?)?)?;
  Some(
    bytes
      .chunks_exact(width)
      .map(|c| if width == 8 { be64(c) } else { u64::from(be32(c)) })
      .collect(),
  )
}

/// One track's sample bytes, found through its sample tables (stsz, stsc, stco / co64). lofty
/// rewrites every chunk offset when a growing `moov` sits in front of `mdat`; this proves each
/// sample is still where the tables say, unchanged. `None` when the tables cannot be followed
/// (fragmented files keep their samples in `moof`, which the top-level boxes cover).
fn track_samples(moov: &[u8], trak: &BoxRef, n: usize, src: &mut Source) -> Result<Option<Item>> {
  let Some(stbl) = child(moov, trak, b"mdia")
    .and_then(|m| child(moov, &m, b"minf"))
    .and_then(|m| child(moov, &m, b"stbl"))
  else {
    return Ok(None);
  };
  let body = |b: &BoxRef| &moov[b.body..b.end];
  let count_at = |b: &[u8], at: usize| b.get(at..at + 4).map(|c| be32(c) as usize);
  // stsz: version/flags, one size for every sample (or 0), the sample count, then the sizes.
  let Some(stsz) = child(moov, &stbl, b"stsz") else {
    return Ok(None);
  };
  let stsz = body(&stsz);
  let (Some(fixed), Some(samples)) = (count_at(stsz, 4), count_at(stsz, 8)) else {
    return Ok(None);
  };
  let sizes = if fixed == 0 {
    table(stsz, 12, samples, 4)
  } else {
    Some(Vec::new())
  };
  // stsc: (first chunk, samples per chunk, description index) runs.
  let runs = child(moov, &stbl, b"stsc").and_then(|b| {
    let b = body(&b);
    table(b, 8, count_at(b, 4)?.checked_mul(3)?, 4)
  });
  let offsets = match (child(moov, &stbl, b"stco"), child(moov, &stbl, b"co64")) {
    (Some(b), _) => count_at(body(&b), 4).and_then(|c| table(body(&b), 8, c, 4)),
    (None, Some(b)) => count_at(body(&b), 4).and_then(|c| table(body(&b), 8, c, 8)),
    (None, None) => None,
  };
  let (Some(sizes), Some(runs), Some(offsets)) = (sizes, runs, offsets) else {
    return Ok(None);
  };
  let runs: Vec<&[u64]> = runs.chunks_exact(3).collect();
  let (mut run, mut sample) = (0usize, 0usize);
  let mut ranges = Vec::with_capacity(offsets.len());
  for (i, &offset) in offsets.iter().enumerate() {
    // Chunks are numbered from 1; a run applies from its first chunk until the next run starts.
    let chunk = i as u64 + 1;
    while run + 1 < runs.len() && runs[run + 1][0] <= chunk {
      run += 1;
    }
    let per_chunk = runs.get(run).filter(|r| r[0] <= chunk).map_or(0, |r| r[1]);
    let last = sample
      .saturating_add(usize::try_from(per_chunk).unwrap_or(usize::MAX))
      .min(samples);
    let len: u64 = if fixed == 0 {
      sizes.get(sample..last).map_or(0, |s| s.iter().sum())
    } else {
      fixed as u64 * (last - sample) as u64
    };
    sample = last;
    match offset.checked_add(len) {
      Some(end) if end <= src.len => ranges.push((offset, end)),
      _ => return Ok(None),
    }
  }
  let mut hasher = blake3::Hasher::new();
  let mut total = 0;
  for (start, end) in ranges {
    src.hash_into(&mut hasher, start, end)?;
    total += end - start;
  }
  Ok(Some(Item::hashed(
    format!("MP4 track {n} sample data"),
    total,
    *hasher.finalize().as_bytes(),
  )))
}

impl Meta {
  pub(super) fn items(&self) -> Vec<Item> {
    let mut items = self.container.clone();
    items.extend(atom_items(&self.atoms));
    items
  }

  /// The first field `wanted` edits that holds more than one value here: more than one atom for it
  /// (`gnre` and `©gen` both count as genre), or one atom with several `data` boxes (how Picard
  /// stores several artists).
  pub(super) fn several(&self, wanted: &Wanted) -> Option<Field> {
    crowded(wanted, |f| {
      self
        .atoms
        .iter()
        .filter(|a| a.field == Some(f))
        .map(|a| data_boxes(&a.bytes).max(1))
        .sum()
    })
  }
}

/// How many `data` boxes an `ilst` atom holds.
fn data_boxes(atom: &[u8]) -> usize {
  let header = if be32(atom) == 1 { 16 } else { 8 };
  children(atom, header.min(atom.len()), atom.len())
    .map(|kids| kids.iter().filter(|k| &k.kind == b"data").count())
    .unwrap_or(1)
}

fn atom_items(atoms: &[RawAtom]) -> Vec<Item> {
  atoms
    .iter()
    .map(|a| Item::of(Group::Tag, a.field, format!("MP4 atom {}", a.label), &a.bytes))
    .collect()
}

/// The atom as lofty can write it back, or why it cannot.
fn to_lofty(a: &RawAtom) -> std::result::Result<Atom<'static>, String> {
  let header = if be32(&a.bytes) == 1 { 16 } else { 8 };
  let (mut mean, mut name, mut data) = (None, None, Vec::new());
  for k in children(&a.bytes, header, a.bytes.len())? {
    let payload = &a.bytes[k.body..k.end];
    match &k.kind {
      b"mean" | b"name" if a.kind == FREEFORM => {
        let text = payload
          .get(4..)
          .and_then(|s| std::str::from_utf8(s).ok())
          .ok_or("its freeform name is not UTF-8")?
          .to_string();
        if &k.kind == b"mean" {
          mean = Some(text);
        } else {
          name = Some(text);
        }
      }
      b"data" => {
        if payload.len() < 8 {
          return Err("a data box is truncated".into());
        }
        if payload[0] != 0 {
          return Err("a data box uses an unknown type set".into());
        }
        // Type code (24 bits), then a 4-byte locale lofty always writes as zero (checked by the
        // pre-write comparison), then the payload, kept verbatim.
        data.push(AtomData::Unknown {
          code: DataType::from(be24(&payload[1..4])),
          data: payload[8..].to_vec(),
        });
      }
      other => return Err(format!("it holds a {} box", fourcc(*other))),
    }
  }
  let ident = if a.kind == FREEFORM {
    match (mean, name) {
      (Some(mean), Some(name)) => AtomIdent::Freeform {
        mean: Cow::Owned(mean),
        name: Cow::Owned(name),
      },
      _ => return Err("its freeform mean/name is incomplete".into()),
    }
  } else {
    AtomIdent::Fourcc(a.kind)
  };
  Atom::from_collection(ident, data).ok_or_else(|| "it holds no data box".into())
}

/// Rewrites the `ilst` with `wanted` applied; returns the edit as applied.
pub(super) fn write(path: &Path, meta: &Meta, wanted: Wanted) -> Result<Wanted> {
  let wanted = if meta.has_ilst { wanted } else { wanted.seeded(path)? };
  let mut ilst = Ilst::new();
  let mut done = [false; 7];
  let text = |f: Field, v: &str| Atom::new(AtomIdent::Fourcc(kind_of(f)), AtomData::UTF8(v.to_string()));
  for a in &meta.atoms {
    match a.field.filter(|&f| wanted.touches(f)) {
      // The first atom of an edited field takes the new value in place; the others go.
      Some(f) => {
        if !std::mem::replace(&mut done[f as usize], true) {
          if let Some(v) = wanted.value(f) {
            ilst.insert(text(f, v));
          }
        }
      }
      None => {
        let atom =
          to_lofty(a).map_err(|why| refused(format!("the MP4 atom {} cannot be rewritten: {why}", a.label)))?;
        ilst.insert(atom);
      }
    }
  }
  for f in Field::ALL {
    if !done[f as usize] {
      if let Some(v) = wanted.value(f) {
        ilst.insert(text(f, v));
      }
    }
  }

  let options = write_options(false);
  let mut encoded = Vec::new();
  ilst
    .dump_to(&mut encoded, options)
    .map_err(|e| lofty_error("cannot encode the MP4 tags", &e))?;
  let rebuilt = if encoded.is_empty() {
    Vec::new()
  } else {
    atoms(&encoded, 8, encoded.len()).map_err(|e| refused(format!("the rebuilt ilst is invalid: {e}")))?
  };
  ensure_kept(&atom_items(&meta.atoms), &atom_items(&rebuilt), &wanted)?;

  ilst
    .save_to_path(path, options)
    .map_err(|e| lofty_error("cannot write the MP4 tags", &e))?;
  Ok(wanted)
}

/// The `ilst` atoms of a file as (label, whole box bytes), for tests.
#[cfg(test)]
pub(super) fn raw_atoms(path: &Path) -> Vec<(String, Vec<u8>)> {
  let meta = parse(path).expect("parse the MP4 metadata");
  meta.atoms.into_iter().map(|a| (a.label, a.bytes)).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    b.extend_from_slice(kind);
    b.extend_from_slice(body);
    b
  }

  #[test]
  fn children_handle_64_bit_and_open_ended_sizes() {
    let mut buf = boxed(b"aaaa", b"xy");
    // A 64-bit size (size field 1) and a last box that runs to the end (size field 0).
    buf.extend_from_slice(&1u32.to_be_bytes());
    buf.extend_from_slice(b"bbbb");
    buf.extend_from_slice(&17u64.to_be_bytes());
    buf.push(7);
    buf.extend_from_slice(&0u32.to_be_bytes());
    buf.extend_from_slice(b"cccc");
    buf.extend_from_slice(b"rest");
    let kids = children(&buf, 0, buf.len()).unwrap();
    let kinds: Vec<[u8; 4]> = kids.iter().map(|k| k.kind).collect();
    assert_eq!(kinds, [*b"aaaa", *b"bbbb", *b"cccc"]);
    assert_eq!((kids[1].body, kids[1].end), (10 + 16, 10 + 17));
    assert_eq!(&buf[kids[2].body..kids[2].end], b"rest");
  }

  #[test]
  fn children_refuse_an_impossible_size() {
    let mut buf = boxed(b"aaaa", b"xy");
    buf[3] = 200; // claims 200 bytes in a 10-byte buffer
    assert!(children(&buf, 0, buf.len()).is_err());
    buf[3] = 4; // smaller than its own header
    assert!(children(&buf, 0, buf.len()).is_err());
  }

  #[test]
  fn freeform_atoms_are_labelled_by_mean_and_name() {
    let mut full = vec![0u8; 4];
    full.extend_from_slice(b"com.apple.iTunes");
    let mut body = boxed(b"mean", &full);
    let mut name = vec![0u8; 4];
    name.extend_from_slice(b"iTunSMPB");
    body.extend(boxed(b"name", &name));
    body.extend(boxed(b"data", &[0, 0, 0, 1, 0, 0, 0, 0, b'x']));
    let ilst = boxed(b"----", &body);
    let parsed = atoms(&ilst, 0, ilst.len()).unwrap();
    assert_eq!(parsed[0].label, "----:com.apple.iTunes:iTunSMPB");
    assert_eq!(parsed[0].field, None);
    let atom = to_lofty(&parsed[0]).unwrap();
    assert!(matches!(atom.ident(), AtomIdent::Freeform { name, .. } if name == "iTunSMPB"));
  }

  #[test]
  fn a_data_box_with_another_type_set_cannot_be_rewritten() {
    let ilst = boxed(b"\xa9too", &boxed(b"data", &[1, 0, 0, 1, 0, 0, 0, 0, b'x']));
    let parsed = atoms(&ilst, 0, ilst.len()).unwrap();
    assert!(to_lofty(&parsed[0]).unwrap_err().contains("type set"));
  }
}
