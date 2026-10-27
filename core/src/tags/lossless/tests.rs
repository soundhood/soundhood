//! Lossless write tests on realistic files: copies of `core/fixtures/audio/tone.*` dressed with
//! lofty's concrete APIs (the items a mixed-source library holds: gapless info, normalisation data,
//! private frames, pictures, ReplayGain, custom keys, ID3v1 and APE trailers), then edited through
//! `tags::write` and checked item by item.

use super::*;
use crate::tags::{cover_art, read, verify, TagRead};
use lofty::config::{ParseOptions as LoftyParse, WriteOptions};
use lofty::file::AudioFile;
use lofty::flac::FlacFile;
use lofty::id3::v2::{
  AttachedPictureFrame, BinaryFrame, CommentFrame, ExtendedTextFrame, Frame, FrameId, Id3v2Tag, PrivateFrame,
  TextInformationFrame, UnsynchronizedTextFrame,
};
use lofty::mp4::{Atom, AtomData, AtomIdent, DataType, Mp4File};
use lofty::ogg::{OggPictureStorage, OpusFile, VorbisFile};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, ItemKey, Tag, TagExt, TagType};
use lofty::TextEncoding;
use std::borrow::Cow;
use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;

/// A 1x1 PNG, enough for lofty to embed and hand back byte-for-byte.
const PNG: &[u8] = &[
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d,
  0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/// iTunes gapless info (encoder delay, padding, sample count) and normalisation data, as iTunes writes them.
const ITUNSMPB: &str =
  " 00000000 00000840 000001C0 0000000000010E00 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000";
const ITUNNORM: &str = " 0000044E 0000044E 00002F5D 00002F5D 00000000 00000000 00007E1F 00007E1F 00000000 00000000";

/// Every format the rich fixtures cover.
const RICH: [&str; 6] = ["m4a", "mp3", "mp3v24", "flac", "opus", "ogg"];

fn fixture(ext: &str) -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("fixtures/audio/tone.{ext}"))
}

/// A writable copy of a template in its own temp dir (the templates are never written).
fn copy_of(ext: &str) -> (tempfile::TempDir, PathBuf) {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join(format!("Tone - Fixture.{ext}"));
  fs::copy(fixture(ext), &path).unwrap();
  (dir, path)
}

fn set(f: impl FnOnce(&mut TagSet)) -> TagSet {
  let mut t = TagSet::default();
  f(&mut t);
  t
}

fn title_and_artist() -> TagSet {
  set(|t| {
    t.title = Some("New Title".into());
    t.artist = Some("New Artist".into());
  })
}

fn front_cover() -> Picture {
  Picture::unchecked(PNG.to_vec())
    .pic_type(PictureType::CoverFront)
    .mime_type(MimeType::Png)
    .description("front".to_string())
    .build()
}

fn freeform(mean: &str, name: &str, value: &str) -> Atom<'static> {
  Atom::new(
    AtomIdent::Freeform {
      mean: Cow::Owned(mean.into()),
      name: Cow::Owned(name.into()),
    },
    AtomData::UTF8(value.into()),
  )
}

/// An m4a as iTunes and taggers leave it: cover, lyrics, track/disc, compilation flag, a 2-byte
/// `tmpo` (lofty itself would write 4 bytes), an 8-byte integer atom lofty's reader drops, the
/// gapless and normalisation freeform atoms and a custom freeform atom.
fn rich_m4a() -> (tempfile::TempDir, PathBuf) {
  let (dir, path) = copy_of("m4a");
  dress_m4a(&path);
  (dir, path)
}

