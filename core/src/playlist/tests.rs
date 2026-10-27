//! The sole writer (pub(crate)) and the byte-exact round trip. Public behaviour is pinned in
//! `core/tests/foundation_playlist.rs`.

use super::*;

fn rel(s: &str) -> RelPath {
  RelPath::new(s).unwrap()
}

fn tmp_root() -> tempfile::TempDir {
  tempfile::tempdir().unwrap()
}

#[test]
fn write_produces_the_old_hosts_bytes() {
  let root = tmp_root();
  let entries = vec!["Chill/A - B.m4a".to_string(), "x.mp3".to_string()];
  write(root.path(), " Chill ", &entries, "job1").unwrap();
  let bytes = std::fs::read(root.path().join("_Playlists/Chill.m3u8")).unwrap();
  assert_eq!(bytes, b"#EXTM3U\nChill/A - B.m4a\nx.mp3\n");
  // no temp left behind, and the result is a normal (not hidden) file
  assert!(crate::fs::list_tmp_files(root.path()).unwrap().is_empty());
  #[cfg(windows)]
  {
    use std::os::windows::fs::MetadataExt;
    let attrs = std::fs::metadata(root.path().join("_Playlists/Chill.m3u8"))
      .unwrap()
      .file_attributes();
    assert_eq!(attrs & 0x2, 0, "the playlist must not inherit the temp's hidden bit");
  }
}

#[test]
fn empty_playlist_is_just_the_header() {
  let root = tmp_root();
  write(root.path(), "Empty", &[], "j").unwrap();
  assert_eq!(
    std::fs::read(root.path().join("_Playlists/Empty.m3u8")).unwrap(),
    b"#EXTM3U\n"
  );
}

#[test]
fn re_serialising_an_existing_m3u8_is_byte_identical_including_nfd() {
  let root = tmp_root();
  let dir = root.path().join("_Playlists");
  std::fs::create_dir_all(&dir).unwrap();
  // An NFD name (o + U+0308) as it sits on disk and in the m3u8, next to an NFC one.
  let original = "#EXTM3U\nRock/Mo\u{308}tley Cru\u{308}e - Kickstart.mp3\nPop/Caf\u{e9} - X.m4a\nz.flac\n";
  std::fs::write(dir.join("Mix.m3u8"), original).unwrap();

  let pl = read(root.path(), "Mix").unwrap();
  assert_eq!(
    pl.entries[0], "Rock/Mo\u{308}tley Cru\u{308}e - Kickstart.mp3",
    "kept NFD"
  );
  assert_eq!(render(&pl.entries), original);
  write(root.path(), "Mix", &pl.entries, "rt").unwrap();
  assert_eq!(std::fs::read(dir.join("Mix.m3u8")).unwrap(), original.as_bytes());
}

#[test]
fn replaces_an_existing_playlist_atomically() {
  let root = tmp_root();
  write(root.path(), "P", &["a.mp3".to_string()], "1").unwrap();
  write(root.path(), "P", &["b.mp3".to_string(), "a.mp3".to_string()], "2").unwrap();
  assert_eq!(read(root.path(), "P").unwrap().entries, vec!["b.mp3", "a.mp3"]);
}

#[test]
fn refuses_lines_that_would_not_read_back() {
  let root = tmp_root();
  for bad in ["", " lead.mp3", "trail.mp3 ", "#Faves/x.mp3", "a\nb.mp3", "a\r.mp3"] {
    let err = write(root.path(), "P", &[bad.to_string()], "j").unwrap_err();
    assert!(matches!(err, Error::InvalidPath(_)), "{bad:?}: {err}");
  }
  assert!(!root.path().join("_Playlists/P.m3u8").exists(), "nothing written");
  assert!(crate::fs::list_tmp_files(root.path()).unwrap().is_empty());
}

#[test]
fn refuses_a_bad_name_before_touching_disk() {
  let root = tmp_root();
  assert!(write(root.path(), "a/b", &[], "j").is_err());
  assert!(write(root.path(), " .. ", &[], "j").is_err());
  assert!(!root.path().join("_Playlists").exists());
}

#[test]
fn a_leftover_temp_with_the_same_job_is_never_clobbered() {
  let root = tmp_root();
  let dir = root.path().join("_Playlists");
  std::fs::create_dir_all(&dir).unwrap();
  let stale = crate::fs::tmp_path(&dir, "same", "m3u8");
  std::fs::write(&stale, "stale").unwrap();
  assert!(matches!(write(root.path(), "P", &[], "same"), Err(Error::Exists(_))));
  assert_eq!(std::fs::read_to_string(&stale).unwrap(), "stale");
}

#[test]
fn list_ignores_the_writers_temp_files() {
  let root = tmp_root();
  write(root.path(), "Real", &["a.mp3".to_string()], "1").unwrap();
  std::fs::write(root.path().join("_Playlists/.soundhood-tmp-9.m3u8"), "#EXTM3U\nb.mp3\n").unwrap();
  let names: Vec<String> = list(root.path()).unwrap().into_iter().map(|p| p.name).collect();
  assert_eq!(names, vec!["Real"]);
}

#[test]
fn transforms_compare_nfc_and_case_but_keep_bytes() {
  let entries = vec!["Rock/Mo\u{308}tley.mp3".to_string(), "Pop/a.mp3".to_string()];
  let nfc_upper = rel("ROCK/M\u{d6}TLEY.MP3");
  let one = std::slice::from_ref(&nfc_upper);
  assert_eq!(with_added(&entries, one), entries, "already a member");
  assert_eq!(with_removed(&entries, one), vec!["Pop/a.mp3"]);
  assert_eq!(
    with_path_replaced(&entries, &nfc_upper, Some(&rel("Metal/M\u{f6}tley.mp3"))),
    vec!["Metal/M\u{f6}tley.mp3", "Pop/a.mp3"]
  );
}
