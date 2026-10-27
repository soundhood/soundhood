//! The api facade over the write path. Every test here opens a `Core`, which opens the index:
//! they are ignored until the index (zone core-index) lands in the same tree. The lead re-enables
//! them after the merge (`cargo test -p soundhood-core --test writepath_api -- --ignored`).

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::api::Core;
use soundhood_core::model::Platform;
use soundhood_core::{playlist, Error};
use std::path::PathBuf;
use support::*;

/// Opens the fixture library with its own app-data dir. The platform is switched to Android so a
/// delete goes to the app bin inside the temp library, never to this machine's recycle bin.
fn open(root: &std::path::Path) -> (Core, tempfile::TempDir) {
  let app = tempfile::tempdir().unwrap();
  let (mut core, _) = Core::open(root, app.path(), None).unwrap();
  core.lib.platform = Platform::Android;
  (core, app)
}

#[test]
fn open_removes_orphans_and_write_tags_returns_the_reread_track() {
  let (d, _, report) = fixture_lib(10, false);
  std::fs::write(d.path().join("Ambient/.soundhood-tmp-0123abcd.m4a"), b"partial").unwrap();
  let app = tempfile::tempdir().unwrap();
  let (core, opened) = Core::open(d.path(), app.path(), None).unwrap();
  assert_eq!(
    opened.orphans_removed,
    vec!["Ambient/.soundhood-tmp-0123abcd.m4a".to_string()]
  );
  assert!(!opened.device.is_empty());
  assert_eq!(core.index_path().parent(), Some(app.path()));
  assert_eq!(core.scan().unwrap().len(), 10);

  let r = track_with_ext(&report, "m4a");
  let abs = core.lib.abs(&r);
  let (track, rep) = core.write_tags(&abs, " New Title ", "Someone Else").unwrap();
  assert_eq!(
    (track.title.as_str(), track.artist.as_str()),
    ("New Title", "Someone Else")
  );
  assert_eq!(rep.applied.len(), 1);
  // The same values again: no change, still a success.
  let (_, again) = core.write_tags(&abs, "New Title", "Someone Else").unwrap();
  assert!(again.applied.is_empty());

  let last = core.last_change().unwrap().unwrap();
  assert_eq!(last.label, format!("Edited tags of {}", r.file_name()));
  let undone = core.undo_last().unwrap();
  assert_eq!(undone.applied.len(), 1);
  assert!(
    matches!(core.undo_last(), Err(Error::Refused(_))),
    "nothing left to undo"
  );
}

#[test]
fn move_and_delete_report_refusals_as_errors() {
  let (d, _, _) = fixture_lib(20, false);
  let (core, _app) = open(d.path());
  core.scan().unwrap();
  let fav = playlist::read(d.path(), "Favourites").unwrap();
  let r = rel(fav.entries.iter().find(|e| e.contains('/')).unwrap());
  let target = if r.top_folder() == Some("Evenings") {
    "Ambient"
  } else {
    "Evenings"
  };

  let (track, rep) = core.move_track(&core.lib.abs(&r), target).unwrap();
  assert_eq!(rep.applied.len(), 1);
  assert_eq!(track.playlist, target);
  assert!(track.path.ends_with(r.file_name()));
  let moved = PathBuf::from(&track.path);
  assert!(playlist::read(d.path(), "Favourites")
    .unwrap()
    .entries
    .iter()
    .any(|e| e == &format!("{target}/{}", r.file_name())));

  // Into the folder it is already in: refused with the old host's words.
  match core.move_track(&moved, target) {
    Err(Error::Exists(m)) => assert_eq!(m, format!("{} already exists in {target}", r.file_name())),
    other => panic!("{other:?}"),
  }
  assert!(matches!(
    core.move_track(&moved, "_Playlists"),
    Err(Error::InvalidPath(_))
  ));

  let mut perm = std::fs::metadata(&moved).unwrap().permissions();
  perm.set_readonly(true);
  std::fs::set_permissions(&moved, perm.clone()).unwrap();
  match core.delete_track(&moved) {
    Err(Error::Refused(m)) => assert_eq!(m, "read-only file"),
    other => panic!("{other:?}"),
  }
  #[allow(clippy::permissions_set_readonly_false)]
  perm.set_readonly(false);
  std::fs::set_permissions(&moved, perm).unwrap();

  let rep = core.delete_track(&moved).unwrap();
  assert_eq!(rep.applied.len(), 1);
  assert!(!moved.exists());
  assert!(core.undo_last().unwrap().failed.is_empty());
  assert!(moved.exists(), "back from the bin");
}

#[test]
fn playlist_commands_return_the_playlist_and_never_error_on_no_change() {
  let (d, _, report) = fixture_lib(10, false);
  let (core, _app) = open(d.path());
  let paths: Vec<PathBuf> = report
    .tracks
    .iter()
    .take(2)
    .map(|t| core.lib.abs(&rel(&t.rel)))
    .collect();
  let (pl, rep) = core.playlist_add("Road Trip", &paths).unwrap();
  assert_eq!(pl.entries.len(), 2);
  assert_eq!(rep.applied[0].label, "Added 2 tracks to Road Trip");
  let (pl, rep) = core.playlist_add("road trip", &paths[..1]).unwrap();
  assert_eq!(pl.entries.len(), 2);
  assert!(rep.applied.is_empty());
  let (pl, _) = core.playlist_remove("Road Trip", &paths[..1]).unwrap();
  assert_eq!(pl.entries.len(), 1);
  let (pl, rep) = core.playlist_create("Road Trip").unwrap();
  assert_eq!(pl.entries.len(), 1, "an existing playlist is returned as it is");
  assert!(rep.applied.is_empty());
  core.playlist_delete("Road Trip").unwrap();
  assert!(matches!(core.playlist_delete("Road Trip"), Err(Error::NotFound(_))));
  let outside = std::env::temp_dir().join("elsewhere.mp3");
  assert!(
    core.playlist_add("Road Trip", &[outside]).is_err(),
    "a path outside the library"
  );
  let (all, _) = core.playlists_from_folders().unwrap();
  assert!(all.len() >= 5);
  assert_eq!(core.playlists().unwrap(), all);
}