fn dress_m4a(path: &Path) {
  let file = Mp4File::read_from(&mut File::open(path).unwrap(), LoftyParse::new()).unwrap();
  let mut ilst = file.ilst().cloned().unwrap_or_default();
  ilst.set_title("Old Title".into());
  ilst.set_artist("Old Artist".into());
  ilst.set_album("Old Album".into());
  ilst.insert_picture(front_cover());
  ilst.insert(Atom::new(
    AtomIdent::Fourcc(*b"\xa9lyr"),
    AtomData::UTF8("la la la\nsecond line".into()),
  ));
  ilst.set_track(3);
  ilst.set_track_total(12);
  ilst.set_disk(1);
  ilst.set_flag(AtomIdent::Fourcc(*b"cpil"), true);
  ilst.insert(Atom::new(
    AtomIdent::Fourcc(*b"tmpo"),
    AtomData::Unknown {
      code: DataType::BeSignedInteger,
      data: vec![0, 120],
    },
  ));
  ilst.insert(Atom::new(
    AtomIdent::Fourcc(*b"cmID"),
    AtomData::Unknown {
      code: DataType::BeSignedInteger,
      data: vec![0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78],
    },
  ));
  ilst.insert(freeform("com.apple.iTunes", "iTunSMPB", ITUNSMPB));
  ilst.insert(freeform("com.apple.iTunes", "iTunNORM", ITUNNORM));
  ilst.insert(freeform("com.example", "X", "custom value"));
  ilst.save_to_path(path, WriteOptions::default()).unwrap();
}

