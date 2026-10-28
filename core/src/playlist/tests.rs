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
  for bad in ["", " lead.mp3", "trail.mp3 ", "./x.mp3", "a\nb.mp3", "a\r.mp3"] {
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

/// A root-level `#1 Song.mp3` used to be read as a comment and lost on the next rewrite. It is
/// written as `./#…` and read back without the `./`, so membership and lookups see the real path.
#[test]
fn entries_starting_with_hash_survive_a_round_trip() {
  let root = tmp_root();
  let entries = vec![
    "#1 Crush - Someone.mp3".to_string(),
    "#Faves/x.mp3".to_string(),
    "Chill/a.mp3".to_string(),
  ];
  write(root.path(), "Hash", &entries, "h1").unwrap();
  let path = root.path().join("_Playlists/Hash.m3u8");
  let bytes = std::fs::read(&path).unwrap();
  assert_eq!(
    bytes,
    b"#EXTM3U\n./#1 Crush - Someone.mp3\n./#Faves/x.mp3\nChill/a.mp3\n"
  );
  let back = read(root.path(), "Hash").unwrap();
  assert_eq!(back.entries, entries);
  // Re-serialising what was read is byte-identical, and the path is found as a member.
  write(root.path(), "Hash", &back.entries, "h2").unwrap();
  assert_eq!(std::fs::read(&path).unwrap(), bytes);
  let hits = containing(root.path(), &rel("#1 crush - someone.MP3")).unwrap();
  assert_eq!(hits.len(), 1);
  assert_eq!(
    with_path_replaced(&back.entries, &rel("#1 Crush - Someone.mp3"), None),
    vec!["#Faves/x.mp3", "Chill/a.mp3"]
  );
}

/// The reader strips one leading `./` from any line (another tool's relative form), so such a
/// line matches its track; playlists without `./` or `#` entries stay byte-identical.
#[test]
fn reader_strips_a_leading_dot_slash() {
  let root = tmp_root();
  let dir = root.path().join("_Playlists");
  std::fs::create_dir_all(&dir).unwrap();
  std::fs::write(dir.join("Dots.m3u8"), "#EXTM3U\n./a.mp3\n.\\Rock\\b.mp3\n").unwrap();
  assert_eq!(read(root.path(), "Dots").unwrap().entries, vec!["a.mp3", "Rock/b.mp3"]);
  let plain = "#EXTM3U\nRock/b.mp3\nc.flac\n";
  std::fs::write(dir.join("Plain.m3u8"), plain).unwrap();
  assert_eq!(render(&read(root.path(), "Plain").unwrap().entries), plain);
}

/// Only a missing playlist reads as NotFound. An unreadable one (not UTF-8, a folder in its place)
/// is another error, so the write path can never take it for absent and write over it.
#[test]
fn unreadable_playlists_are_errors_not_absent() {
  let root = tmp_root();
  let dir = root.path().join("_Playlists");
  std::fs::create_dir_all(&dir).unwrap();
  assert!(matches!(read(root.path(), "Missing"), Err(Error::NotFound(_))));

  std::fs::write(dir.join("Latin.m3u8"), b"#EXTM3U\nCaf\xe9.mp3\n").unwrap();
  let err = read(root.path(), "Latin").unwrap_err();
  assert!(!matches!(err, Error::NotFound(_)), "{err}");
  assert!(list(root.path()).is_err(), "list must not skip an unreadable playlist");

  std::fs::remove_file(dir.join("Latin.m3u8")).unwrap();
  std::fs::create_dir_all(dir.join("Folder.m3u8")).unwrap();
  let err = read(root.path(), "Folder").unwrap_err();
  assert!(!matches!(err, Error::NotFound(_)), "{err}");
  assert!(
    list(root.path()).unwrap().is_empty(),
    "a folder is not listed as a playlist"
  );
}

/// A playlist held open without read sharing (a sync client mid-upload) is an error, not empty.
#[cfg(windows)]
#[test]
fn a_locked_playlist_is_an_error() {
  use std::os::windows::fs::OpenOptionsExt;
  let root = tmp_root();
  write(root.path(), "Locked", &["a.mp3".to_string()], "l1").unwrap();
  let path = root.path().join("_Playlists/Locked.m3u8");
  let holder = std::fs::OpenOptions::new()
    .read(true)
    .share_mode(0)
    .open(&path)
    .unwrap();
  let err = read(root.path(), "Locked").unwrap_err();
  assert!(!matches!(err, Error::NotFound(_)), "{err}");
  assert!(list(root.path()).is_err());
  drop(holder);
  assert_eq!(read(root.path(), "Locked").unwrap().entries, vec!["a.mp3"]);
}

const JOB: &str = "0123456789abcdef0123456789abcdef";

/// The checked write renames its new version into place only while the playlist is still what the
/// caller read: the same bytes, or still absent for a new one. Otherwise the playlist is left as it
/// is, the temp goes, and the error says the playlist changed.
#[test]
fn write_expecting_leaves_a_playlist_that_changed_since_it_was_read() {
  let root = tmp_root();
  write(root.path(), "P", &["a.mp3".to_string()], JOB).unwrap();
  let path = root.path().join("_Playlists/P.m3u8");
  let read_back = read_exact(root.path(), "P").unwrap();
  assert!(read_back.ours);
  // Someone else's version lands after the read.
  std::fs::write(&path, "#EXTM3U\na.mp3\nphone.mp3\n").unwrap();
  let new = ["a.mp3".to_string(), "b.mp3".to_string()];
  let err = write_expecting(root.path(), "P", &new, JOB, Some(Expect::Hash(&read_back.hash))).unwrap_err();
  assert!(is_changed(&err), "{err}");
  assert_eq!(err.to_string(), "refused: the playlist P changed since it was read");
  assert_eq!(std::fs::read_to_string(&path).unwrap(), "#EXTM3U\na.mp3\nphone.mp3\n");
  assert_eq!(
    std::fs::read_dir(root.path().join("_Playlists")).unwrap().count(),
    1,
    "no temp left"
  );
  // A playlist that appeared meanwhile is not taken over by a create.
  let err = write_expecting(root.path(), "P", &[], JOB, Some(Expect::Absent)).unwrap_err();
  assert!(is_changed(&err), "{err}");
  // Still as read: written.
  let now = read_exact(root.path(), "P").unwrap();
  write_expecting(root.path(), "P", &new, JOB, Some(Expect::Hash(&now.hash))).unwrap();
  assert_eq!(read(root.path(), "P").unwrap().entries, new);
  write_expecting(root.path(), "Q", &new, JOB, Some(Expect::Absent)).unwrap();
}

/// `ours` is true only for the exact bytes the app writes: any comment, `#EXTINF`, BOM, CRLF,
/// backslash, blank line or missing header makes it another program's file.
#[test]
fn read_exact_tells_the_apps_own_format_from_another_programs() {
  let root = tmp_root();
  let dir = root.path().join("_Playlists");
  std::fs::create_dir_all(&dir).unwrap();
  let cases: [(&str, bool); 9] = [
    ("#EXTM3U\na.mp3\nRock/b.mp3\n", true),
    ("#EXTM3U\n", true),
    ("#EXTM3U\n./#1 Song.mp3\n", true),
    ("\u{feff}#EXTM3U\na.mp3\n", false),
    ("#EXTM3U\r\na.mp3\r\n", false),
    ("#EXTM3U\n#EXTINF:1,x\na.mp3\n", false),
    ("#EXTM3U\nRock\\b.mp3\n", false),
    ("a.mp3\n", false),
    ("", false),
  ];
  for (text, ours) in cases {
    std::fs::write(dir.join("X.m3u8"), text).unwrap();
    let x = read_exact(root.path(), "X").unwrap();
    assert_eq!(x.ours, ours, "{text:?}");
    assert_eq!(x.hash, blake3::hash(text.as_bytes()).to_hex().to_string());
  }
  assert!(matches!(read_exact(root.path(), "Missing"), Err(Error::NotFound(_))));
}
