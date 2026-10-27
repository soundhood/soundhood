//! Public tag reading on the fixture audio. The write/verify round trips are unit tests in
//! `src/tags/tests.rs` (they are `pub(crate)`).

use soundhood_core::tags::{self, TagRead};
use std::path::{Path, PathBuf};

fn fixture(ext: &str) -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("fixtures/audio/tone.{ext}"))
}

#[test]
fn every_fixture_reads_with_codec_and_duration() {
  for (ext, codec) in [
    ("m4a", "aac"),
    ("mp3", "mp3"),
    ("flac", "flac"),
    ("opus", "opus"),
    ("ogg", "vorbis"),
  ] {
    let r = tags::read(&fixture(ext)).unwrap();
    assert_eq!(r.codec, codec, "{ext}");
    assert!((2900..=3100).contains(&r.duration_ms), "{ext}: {} ms", r.duration_ms);
    assert_eq!(tags::cover_art(&fixture(ext)).unwrap(), None, "{ext}");
  }
}

#[test]
fn reads_through_an_nfd_file_name() {
  let d = tempfile::tempdir().unwrap();
  let p = d.path().join("Mo\u{308}tley - Tone.flac");
  std::fs::copy(fixture("flac"), &p).unwrap();
  assert_eq!(tags::read(&p).unwrap().codec, "flac");
}

#[test]
fn lenient_read_turns_any_failure_into_empty_fields() {
  let d = tempfile::tempdir().unwrap();
  let junk = d.path().join("broken.m4a");
  std::fs::write(&junk, [0u8; 64]).unwrap();
  assert_eq!(tags::read_lenient(&junk), TagRead::default());
  assert!(tags::read(&junk).is_err());
}

#[test]
fn tag_read_serialises_with_snake_case_keys() {
  let r = tags::read(&fixture("mp3")).unwrap();
  let v: serde_json::Value = serde_json::to_value(&r).unwrap();
  for key in [
    "title",
    "album_artist",
    "duration_ms",
    "codec",
    "bitrate",
    "sample_rate",
    "has_art",
    "art_hash",
  ] {
    assert!(v.get(key).is_some(), "{key}");
  }
}
