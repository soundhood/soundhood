//! Round-trip tests per container on copies of `core/fixtures/audio/tone.*` (3 s, no tags).

use super::*;
use lofty::config::WriteOptions;
use lofty::picture::MimeType;
use lofty::tag::{TagExt, TagType};
use std::path::PathBuf;

const CONTAINERS: [(&str, &str); 5] = [
  ("m4a", "aac"),
  ("mp3", "mp3"),
  ("flac", "flac"),
  ("opus", "opus"),
  ("ogg", "vorbis"),
];

fn fixture(ext: &str) -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("fixtures/audio/tone.{ext}"))
}

/// A writable copy of a fixture in its own temp dir (the fixtures themselves are never written).
fn copy_of(ext: &str) -> (tempfile::TempDir, PathBuf) {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join(format!("Tone - Fixture.{ext}"));
  std::fs::copy(fixture(ext), &path).unwrap();
  (dir, path)
}

fn set(f: impl FnOnce(&mut TagSet)) -> TagSet {
  let mut t = TagSet::default();
  f(&mut t);
  t
}

/// A 1x1 PNG, enough for lofty to embed and hand back byte-for-byte.
const PNG: &[u8] = &[
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d,
  0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/// Puts a track number and a front cover into the file with lofty directly: fields the write
/// path's `TagSet` does not cover, which every write must carry through untouched.
fn seed_untouched_items(path: &Path) {
  let mut file = lofty::read_from_path(path).unwrap();
  if file.primary_tag().is_none() {
    let kind = file.primary_tag_type();
    file.insert_tag(Tag::new(kind));
  }
  let tag = file.primary_tag_mut().unwrap();
  tag.set_track(7);
  tag.push_picture(
    Picture::unchecked(PNG.to_vec())
      .pic_type(PictureType::CoverFront)
      .mime_type(MimeType::Png)
      .build(),
  );
  tag.save_to_path(path, WriteOptions::default()).unwrap();
}

fn track_number(path: &Path) -> Option<u32> {
  let file = lofty::read_from_path(path).unwrap();
  file.primary_tag().and_then(|t| t.track())
}

#[test]
fn fixtures_read_untagged_with_properties() {
  for (ext, codec) in CONTAINERS {
    let r = read(&fixture(ext)).unwrap();
    assert_eq!(r.codec, codec, "{ext}");
    assert!(r.duration_ms.abs_diff(3000) <= 100, "{ext}: {} ms", r.duration_ms);
    assert_eq!((r.title.as_str(), r.artist.as_str()), ("", ""), "{ext}");
    assert!(!r.has_art && r.art_hash.is_none(), "{ext}");
    assert!(r.sample_rate.is_some(), "{ext}");
  }
}

#[test]
fn round_trip_every_container() {
  for (ext, codec) in CONTAINERS {
    let (_dir, path) = copy_of(ext);
    seed_untouched_items(&path);
    let before = read(&path).unwrap();
    assert!(before.has_art, "{ext}: seeded cover");
    assert_eq!(cover_art(&path).unwrap().as_deref(), Some(PNG), "{ext}");

    // Write six fields at once (the primary tag already exists after seeding).
    let changes = set(|t| {
      t.title = Some("Title One".into());
      t.artist = Some("Artist One".into());
      t.album = Some("Album One".into());
      t.genre = Some("Ambient".into());
      t.year = Some("1999".into());
      t.comment = Some("youtube:dQw4w9WgXcQ".into());
    });
    write(&path, &changes).unwrap();
    let after = verify(&path, &before, &changes).unwrap();
    assert_eq!(after.title, "Title One", "{ext}");
    assert_eq!(after.year, "1999", "{ext}");
    assert_eq!(after.codec, codec, "{ext}");
    assert_eq!(after.art_hash, before.art_hash, "{ext}: cover untouched");
    assert_eq!(track_number(&path), Some(7), "{ext}: track number untouched");

    // Some("") clears one field and nothing else.
    let clear = set(|t| t.album = Some(String::new()));
    write(&path, &clear).unwrap();
    let cleared = verify(&path, &after, &clear).unwrap();
    assert_eq!(cleared.album, "", "{ext}");
    assert_eq!(
      tagset_of(&TagRead {
        album: after.album.clone(),
        ..cleared.clone()
      }),
      tagset_of(&after),
      "{ext}: only the album changed"
    );
    assert_eq!(track_number(&path), Some(7), "{ext}");

    // Unicode: NFC accents, emoji, right-to-left scripts, and an NFD string kept as given.
    let unicode = set(|t| {
      t.title = Some("Caf\u{e9} del Mar \u{2615} \u{1f3b5}".into());
      t.artist = Some("\u{5e9}\u{5dc}\u{5d5}\u{5dd} & Beyonce\u{301}".into());
      t.album_artist = Some("\u{645}\u{631}\u{62d}\u{628}\u{627}".into());
    });
    write(&path, &unicode).unwrap();
    let u = verify(&path, &cleared, &unicode).unwrap();
    assert_eq!(u.artist, "\u{5e9}\u{5dc}\u{5d5}\u{5dd} & Beyonce\u{301}", "{ext}");
    assert_eq!(
      u.duration_ms.abs_diff(before.duration_ms),
      0,
      "{ext}: duration unchanged"
    );
  }
}

/// The tier-1 sequence as the write path runs it: hidden temp copy -> tag write -> verify ->
/// fsync -> atomic replace. Proves lofty can write a hidden file and that the result is the
/// user's file again (not hidden, new tags, same audio).
#[test]
fn write_on_a_hidden_temp_then_replace() {
  for (ext, _) in CONTAINERS {
    let (_dir, path) = copy_of(ext);
    let before = read(&path).unwrap();
    let tmp = crate::fs::copy_to_tmp(&path, "tagjob").unwrap();
    let changes = set(|t| {
      t.title = Some("Tone".into());
      t.artist = Some("Fixture".into());
    });
    write(&tmp, &changes).unwrap();
    verify(&tmp, &before, &changes).unwrap();
    assert_eq!(
      read(&path).unwrap(),
      before,
      "{ext}: the original is untouched until the replace"
    );
    crate::fs::fsync(&tmp).unwrap();
    crate::fs::atomic_replace(&tmp, &path).unwrap();
    assert!(!tmp.exists());
    let after = read(&path).unwrap();
    assert_eq!(
      (after.title.as_str(), after.artist.as_str()),
      ("Tone", "Fixture"),
      "{ext}"
    );
    #[cfg(windows)]
    {
      use std::os::windows::fs::MetadataExt;
      assert_eq!(
        std::fs::metadata(&path).unwrap().file_attributes() & 0x2,
        0,
        "{ext}: not hidden"
      );
    }
  }
}

/// An MP3 with only an ID3v1 trailer: `read` reports the ID3v1 fields, so the new ID3v2 tag must
/// start from them or every edit would fail verification. The ID3v1 trailer itself is not touched.
#[test]
fn seeds_a_missing_primary_tag_from_the_tag_that_was_read() {
  let (_dir, path) = copy_of("mp3");
  // The fixture carries ffmpeg's ID3v2 encoder frame; drop it to get an ID3v1-only file.
  TagType::Id3v2.remove_from_path(&path, WriteOptions::default()).unwrap();
  let mut v1 = Tag::new(TagType::Id3v1);
  v1.set_title("Old Title".into());
  v1.set_artist("Someone".into());
  v1.save_to_path(&path, WriteOptions::default()).unwrap();
  let before = read(&path).unwrap();
  assert_eq!(
    (before.title.as_str(), before.artist.as_str()),
    ("Old Title", "Someone")
  );
  let trailer = |p: &Path| {
    let b = std::fs::read(p).unwrap();
    b[b.len() - 128..].to_vec()
  };
  let v1_bytes = trailer(&path);

  let changes = set(|t| t.title = Some("New Title".into()));
  write(&path, &changes).unwrap();
  let after = verify(&path, &before, &changes).unwrap();
  assert_eq!((after.title.as_str(), after.artist.as_str()), ("New Title", "Someone"));
  assert_eq!(id3v2_major(&path), 4);
  assert_eq!(trailer(&path), v1_bytes, "the ID3v1 trailer is byte-identical");
}

#[test]
fn creates_the_primary_tag_when_missing() {
  for (ext, _) in CONTAINERS {
    let (_dir, path) = copy_of(ext);
    let before = read(&path).unwrap();
    let changes = set(|t| t.title = Some("Fresh".into()));
    write(&path, &changes).unwrap();
    assert_eq!(verify(&path, &before, &changes).unwrap().title, "Fresh", "{ext}");
  }
}

#[test]
fn values_are_trimmed_and_whitespace_clears() {
  let (_dir, path) = copy_of("mp3");
  let before = read(&path).unwrap();
  let changes = set(|t| {
    t.title = Some("  Padded  ".into());
    t.artist = Some("   ".into());
  });
  write(&path, &changes).unwrap();
  let after = verify(&path, &before, &changes).unwrap();
  assert_eq!((after.title.as_str(), after.artist.as_str()), ("Padded", ""));
}

fn id3v2_major(path: &Path) -> u8 {
  let head = std::fs::read(path).unwrap();
  assert_eq!(&head[..3], b"ID3");
  head[3]
}

#[test]
fn keeps_id3v23_only_when_the_file_had_it() {
  let (_dir, v23) = copy_of("mp3");
  let mut seed = Tag::new(TagType::Id3v2);
  seed.set_title("old".into());
  seed.save_to_path(&v23, WriteOptions::new().use_id3v23(true)).unwrap();
  assert_eq!(id3v2_major(&v23), 3);
  write(&v23, &set(|t| t.title = Some("new".into()))).unwrap();
  assert_eq!(id3v2_major(&v23), 3, "an ID3v2.3 file stays 2.3");
  assert_eq!(read(&v23).unwrap().title, "new");

  let (_dir2, fresh) = copy_of("mp3");
  write(&fresh, &set(|t| t.title = Some("new".into()))).unwrap();
  assert_eq!(id3v2_major(&fresh), 4, "a new tag is written as 2.4");
}

#[test]
fn read_only_file_is_refused_and_untouched() {
  let (_dir, path) = copy_of("flac");
  let original = std::fs::read(&path).unwrap();
  let mut perms = std::fs::metadata(&path).unwrap().permissions();
  perms.set_readonly(true);
  std::fs::set_permissions(&path, perms.clone()).unwrap();

  let err = write(&path, &set(|t| t.title = Some("nope".into()))).unwrap_err();
  assert!(
    matches!(err, Error::Refused(ref m) if m.starts_with("read-only")),
    "{err}"
  );
  assert_eq!(std::fs::read(&path).unwrap(), original);

  #[allow(clippy::permissions_set_readonly_false)] // test cleanup, so the temp dir can be removed
  perms.set_readonly(false);
  std::fs::set_permissions(&path, perms).unwrap();
}

#[test]
fn verify_catches_a_wrong_field_and_a_changed_duration() {
  let (_dir, path) = copy_of("m4a");
  let before = read(&path).unwrap();
  write(&path, &set(|t| t.title = Some("Written".into()))).unwrap();

  let intended = set(|t| t.title = Some("Something else".into()));
  assert!(matches!(verify(&path, &before, &intended), Err(Error::Verify(_))));

  let unintended = TagSet::default(); // title changed although nothing was asked
  assert!(matches!(verify(&path, &before, &unintended), Err(Error::Verify(_))));

  let longer = TagRead {
    duration_ms: before.duration_ms + 5000,
    ..before.clone()
  };
  let ok_fields = set(|t| t.title = Some("Written".into()));
  assert!(matches!(verify(&path, &longer, &ok_fields), Err(Error::Verify(_))));
  let other_codec = TagRead {
    codec: "flac".into(),
    ..before.clone()
  };
  assert!(matches!(verify(&path, &other_codec, &ok_fields), Err(Error::Verify(_))));
}

#[test]
fn lenient_read_never_fails() {
  let dir = tempfile::tempdir().unwrap();
  let junk = dir.path().join("not audio.mp3");
  std::fs::write(&junk, b"this is not an mp3").unwrap();
  assert!(read(&junk).is_err());
  assert_eq!(read_lenient(&junk), TagRead::default());
  assert_eq!(read_lenient(&dir.path().join("missing.m4a")), TagRead::default());
  assert!(matches!(read(&dir.path().join("missing.m4a")), Err(Error::Io(_))));
}

#[test]
fn tagset_of_is_a_full_pre_image() {
  let r = TagRead {
    title: "T".into(),
    year: "2001".into(),
    ..TagRead::default()
  };
  let t = tagset_of(&r);
  assert_eq!(t.title.as_deref(), Some("T"));
  assert_eq!(t.year.as_deref(), Some("2001"));
  assert_eq!(t.artist.as_deref(), Some(""), "empty fields replay as a clear");
  assert!(!t.is_empty());
}