fn text(id: &'static str, enc: TextEncoding, value: &str) -> Frame<'static> {
  Frame::Text(TextInformationFrame::new(
    FrameId::Valid(Cow::Borrowed(id)),
    enc,
    value.to_string(),
  ))
}

/// An MP3 with the frames a mixed-source library holds, then an APE tag and an ID3v1 trailer.
fn rich_mp3(id3v23: bool) -> (tempfile::TempDir, PathBuf) {
  let (dir, path) = copy_of("mp3");
  let mut tag = Id3v2Tag::new();
  let frames = [
    text("TIT2", TextEncoding::UTF16, "Old Title"),
    text("TPE1", TextEncoding::Latin1, "Old Artist"),
    text("TALB", TextEncoding::Latin1, "Old Album"),
    text("TRCK", TextEncoding::Latin1, "3/12"),
    text("TCON", TextEncoding::Latin1, "Ambient"),
    text(if id3v23 { "TYER" } else { "TDRC" }, TextEncoding::Latin1, "1999"),
    Frame::Comment(CommentFrame::new(TextEncoding::Latin1, *b"eng", "iTunNORM", ITUNNORM)),
    Frame::Comment(CommentFrame::new(TextEncoding::Latin1, *b"eng", "", "plain comment")),
    Frame::UserText(ExtendedTextFrame::new(
      TextEncoding::Latin1,
      "MusicBrainz Album Id",
      "6f1f3c1e-8f2b-4b1a-9c55-000000000001",
    )),
    Frame::Private(PrivateFrame::new(
      "WM/MediaClassPrimaryID",
      vec![
        0xbc, 0x7d, 0x60, 0xd1, 0x23, 0xe3, 0xe2, 0x4b, 0x86, 0xa1, 0x48, 0xa4, 0x2a, 0x28, 0x44, 0x1e,
      ],
    )),
    Frame::Picture(AttachedPictureFrame::new(TextEncoding::Latin1, front_cover())),
    Frame::UnsynchronizedText(UnsynchronizedTextFrame::new(
      TextEncoding::Latin1,
      *b"eng",
      "",
      "la la la",
    )),
    Frame::Binary(BinaryFrame::new(
      FrameId::Valid(Cow::Borrowed("GEOB")),
      b"\0application/octet-stream\0blob.bin\0object\0\x01\x02\x03".to_vec(),
    )),
  ];
  for f in frames {
    let _ = tag.insert(f);
  }
  tag.save_to_path(&path, WriteOptions::new().use_id3v23(id3v23)).unwrap();
  let mut ape = Tag::new(TagType::Ape);
  ape.insert_text(ItemKey::Comment, "ape comment".into());
  ape.save_to_path(&path, WriteOptions::default()).unwrap();
  let mut v1 = Tag::new(TagType::Id3v1);
  v1.set_title("v1 title".into());
  v1.set_artist("v1 artist".into());
  v1.save_to_path(&path, WriteOptions::default()).unwrap();
  (dir, path)
}

/// Vorbis comments as taggers leave them: two ARTIST values, ReplayGain, custom and lower-case keys.
fn dress_comments(vc: &mut lofty::ogg::tag::VorbisComments) {
  for (k, v) in [
    ("TITLE", "Old Title"),
    ("ARTIST", "Old Artist"),
    ("ARTIST", "Second Artist"),
    ("ALBUM", "Old Album"),
    ("REPLAYGAIN_TRACK_GAIN", "-6.48 dB"),
    ("REPLAYGAIN_TRACK_PEAK", "0.988525"),
    ("R128_TRACK_GAIN", "-1234"),
    ("SOUNDHOOD_SOURCE", "youtube:dQw4w9WgXcQ"),
    ("lowercase_key", "Mixed Case Value"),
  ] {
    vc.push(k.into(), v.into());
  }
}

/// A FLAC with a PICTURE block and a dressed comment block.
fn rich_flac() -> (tempfile::TempDir, PathBuf) {
  let (dir, path) = copy_of("flac");
  let mut flac = FlacFile::read_from(&mut File::open(&path).unwrap(), LoftyParse::new()).unwrap();
  let mut vc = flac.vorbis_comments().cloned().unwrap_or_default();
  dress_comments(&mut vc);
  let _ = flac.set_vorbis_comments(vc);
  flac.insert_picture(front_cover(), None).unwrap();
  let mut file = OpenOptions::new().read(true).write(true).open(&path).unwrap();
  flac.save_to(&mut file, WriteOptions::default()).unwrap();
  (dir, path)
}

/// An Opus or Ogg Vorbis file with a METADATA_BLOCK_PICTURE and dressed comments.
fn rich_ogg(ext: &str) -> (tempfile::TempDir, PathBuf) {
  let (dir, path) = copy_of(ext);
  let mut reader = File::open(&path).unwrap();
  let mut vc = if ext == "opus" {
    OpusFile::read_from(&mut reader, LoftyParse::new())
      .unwrap()
      .remove_vorbis_comments()
  } else {
    VorbisFile::read_from(&mut reader, LoftyParse::new())
      .unwrap()
      .remove_vorbis_comments()
  };
  drop(reader);
  dress_comments(&mut vc);
  vc.insert_picture(front_cover(), None).unwrap();
  vc.save_to_path(&path, WriteOptions::default()).unwrap();
  (dir, path)
}

fn rich(kind: &str) -> (tempfile::TempDir, PathBuf) {
  match kind {
    "m4a" => rich_m4a(),
    "mp3" => rich_mp3(true),
    "mp3v24" => rich_mp3(false),
    "flac" => rich_flac(),
    other => rich_ogg(other),
  }
}

/// The item snapshot of a file, through the same parsers the write check uses.
fn items(path: &Path) -> Vec<Item> {
  Format::of(path).unwrap().snapshot(path).unwrap()
}

/// The items outside `fields`, in order.
fn outside(items: &[Item], fields: &[Field]) -> Vec<Item> {
  items
    .iter()
    .filter(|i| !i.field.is_some_and(|f| fields.contains(&f)))
    .cloned()
    .collect()
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
  hay.windows(needle.len()).any(|w| w == needle)
}

/// Writes `changes` and checks the result at the item level and against the coarse verify.
fn write_and_check(path: &Path, changes: &TagSet, fields: &[Field]) -> TagRead {
  let before_read = read(path).unwrap();
  let before = items(path);
  crate::tags::write(path, changes).unwrap();
  let after_read = verify(path, &before_read, changes).unwrap();
  let after = items(path);
  assert_eq!(
    outside(&before, fields),
    outside(&after, fields),
    "{}: every item outside {fields:?} is unchanged",
    path.display()
  );
  assert_eq!(after_read.art_hash, before_read.art_hash, "{}: cover", path.display());
  after_read
}

/// The ID3v2 tag's total size, from its header (0 without a tag).
fn id3_len(bytes: &[u8]) -> usize {
  if &bytes[..3] != b"ID3" {
    return 0;
  }
  10 + bytes::syncsafe(&bytes[6..10]) as usize
}

#[test]
fn every_format_keeps_all_other_items_when_title_and_artist_change() {
  for kind in RICH {
    let (_dir, path) = rich(kind);
    let after = write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
    assert_eq!(
      (after.title.as_str(), after.artist.as_str()),
      ("New Title", "New Artist"),
      "{kind}"
    );
    assert_eq!(after.album, "Old Album", "{kind}");
    assert_eq!(cover_art(&path).unwrap().as_deref(), Some(PNG), "{kind}: picture bytes");
  }
}

#[test]
fn every_format_clears_the_album_and_nothing_else() {
  for kind in RICH {
    let (_dir, path) = rich(kind);
    let after = write_and_check(&path, &set(|t| t.album = Some(String::new())), &[Field::Album]);
    assert_eq!(after.album, "", "{kind}");
    assert_eq!(after.title, "Old Title", "{kind}");
    let labels: Vec<String> = items(&path).into_iter().map(|i| i.label).collect();
    assert!(
      !labels
        .iter()
        .any(|l| l.ends_with("\u{a9}alb") || l.ends_with("TALB") || l.ends_with("ALBUM")),
      "{kind}: no album item left in {labels:?}"
    );
  }
}

#[test]
fn every_format_writes_identical_bytes_for_identical_edits() {
  for kind in RICH {
    let (_a, first) = rich(kind);
    let (_b, second) = rich(kind);
    assert_eq!(
      fs::read(&first).unwrap(),
      fs::read(&second).unwrap(),
      "{kind}: same fixture"
    );
    let changes = set(|t| {
      t.title = Some("Caf\u{e9} \u{2615}".into());
      t.year = Some("2001".into());
      t.comment = Some("youtube:dQw4w9WgXcQ".into());
    });
    crate::tags::write(&first, &changes).unwrap();
    crate::tags::write(&second, &changes).unwrap();
    assert_eq!(
      fs::read(&first).unwrap(),
      fs::read(&second).unwrap(),
      "{kind}: deterministic output"
    );
  }
}

#[test]
fn every_template_takes_every_field_and_reads_it_back() {
  let all = set(|t| {
    t.title = Some("T".into());
    t.artist = Some("A".into());
    t.album = Some("Al".into());
    t.album_artist = Some("AA".into());
    t.genre = Some("Ambient".into());
    t.year = Some("2001".into());
    t.comment = Some("C".into());
  });
  for ext in ["m4a", "mp3", "flac", "opus", "ogg"] {
    let (_dir, path) = copy_of(ext);
    let before = read(&path).unwrap();
    crate::tags::write(&path, &all).unwrap();
    let after = verify(&path, &before, &all).unwrap();
    assert_eq!(after.album_artist, "AA", "{ext}");
  }
}

#[test]
fn m4a_atoms_survive_byte_for_byte() {
  let (_dir, path) = rich_m4a();
  let before = mp4::raw_atoms(&path);
  crate::tags::write(&path, &title_and_artist()).unwrap();
  let after = mp4::raw_atoms(&path);
  let edited = ["\u{a9}nam", "\u{a9}ART"];
  let kept = |atoms: &[(String, Vec<u8>)]| -> Vec<(String, Vec<u8>)> {
    atoms
      .iter()
      .filter(|(l, _)| !edited.contains(&l.as_str()))
      .cloned()
      .collect()
  };
  assert_eq!(kept(&before), kept(&after));
  // The edited atoms keep their place.
  let order = |atoms: &[(String, Vec<u8>)]| atoms.iter().map(|(l, _)| l.clone()).collect::<Vec<_>>();
  assert_eq!(order(&before), order(&after));
  // Independent of the parser: each kept atom's bytes are in the new file verbatim.
  let file = fs::read(&path).unwrap();
  for (label, bytes) in kept(&before) {
    assert!(contains(&file, &bytes), "{label} is in the file byte-for-byte");
  }
  let find = |label: &str| after.iter().find(|(l, _)| l == label).map(|(_, b)| b.clone()).unwrap();
  assert_eq!(find("tmpo").len(), 8 + 16 + 2, "tmpo keeps its 2-byte value");
  assert!(contains(&find("----:com.apple.iTunes:iTunSMPB"), ITUNSMPB.as_bytes()));
  assert!(
    after.iter().any(|(l, _)| l == "cmID"),
    "an atom lofty's own reader drops is kept"
  );
}

/// The top-level boxes of an MP4 as (kind, offset).
fn top_level(path: &Path) -> Vec<(String, usize)> {
  let b = fs::read(path).unwrap();
  let mut out = Vec::new();
  let mut pos = 0;
  while pos + 8 <= b.len() {
    let size = bytes::be32(&b[pos..]) as usize;
    out.push((String::from_utf8_lossy(&b[pos + 4..pos + 8]).into_owned(), pos));
    pos += size.max(8);
  }
  out
}

#[test]
fn m4a_with_moov_before_mdat_keeps_every_sample_in_place() {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join("Tone - Faststart.m4a");
  fs::copy(
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/tags/tone-faststart.m4a"),
    &path,
  )
  .unwrap();
  dress_m4a(&path);
  let mdat = |p: &Path| top_level(p).into_iter().find(|(k, _)| k == "mdat").unwrap().1;
  let (moov_first, before) = (top_level(&path)[1].0.clone(), mdat(&path));
  assert_eq!(moov_first, "moov", "the fixture has moov in front of mdat");
  assert!(
    items(&path).iter().any(|i| i.label == "MP4 track 0 sample data"),
    "the sample tables are followed"
  );

  // A long title outgrows any padding, so mdat moves and every chunk offset is rewritten.
  let long = set(|t| t.title = Some("A much longer title than before ".repeat(20)));
  write_and_check(&path, &long, &[Field::Title]);
  assert!(mdat(&path) > before, "the audio moved");
  assert_eq!(read(&path).unwrap().title, long.title.unwrap().trim());
}

#[test]
fn a_chunk_offset_that_points_elsewhere_is_caught() {
  let (_dir, path) = copy_of("m4a");
  let before = items(&path);
  let mut b = fs::read(&path).unwrap();
  // The first stco entry, after "stco", version/flags and the entry count.
  let first = b.windows(4).position(|w| w == b"stco").unwrap() + 12;
  b[first + 3] = b[first + 3].wrapping_add(1);
  fs::write(&path, &b).unwrap();
  assert_eq!(
    first_difference(&before, &items(&path), &Wanted::default()).as_deref(),
    Some("MP4 track 0 sample data changed")
  );
}

#[test]
fn m4a_genre_edit_replaces_the_numeric_gnre_atom() {
  let (_dir, path) = copy_of("m4a");
  let file = Mp4File::read_from(&mut File::open(&path).unwrap(), LoftyParse::new()).unwrap();
  let mut ilst = file.ilst().cloned().unwrap_or_default();
  // gnre holds an ID3v1 genre index + 1 (18 = "Rock").
  ilst.insert(Atom::new(
    AtomIdent::Fourcc(*b"gnre"),
    AtomData::Unknown {
      code: DataType::Reserved,
      data: vec![0, 18],
    },
  ));
  ilst.save_to_path(&path, WriteOptions::default()).unwrap();
  assert_eq!(read(&path).unwrap().genre, "Rock");

  write_and_check(&path, &set(|t| t.genre = Some("Jazz".into())), &[Field::Genre]);
  let labels: Vec<String> = mp4::raw_atoms(&path).into_iter().map(|(l, _)| l).collect();
  assert!(
    labels.contains(&"\u{a9}gen".to_string()) && !labels.contains(&"gnre".to_string()),
    "{labels:?}"
  );
  assert_eq!(read(&path).unwrap().genre, "Jazz");
}

#[test]
fn m4a_without_an_ilst_gets_one() {
  let (_dir, path) = copy_of("m4a");
  TagType::Mp4Ilst
    .remove_from_path(&path, WriteOptions::default())
    .unwrap();
  assert!(mp4::raw_atoms(&path).is_empty());
  let after = write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
  assert_eq!(after.title, "New Title");
}

#[test]
fn m4a_atom_lofty_cannot_rewrite_is_refused_before_writing() {
  let (_dir, path) = rich_m4a();
  // Give the encoder atom a non-zero locale, which lofty always writes as zero.
  let mut bytes = fs::read(&path).unwrap();
  let at = bytes
    .windows(4)
    .position(|w| w == b"\xa9too")
    .expect("the encoder atom");
  assert_eq!(&bytes[at + 8..at + 12], b"data");
  bytes[at + 19] = 1;
  fs::write(&path, &bytes).unwrap();

  let err = crate::tags::write(&path, &title_and_artist()).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("\u{a9}too") && m.contains("nothing was written")),
    "{err}"
  );
  assert_eq!(fs::read(&path).unwrap(), bytes, "the file is untouched");
}

