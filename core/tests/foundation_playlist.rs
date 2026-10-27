//! Pins the pre-rebuild host's playlist behaviour (`read_playlist_file`, `load_playlists`,
//! `playlist_add/remove`, `update_playlists_for_path`, `playlists_from_folders`,
//! `sanitize_folder_name`) on the ported public API, plus the NFC-key / byte-exact rules.

use soundhood_core::fs::FileStamp;
use soundhood_core::playlist;
use soundhood_core::{Error, PlaylistFile, RelPath};
use std::path::Path;

fn rel(s: &str) -> RelPath {
  RelPath::new(s).unwrap()
}

fn strings(v: &[&str]) -> Vec<String> {
  v.iter().map(|s| s.to_string()).collect()
}

fn put(root: &Path, rel: &str, bytes: &[u8]) {
  let p = root.join(rel);
  std::fs::create_dir_all(p.parent().unwrap()).unwrap();
  std::fs::write(p, bytes).unwrap();
}

#[test]
fn reader_strips_bom_trims_skips_comments_and_turns_backslashes() {
  let d = tempfile::tempdir().unwrap();
  let text = "\u{feff}#EXTM3U\r\n#EXTINF:123,Old - Comment\r\n  Chill\\A - B.m4a  \r\n\r\n\u{feff}x.mp3\n   \n# trailing comment\nlast.flac";
  put(d.path(), "_Playlists/Mix.m3u8", text.as_bytes());
  let pl = playlist::read(d.path(), "Mix").unwrap();
  assert_eq!(pl.name, "Mix");
  assert_eq!(pl.entries, strings(&["Chill/A - B.m4a", "x.mp3", "last.flac"]));
}

#[test]
fn render_is_the_exact_on_disk_format() {
  assert_eq!(playlist::render(&[]), "#EXTM3U\n");
  assert_eq!(
    playlist::render(&strings(&["a/b.mp3", "c.m4a"])),
    "#EXTM3U\na/b.mp3\nc.m4a\n"
  );
}

#[test]
fn rendering_what_was_read_reproduces_an_app_written_file() {
  let d = tempfile::tempdir().unwrap();
  let original = "#EXTM3U\nRock/Mo\u{308}tley - X.mp3\nPop/Caf\u{e9}.m4a\n";
  put(d.path(), "_Playlists/P.m3u8", original.as_bytes());
  let pl = playlist::read(d.path(), "P").unwrap();
  assert_eq!(playlist::render(&pl.entries), original);
}

#[test]
fn list_sorts_case_insensitively_and_takes_m3u8_and_m3u() {
  let d = tempfile::tempdir().unwrap();
  let r = d.path();
  put(r, "_Playlists/beta.m3u8", b"#EXTM3U\nb.mp3\n");
  put(r, "_Playlists/Alpha.m3u", b"#EXTM3U\na.mp3\n");
  put(r, "_Playlists/GAMMA.M3U8", b"#EXTM3U\n");
  put(r, "_Playlists/notes.txt", b"not a playlist");
  put(r, "_Playlists/_smart/Smart.m3u8", b"#EXTM3U\n");
  let lists = playlist::list(r).unwrap();
  let names: Vec<&str> = lists.iter().map(|p| p.name.as_str()).collect();
  assert_eq!(names, vec!["Alpha", "beta", "GAMMA"]);
  assert_eq!(lists[0].entries, strings(&["a.mp3"]));
}

#[test]
fn list_without_a_playlists_folder_is_empty() {
  let d = tempfile::tempdir().unwrap();
  assert!(playlist::list(d.path()).unwrap().is_empty());
}

#[test]
fn a_playlist_that_is_not_utf8_is_an_error_not_an_empty_list() {
  let d = tempfile::tempdir().unwrap();
  put(d.path(), "_Playlists/Latin1.m3u", b"#EXTM3U\nCaf\xe9.mp3\n");
  assert!(playlist::list(d.path()).is_err());
}

#[test]
fn read_of_a_missing_playlist_is_not_found() {
  let d = tempfile::tempdir().unwrap();
  assert!(matches!(playlist::read(d.path(), "Nope"), Err(Error::NotFound(_))));
}

#[test]
fn names_are_sanitised_like_sanitize_folder_name() {
  assert_eq!(playlist::sanitize_name("  Chill  ").unwrap(), "Chill");
  assert_eq!(playlist::sanitize_name(" ..Road Trip.. ").unwrap(), "Road Trip");
  assert_eq!(
    playlist::sanitize_name("Caf\u{e9} \u{1f3b5}").unwrap(),
    "Caf\u{e9} \u{1f3b5}"
  );
  for bad in [
    "", "   ", "...", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b",
  ] {
    assert!(playlist::sanitize_name(bad).is_err(), "{bad:?}");
  }
  assert_eq!(playlist::file_rel(" Chill ").unwrap().as_str(), "_Playlists/Chill.m3u8");
  assert!(playlist::file_rel("a/b").is_err());
}

