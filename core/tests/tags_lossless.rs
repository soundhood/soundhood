//! Public tag reading on files that carry the items the lossless write preserves (gapless and
//! normalisation data, described comments, pictures). The write round trips are unit tests in
//! `src/tags/lossless/tests.rs` (the write is `pub(crate)`).

use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::AudioFile;
use lofty::id3::v2::{CommentFrame, Frame, FrameId, Id3v2Tag, TextInformationFrame};
use lofty::mp4::{Atom, AtomData, AtomIdent, Mp4File};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, TagExt};
use lofty::TextEncoding;
use soundhood_core::tags;
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

/// A 1x1 PNG.
const PNG: &[u8] = &[
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d,
  0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

const ITUNNORM: &str = " 0000044E 0000044E 00002F5D 00002F5D 00000000 00000000 00007E1F 00007E1F 00000000 00000000";

fn copy(from: &Path, name: &str) -> (tempfile::TempDir, PathBuf) {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join(name);
  fs::copy(from, &path).unwrap();
  (dir, path)
}

fn audio(ext: &str) -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("fixtures/audio/tone.{ext}"))
}

fn comment(description: &str, content: &str) -> Frame<'static> {
  Frame::Comment(CommentFrame::new(
    TextEncoding::Latin1,
    *b"eng",
    description.to_string(),
    content.to_string(),
  ))
}

/// iTunes stores normalisation data in a COMM frame described "iTunNORM", often before the plain
/// comment; it is data, not the comment the user sees.
#[test]
fn the_comment_is_the_comm_frame_without_a_description() {
  let (_dir, path) = copy(&audio("mp3"), "Tone - Fixture.mp3");
  let mut tag = Id3v2Tag::new();
  let _ = tag.insert(Frame::Text(TextInformationFrame::new(
    FrameId::Valid(Cow::Borrowed("TIT2")),
    TextEncoding::Latin1,
    "Tone".to_string(),
  )));
  let _ = tag.insert(comment("iTunNORM", ITUNNORM));
  tag.save_to_path(&path, WriteOptions::default()).unwrap();
  assert_eq!(tags::read(&path).unwrap().comment, "", "no plain comment yet");

  let _ = tag.insert(comment("", "the plain comment"));
  tag.save_to_path(&path, WriteOptions::default()).unwrap();
  let r = tags::read(&path).unwrap();
  assert_eq!((r.title.as_str(), r.comment.as_str()), ("Tone", "the plain comment"));
  assert_eq!(tags::tagset_of(&r).comment.as_deref(), Some("the plain comment"));
}

/// An m4a with the gapless and normalisation freeform atoms and a cover reads like any other, and
/// reading never changes a byte.
#[test]
fn an_itunes_style_m4a_reads_its_fields_and_cover_untouched() {
  let (_dir, path) = copy(&audio("m4a"), "Tone - Fixture.m4a");
  let file = Mp4File::read_from(&mut fs::File::open(&path).unwrap(), ParseOptions::new()).unwrap();
  let mut ilst = file.ilst().cloned().unwrap_or_default();
  ilst.set_title("Tone".into());
  ilst.set_artist("Fixture".into());
  for (name, value) in [
    ("iTunSMPB", " 00000000 00000840 000001C0 0000000000010E00"),
    ("iTunNORM", ITUNNORM),
  ] {
    ilst.insert(Atom::new(
      AtomIdent::Freeform {
        mean: Cow::Borrowed("com.apple.iTunes"),
        name: Cow::Owned(name.into()),
      },
      AtomData::UTF8(value.into()),
    ));
  }
  ilst.insert_picture(
    Picture::unchecked(PNG.to_vec())
      .pic_type(PictureType::CoverFront)
      .mime_type(MimeType::Png)
      .build(),
  );
  ilst.save_to_path(&path, WriteOptions::default()).unwrap();

  let bytes = fs::read(&path).unwrap();
  let r = tags::read(&path).unwrap();
  assert_eq!(
    (r.title.as_str(), r.artist.as_str(), r.comment.as_str()),
    ("Tone", "Fixture", "")
  );
  assert!(r.has_art);
  assert_eq!(tags::cover_art(&path).unwrap().as_deref(), Some(PNG));
  assert_eq!(fs::read(&path).unwrap(), bytes, "reads do not write");
}

/// The faststart fixture (moov in front of mdat, the iTunes layout) reads like the plain template.
#[test]
fn the_faststart_fixture_reads_like_the_template() {
  let fast = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/tags/tone-faststart.m4a");
  let (a, b) = (tags::read(&fast).unwrap(), tags::read(&audio("m4a")).unwrap());
  assert_eq!((a.codec.as_str(), a.sample_rate), (b.codec.as_str(), b.sample_rate));
  assert!(
    a.duration_ms.abs_diff(b.duration_ms) <= 50,
    "{} vs {} ms",
    a.duration_ms,
    b.duration_ms
  );
}