#[test]
fn mp3_frames_and_trailers_survive_and_23_stays_23() {
  for id3v23 in [true, false] {
    let (_dir, path) = rich_mp3(id3v23);
    let before_bytes = fs::read(&path).unwrap();
    let (major, before) = id3::raw_frames(&path, id3::Host::Leading);
    assert_eq!(major, Some(if id3v23 { 3 } else { 4 }));
    write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
    let after_bytes = fs::read(&path).unwrap();
    let (major_after, after) = id3::raw_frames(&path, id3::Host::Leading);
    assert_eq!(major_after, major, "the ID3v2 version is kept");
    assert_eq!(after_bytes[3], before_bytes[3]);

    let ids = |frames: &[(String, Vec<u8>)]| frames.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&before), ids(&after), "same frames, same order");
    for ((id, b), (_, a)) in before.iter().zip(&after) {
      if id != "TIT2" && id != "TPE1" {
        assert_eq!(b, a, "{id} is byte-identical");
        assert!(contains(&after_bytes, b), "{id} is in the file verbatim");
      }
    }
    // Everything after the ID3v2 tag (audio, APE tag, ID3v1 trailer) is byte-identical.
    assert_eq!(
      &before_bytes[id3_len(&before_bytes)..],
      &after_bytes[id3_len(&after_bytes)..]
    );
    assert_eq!(&after_bytes[after_bytes.len() - 128..after_bytes.len() - 125], b"TAG");
    assert!(contains(&after_bytes, b"APETAGEX"));
  }
}

