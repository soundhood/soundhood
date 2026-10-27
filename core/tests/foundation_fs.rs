//! Public fs behaviour: scan, stamps, hashes, device id, temp-file discovery.

use soundhood_core::fs::{self, FileStamp};
use soundhood_core::RelPath;
use std::path::Path;

fn touch(root: &Path, rel: &str, bytes: &[u8]) {
  let p = root.join(rel);
  std::fs::create_dir_all(p.parent().unwrap()).unwrap();
  std::fs::write(p, bytes).unwrap();
}

fn rels(stamps: &[FileStamp]) -> Vec<&str> {
  stamps.iter().map(|s| s.rel.as_str()).collect()
}

#[test]
fn scan_finds_audio_and_skips_app_dot_and_temp_files() {
  let d = tempfile::tempdir().unwrap();
  let r = d.path();
  touch(r, "Root Song - A.mp3", b"1");
  touch(r, "Chill/B - C.M4A", b"22");
  touch(r, "Chill/Deep/Nested - D.flac", b"333");
  touch(r, "Chill/cover.jpg", b"x");
  touch(r, "Chill/.soundhood-tmp-job1.m4a", b"temp");
  touch(r, "_Soundhood/.bin/2026-10/x.mp3", b"binned");
  touch(r, "_soundhood/journal.mp3", b"app dir, other case");
  touch(r, "_Playlists/Mix.m3u8", b"#EXTM3U\n");
  touch(r, "_PLAYLISTS/odd.mp3", b"app dir, other case");
  touch(r, ".stfolder/x.mp3", b"dot dir");
  touch(r, "Chill/.hidden/y.ogg", b"dot dir below");
  touch(
    r,
    "Rock/_Playlists/kept.opus",
    b"only the top-level app folders are skipped",
  );
  touch(r, "noext", b"");

  let stamps = fs::scan(r).unwrap();
  assert_eq!(
    rels(&stamps),
    vec![
      "Chill/B - C.M4A",
      "Chill/Deep/Nested - D.flac",
      "Rock/_Playlists/kept.opus",
      "Root Song - A.mp3",
    ]
  );
  assert_eq!(stamps[0].size, 2);
  assert_eq!(stamps[1].size, 3);
  for s in &stamps {
    assert_eq!(fs::stamp(&s.rel.to_abs(r)).unwrap(), (s.mtime, s.size));
    assert!(s.mtime > 1_600_000_000, "unix seconds");
  }
}

#[test]
fn scan_keeps_nfd_names_exactly_and_they_still_open() {
  let d = tempfile::tempdir().unwrap();
  // o + U+0308: the decomposed form some sources hand over. NTFS keeps it as a different name.
  let nfd = "Rock/Mo\u{308}tley Cru\u{308}e - Kickstart.mp3";
  touch(d.path(), nfd, b"nfd");
  let stamps = fs::scan(d.path()).unwrap();
  assert_eq!(rels(&stamps), vec![nfd]);
  assert_eq!(std::fs::read(stamps[0].rel.to_abs(d.path())).unwrap(), b"nfd");
  // ...and it compares equal to the NFC spelling through the key.
  assert_eq!(
    stamps[0].rel.key(),
    RelPath::new("rock/m\u{f6}tley cr\u{fc}e - kickstart.mp3")
      .unwrap()
      .key()
  );
}

#[test]
fn scan_of_a_missing_root_is_an_error() {
  let d = tempfile::tempdir().unwrap();
  assert!(fs::scan(&d.path().join("nope")).is_err());
}

#[test]
fn file_hash_is_streamed_blake3_hex() {
  let d = tempfile::tempdir().unwrap();
  let empty = d.path().join("empty.mp3");
  std::fs::write(&empty, b"").unwrap();
  assert_eq!(
    fs::file_hash(&empty).unwrap(),
    "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
  );
  let big: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
  let p = d.path().join("big.flac");
  std::fs::write(&p, &big).unwrap();
  assert_eq!(fs::file_hash(&p).unwrap(), blake3::hash(&big).to_hex().to_string());
}

#[test]
fn device_id_is_created_once_and_then_stable() {
  let d = tempfile::tempdir().unwrap();
  let app = d.path().join("app data");
  let first = fs::device_id(&app).unwrap();
  assert!(uuid::Uuid::parse_str(&first.0).is_ok(), "{first}");
  assert_eq!(fs::device_id(&app).unwrap(), first);
  let names: Vec<String> = std::fs::read_dir(&app)
    .unwrap()
    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
    .collect();
  assert_eq!(names, vec!["device-id"], "no temp left behind");
}

#[test]
fn device_id_replaces_a_file_that_is_not_an_id() {
  let d = tempfile::tempdir().unwrap();
  std::fs::write(d.path().join("device-id"), "../../etc").unwrap();
  let id = fs::device_id(d.path()).unwrap();
  assert!(uuid::Uuid::parse_str(&id.0).is_ok(), "{id}");
}

#[test]
fn list_tmp_files_finds_temps_everywhere_but_dot_folders() {
  let d = tempfile::tempdir().unwrap();
  let r = d.path();
  touch(r, "Chill/.soundhood-tmp-a.m4a", b"");
  touch(r, "_Playlists/.soundhood-tmp-b.m3u8", b"");
  touch(r, ".soundhood-tmp-c.mp3", b"");
  touch(r, ".git/.soundhood-tmp-d.mp3", b"");
  touch(r, "Chill/song.m4a", b"");
  let found: Vec<String> = fs::list_tmp_files(r).unwrap().into_iter().map(String::from).collect();
  assert_eq!(
    found,
    vec![
      ".soundhood-tmp-c.mp3",
      "Chill/.soundhood-tmp-a.m4a",
      "_Playlists/.soundhood-tmp-b.m3u8"
    ]
  );
}

#[test]
fn bin_record_serialises_for_the_journal() {
  let rec = fs::BinRecord {
    kind: fs::BinKind::Os,
    original: RelPath::new("Chill/a.mp3").unwrap(),
    bin_rel: None,
    deleted_at: 1_790_000_000,
  };
  let json = serde_json::to_string(&rec).unwrap();
  assert_eq!(
    json,
    r#"{"kind":"os","original":"Chill/a.mp3","bin_rel":null,"deleted_at":1790000000}"#
  );
  assert_eq!(serde_json::from_str::<fs::BinRecord>(&json).unwrap(), rec);
}