#[test]
fn add_skips_members_case_insensitively_and_appends_in_order() {
  let entries = strings(&["Chill/A - B.m4a"]);
  let out = playlist::with_added(
    &entries,
    &[rel("chill/a - b.M4A"), rel("x.mp3"), rel("X.MP3"), rel("y.mp3")],
  );
  assert_eq!(out, strings(&["Chill/A - B.m4a", "x.mp3", "y.mp3"]));
}

#[test]
fn add_treats_nfc_and_nfd_spellings_as_one_member() {
  let entries = strings(&["Rock/Mo\u{308}tley.mp3"]);
  assert_eq!(playlist::with_added(&entries, &[rel("Rock/M\u{f6}tley.mp3")]), entries);
}

#[test]
fn remove_is_case_insensitive_and_keeps_order() {
  let entries = strings(&["a.mp3", "B.mp3", "c.mp3", "b.MP3"]);
  assert_eq!(
    playlist::with_removed(&entries, &[rel("b.mp3")]),
    strings(&["a.mp3", "c.mp3"])
  );
  assert_eq!(playlist::with_removed(&entries, &[]), entries);
}

#[test]
fn path_replaced_follows_a_move_and_drops_on_delete() {
  let entries = strings(&["a.mp3", "Chill/Song.m4a", "z.mp3"]);
  let from = rel("chill/song.m4a");
  assert_eq!(
    playlist::with_path_replaced(&entries, &from, Some(&rel("Party/Song.m4a"))),
    strings(&["a.mp3", "Party/Song.m4a", "z.mp3"]),
    "position kept"
  );
  assert_eq!(
    playlist::with_path_replaced(&entries, &from, None),
    strings(&["a.mp3", "z.mp3"])
  );
  assert_eq!(playlist::with_path_replaced(&entries, &rel("other.mp3"), None), entries);
}

#[test]
fn containing_finds_playlists_that_mention_a_file() {
  let d = tempfile::tempdir().unwrap();
  let r = d.path();
  put(r, "_Playlists/One.m3u8", b"#EXTM3U\nChill/Song.m4a\n");
  put(r, "_Playlists/Two.m3u", b"#EXTM3U\nCHILL\\SONG.M4A\nother.mp3\n");
  put(r, "_Playlists/Three.m3u8", b"#EXTM3U\nother.mp3\n");
  let names: Vec<String> = playlist::containing(r, &rel("chill/song.m4a"))
    .unwrap()
    .into_iter()
    .map(|p| p.name)
    .collect();
  assert_eq!(names, vec!["One", "Two"]);
}

fn stamp(r: &str) -> FileStamp {
  FileStamp {
    rel: rel(r),
    mtime: 0,
    size: 0,
  }
}

#[test]
fn plan_from_folders_one_playlist_per_first_level_folder() {
  let d = tempfile::tempdir().unwrap();
  let stamps: Vec<FileStamp> = [
    "Loose - Root.mp3",
    "Chill/b.m4a",
    "Chill/Sub/A.mp3",
    "Chill/c.m4a",
    "Party/z.mp3",
    "(root)/odd.mp3",
    "_Playlists/x.mp3",
  ]
  .into_iter()
  .map(stamp)
  .collect();
  let plan = playlist::plan_from_folders(d.path(), &stamps).unwrap();
  assert_eq!(
    plan,
    vec![
      PlaylistFile {
        name: "Chill".into(),
        // filename order (lower-cased), across sub-folders, like the old host
        entries: strings(&["Chill/Sub/A.mp3", "Chill/b.m4a", "Chill/c.m4a"]),
      },
      PlaylistFile {
        name: "Party".into(),
        entries: strings(&["Party/z.mp3"]),
      },
    ]
  );
  assert!(!d.path().join("_Playlists").exists(), "a plan writes nothing");
}

#[test]
fn plan_from_folders_never_overwrites_an_existing_playlist() {
  let d = tempfile::tempdir().unwrap();
  put(d.path(), "_Playlists/chill.m3u8", b"#EXTM3U\nmine.mp3\n");
  put(d.path(), "_Playlists/Party.m3u", b"#EXTM3U\n");
  let stamps: Vec<FileStamp> = ["Chill/a.mp3", "Party/b.mp3", "Rock/c.mp3"]
    .into_iter()
    .map(stamp)
    .collect();
  let plan = playlist::plan_from_folders(d.path(), &stamps).unwrap();
  let names: Vec<&str> = plan.iter().map(|p| p.name.as_str()).collect();
  assert_eq!(names, vec!["Rock"]);
}