#[test]
fn mp3_comment_edit_leaves_described_comments_alone() {
  let (_dir, path) = rich_mp3(true);
  let after = write_and_check(
    &path,
    &set(|t| t.comment = Some("new comment".into())),
    &[Field::Comment],
  );
  assert_eq!(after.comment, "new comment");
  let (_, frames) = id3::raw_frames(&path, id3::Host::Leading);
  let comms: Vec<&Vec<u8>> = frames.iter().filter(|(id, _)| id == "COMM").map(|(_, c)| c).collect();
  assert_eq!(comms.len(), 2);
  assert!(contains(comms[0], b"iTunNORM") && contains(comms[0], ITUNNORM.as_bytes()));
  assert!(
    contains(comms[1], b"new comment") && &comms[1][1..4] == b"eng",
    "keeps its language"
  );
}

#[test]
fn mp3_id3v23_full_date_goes_to_tyer_and_tdat() {
  let (_dir, path) = rich_mp3(true);
  let after = write_and_check(&path, &set(|t| t.year = Some("2001-02-03".into())), &[Field::Year]);
  assert_eq!(after.year, "2001-02-03");
  let (_, frames) = id3::raw_frames(&path, id3::Host::Leading);
  let ids: Vec<&str> = frames.iter().map(|(id, _)| id.as_str()).collect();
  assert!(
    ids.contains(&"TYER") && ids.contains(&"TDAT") && !ids.contains(&"TDRC"),
    "{ids:?}"
  );

  let err = crate::tags::write(&path, &set(|t| t.year = Some("2001-02".into()))).unwrap_err();
  assert!(matches!(err, Error::Refused(_)), "{err}");
}

