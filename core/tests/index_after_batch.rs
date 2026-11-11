//! The index after a journaled batch. Change detection compares whole-second mtime and size, and a
//! tag rewrite of an m4a, opus or ogg file keeps its size, so an edit and its undo (or two edits)
//! inside one second leave the stamps as they were. Every batch re-reads the files its report names,
//! so the index is right for them whatever the stamps say (review round 2, library MAJOR 1).

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::api::Core;
use soundhood_core::fixtures::FixtureTrack;
use soundhood_core::model::{Platform, RelPath};
use soundhood_core::{fs, Track};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use support::*;

/// What the index shows for `rel` now (an incremental scan, as the UI runs after an undo).
fn indexed(core: &Core, rel: &RelPath) -> Track {
  let abs = core.lib.abs(rel);
  core
    .scan()
    .unwrap()
    .into_iter()
    .find(|t| Path::new(&t.path) == abs.as_path())
    .expect("the track is listed")
}

/// What the file holds: a fresh index of its own reads every file.
fn on_disk(core: &Core, rel: &RelPath) -> String {
  let app = tempfile::tempdir().unwrap();
  let (fresh, _) = Core::open(&core.lib.root, app.path(), None).unwrap();
  indexed(&fresh, rel).title
}

/// Waits for the start of the next second, so the writes that follow share one mtime second.
fn next_second() {
  let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
  let rest = Duration::from_nanos(u64::from(1_000_000_000 - now.subsec_nanos()));
  std::thread::sleep(rest + Duration::from_millis(5));
}

/// A fixture library, scanned, and one tagged track of each format whose tag rewrite keeps the file
/// size (m4a, opus and ogg keep padding; a title of the same length fits it).
fn library() -> (tempfile::TempDir, tempfile::TempDir, Core, Vec<FixtureTrack>) {
  let (d, _, report) = fixture_lib(24, false);
  let app = tempfile::tempdir().unwrap();
  let (mut core, _) = Core::open(d.path(), app.path(), None).unwrap();
  core.lib.platform = Platform::Android;
  core.scan().unwrap();
  let tracks: Vec<FixtureTrack> = [".m4a", ".opus", ".ogg"]
    .iter()
    .filter_map(|ext| {
      report
        .tracks
        .iter()
        .find(|t| t.rel.ends_with(ext) && t.note.is_empty() && !t.title.is_empty() && !t.artist.is_empty())
        .cloned()
    })
    .collect();
  assert_eq!(tracks.len(), 3, "the fixture has an m4a, an opus and an ogg track");
  (d, app, core, tracks)
}

#[test]
fn an_edit_and_its_undo_in_one_second_leave_the_index_right() {
  let (_d, _app, core, tracks) = library();
  // Cases the stamps alone could not see: the undo left the same second and the same size.
  let mut blind = 0;
  for t in &tracks {
    let r = rel(&t.rel);
    let abs = core.lib.abs(&r);
    next_second();
    let (edited, edit) = core.write_tags(&abs, "Oops Title", &t.artist).unwrap();
    let after_edit = fs::stamp(&abs).unwrap();
    let undo = core.undo_batch(&edit.batch).unwrap();
    let after_undo = fs::stamp(&abs).unwrap();
    assert_eq!(
      (edit.applied.len(), undo.applied.len()),
      (1, 1),
      "{}: {}",
      t.rel,
      show(&undo)
    );
    blind += usize::from(after_edit == after_undo);

    assert_eq!(edited.title, "Oops Title", "{}: the edit's own track", t.rel);
    assert_eq!(
      on_disk(&core, &r),
      t.title,
      "{}: the undo put the title back on disk",
      t.rel
    );
    assert_eq!(indexed(&core, &r).title, t.title, "{}: the index after the undo", t.rel);
  }
  assert!(
    blind > 0,
    "no edit and undo shared a second and a size ({} tried)",
    tracks.len()
  );
}

#[test]
fn two_edits_in_one_second_leave_the_index_right() {
  let (_d, _app, core, tracks) = library();
  let mut blind = 0;
  for t in &tracks {
    let r = rel(&t.rel);
    let abs = core.lib.abs(&r);
    // Same length, so the second edit keeps the size the first one left.
    next_second();
    core.write_tags(&abs, "Oops Title One", &t.artist).unwrap();
    let after_first = fs::stamp(&abs).unwrap();
    let (track, second) = core.write_tags(&abs, "Oops Title Two", &t.artist).unwrap();
    let after_second = fs::stamp(&abs).unwrap();
    assert_eq!(second.applied.len(), 1, "{}: {}", t.rel, show(&second));
    blind += usize::from(after_first == after_second);

    assert_eq!(track.title, "Oops Title Two", "{}: the second edit's own track", t.rel);
    assert_eq!(
      indexed(&core, &r).title,
      "Oops Title Two",
      "{}: the index after the second edit",
      t.rel
    );
  }
  assert!(
    blind > 0,
    "no two edits shared a second and a size ({} tried)",
    tracks.len()
  );
}
