//! Public tag reading on files that carry iTunes-style data items.

use lofty::config::WriteOptions;
use lofty::id3::v2::{CommentFrame, Frame, FrameId, Id3v2Tag, TextInformationFrame};
use lofty::tag::TagExt;
use lofty::TextEncoding;
use soundhood_core::tags;
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

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