#[test]
fn mp3_id3v23_frame_lofty_would_drop_is_refused_before_writing() {
  // iTunes puts sort-order frames (TSOP) into 2.3 tags; lofty's 2.3 writer discards them.
  let (_dir, path) = copy_of("mp3");
  let mut tag = Id3v2Tag::new();
  let _ = tag.insert(text("TIT2", TextEncoding::Latin1, "Old Title"));
  let _ = tag.insert(text("TSOP", TextEncoding::Latin1, "Artist, The"));
  // Written as 2.4 so lofty keeps TSOP, then the version byte says 2.3 (the frame layout of a
  // plain tag is the same apart from synchsafe sizes, which are equal below 128).
  tag.save_to_path(&path, WriteOptions::default()).unwrap();
  let mut bytes = fs::read(&path).unwrap();
  bytes[3] = 3;
  fs::write(&path, &bytes).unwrap();
  assert_eq!(id3::raw_frames(&path, id3::Host::Leading).0, Some(3));

  let err = crate::tags::write(&path, &title_and_artist()).unwrap_err();
  assert!(matches!(&err, Error::Refused(m) if m.contains("TSOP")), "{err}");
  assert_eq!(fs::read(&path).unwrap(), bytes, "the file is untouched");
}

#[test]
fn flac_picture_blocks_and_comments_survive() {
  let (_dir, path) = rich_flac();
  let (comments, pictures) = vorbis::raw_comments(&path, None);
  assert_eq!(pictures.len(), 1);
  write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
  let (comments_after, pictures_after) = vorbis::raw_comments(&path, None);
  assert_eq!(pictures_after, pictures, "PICTURE blocks byte-identical");
  let untouched = |c: &[Vec<u8>]| -> Vec<Vec<u8>> {
    c.iter()
      .filter(|i| !i.starts_with(b"TITLE=") && !i.starts_with(b"ARTIST="))
      .cloned()
      .collect()
  };
  assert_eq!(untouched(&comments), untouched(&comments_after));
  // Both ARTIST values are replaced by the one new value, where the first was.
  let pos = |c: &[Vec<u8>], k: &[u8]| c.iter().position(|i| i.starts_with(k));
  assert_eq!(pos(&comments_after, b"ARTIST="), pos(&comments, b"ARTIST="));
  assert_eq!(comments_after.iter().filter(|i| i.starts_with(b"ARTIST=")).count(), 1);
  assert!(comments_after.contains(&b"lowercase_key=Mixed Case Value".to_vec()));
}

#[test]
fn ogg_and_opus_pictures_and_comments_survive() {
  for (ext, codec) in [("opus", vorbis::Codec::Opus), ("ogg", vorbis::Codec::Vorbis)] {
    let (_dir, path) = rich_ogg(ext);
    let (before, _) = vorbis::raw_comments(&path, Some(codec));
    write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
    let (after, _) = vorbis::raw_comments(&path, Some(codec));
    let picture = |c: &[Vec<u8>]| c.iter().find(|i| i.starts_with(b"METADATA_BLOCK_PICTURE=")).cloned();
    assert!(picture(&before).is_some(), "{ext}");
    assert_eq!(
      picture(&before),
      picture(&after),
      "{ext}: picture comment byte-identical"
    );
    for keep in [
      &b"R128_TRACK_GAIN=-1234"[..],
      b"SOUNDHOOD_SOURCE=youtube:dQw4w9WgXcQ",
      b"REPLAYGAIN_TRACK_GAIN=-6.48 dB",
    ] {
      assert!(
        after.contains(&keep.to_vec()),
        "{ext}: {}",
        String::from_utf8_lossy(keep)
      );
    }
    let lofty_view = |p: &Path| {
      let mut r = File::open(p).unwrap();
      let vc = if ext == "opus" {
        OpusFile::read_from(&mut r, LoftyParse::new())
          .unwrap()
          .remove_vorbis_comments()
      } else {
        VorbisFile::read_from(&mut r, LoftyParse::new())
          .unwrap()
          .remove_vorbis_comments()
      };
      vc.pictures().to_vec()
    };
    assert_eq!(lofty_view(&path).len(), 1, "{ext}");
  }
}

/// A minimal PCM WAV (0.1 s of 8 kHz mono silence) with a LIST chunk.
fn wav(dir: &Path) -> PathBuf {
  let path = dir.join("Tone - Fixture.wav");
  let mut fmt = Vec::new();
  for v in [1u16, 1] {
    fmt.extend_from_slice(&v.to_le_bytes());
  }
  fmt.extend_from_slice(&8000u32.to_le_bytes());
  fmt.extend_from_slice(&16000u32.to_le_bytes());
  fmt.extend_from_slice(&2u16.to_le_bytes());
  fmt.extend_from_slice(&16u16.to_le_bytes());
  let chunk = |id: &[u8; 4], body: &[u8]| {
    let mut c = id.to_vec();
    c.extend_from_slice(&(body.len() as u32).to_le_bytes());
    c.extend_from_slice(body);
    c
  };
  let mut body = b"WAVE".to_vec();
  body.extend(chunk(b"fmt ", &fmt));
  body.extend(chunk(b"LIST", b"INFOISFT\x06\x00\x00\x00tests\x00"));
  body.extend(chunk(b"data", &[0u8; 1600]));
  let mut riff = b"RIFF".to_vec();
  riff.extend_from_slice(&(body.len() as u32).to_le_bytes());
  riff.extend(body);
  fs::write(&path, riff).unwrap();
  path
}

#[test]
fn wav_with_id3_is_written_and_without_is_refused() {
  let dir = tempfile::tempdir().unwrap();
  let path = wav(dir.path());
  let plain = fs::read(&path).unwrap();
  let err = crate::tags::write(&path, &title_and_artist()).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m == "tag writes are not supported for wav files without an ID3v2 tag yet"),
    "{err}"
  );
  assert_eq!(fs::read(&path).unwrap(), plain);

  let mut tag = Id3v2Tag::new();
  let _ = tag.insert(text("TIT2", TextEncoding::Latin1, "Old Title"));
  let _ = tag.insert(Frame::Private(PrivateFrame::new("owner", vec![1, 2, 3])));
  tag.save_to_path(&path, WriteOptions::default()).unwrap();
  write_and_check(&path, &title_and_artist(), &[Field::Title, Field::Artist]);
  let (_, frames) = id3::raw_frames(&path, id3::Host::Riff);
  assert!(frames.iter().any(|(id, c)| id == "PRIV" && c.ends_with(&[1, 2, 3])));
  assert!(contains(
    &fs::read(&path).unwrap(),
    b"INFOISFT\x06\x00\x00\x00tests\x00"
  ));
}

#[test]
fn other_formats_are_refused_untouched() {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join("Tone - Fixture.ape");
  let mut ape = b"MAC ".to_vec();
  ape.extend_from_slice(&[0u8; 60]);
  fs::write(&path, &ape).unwrap();
  let err = crate::tags::write(&path, &title_and_artist()).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m == "tag writes are not supported for ape files yet"),
    "{err}"
  );
  assert_eq!(fs::read(&path).unwrap(), ape);
}

#[test]
fn an_empty_edit_writes_nothing() {
  let (_dir, path) = rich_m4a();
  let before = fs::read(&path).unwrap();
  crate::tags::write(&path, &TagSet::default()).unwrap();
  assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn differences_are_named_and_edited_fields_are_ignored() {
  let item = |field, label: &str, bytes: &[u8]| Item::of(Group::Tag, field, label, bytes);
  let a = item(None, "A", b"1");
  let b = item(None, "B", b"2");
  let title = item(Some(Field::Title), "T", b"old");
  let none = Wanted::default();
  let titled = Wanted::new(&set(|t| t.title = Some("x".into())));

  let diff = |before: Vec<Item>, after: Vec<Item>, w: &Wanted| first_difference(&before, &after, w);
  let (ab, ba) = (vec![a.clone(), b.clone()], vec![b.clone(), a.clone()]);
  assert_eq!(diff(ab.clone(), ab.clone(), &none), None);
  assert_eq!(
    diff(ab.clone(), vec![a.clone()], &none).as_deref(),
    Some("B is missing")
  );
  assert_eq!(diff(vec![a.clone()], ab.clone(), &none).as_deref(), Some("B was added"));
  assert_eq!(diff(ab, ba, &none).as_deref(), Some("A moved"));
  let a2 = item(None, "A", b"one");
  assert_eq!(diff(vec![a.clone()], vec![a2], &none).as_deref(), Some("A changed"));
  // An edited field's items may change, vanish or appear.
  let new_title = item(Some(Field::Title), "T", b"new");
  let with_title = vec![title, a.clone()];
  assert_eq!(diff(with_title.clone(), vec![a.clone(), new_title], &titled), None);
  assert!(diff(with_title, vec![a], &none).is_some());
  // A header is compared only when both sides have it.
  let v3 = Item::of(Group::Header, None, "version", &[3]);
  let v4 = Item::of(Group::Header, None, "version", &[4]);
  assert_eq!(diff(vec![v3.clone()], Vec::new(), &none), None);
  assert_eq!(diff(vec![v3], vec![v4], &none).as_deref(), Some("version changed"));
}

#[test]
fn lofty_errors_carry_their_source_chain() {
  #[derive(Debug)]
  struct Outer(std::io::Error);
  impl std::fmt::Display for Outer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      f.write_str("failed to write Mp4 file")
    }
  }
  impl std::error::Error for Outer {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
      Some(&self.0)
    }
  }
  let e = Outer(std::io::Error::other("atom too large"));
  let err = lofty_error(Path::new("x.m4a"), "cannot write the MP4 tags", &e);
  assert_eq!(
    err.to_string(),
    "tag error: x.m4a: cannot write the MP4 tags: failed to write Mp4 file: atom too large"
  );
}
