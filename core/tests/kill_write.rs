//! Kill-mid-write: the test binary re-runs itself as a child that aborts (no unwinding, no
//! destructors) at one fault point inside the write path; the parent then checks that the library
//! is intact and that startup cleanup leaves no temp behind. A crash after the change happened
//! (`after_replace`) is finished on record at the next start, so "Undo last change" names it and
//! reverts it. Feature `fault-injection`.
#![cfg(feature = "fault-injection")]

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::fault::CRASH_ENV;
use soundhood_core::ingest::tagwrite::{apply, cleanup_orphans, land, ApplyOptions};
use soundhood_core::ingest::{undo, JournalEntry, Kind, Op};
use soundhood_core::model::{Library, RelPath, TagSet};
use soundhood_core::{playlist, tags};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use support::*;

const CHILD_ENV: &str = "SOUNDHOOD_CHILD";
const ROOT_ENV: &str = "SOUNDHOOD_KILL_ROOT";
const SCENARIO_ENV: &str = "SOUNDHOOD_KILL_SCENARIO";
const TARGET_ENV: &str = "SOUNDHOOD_KILL_TARGET";
const ARG_ENV: &str = "SOUNDHOOD_KILL_ARG";
/// What the child exits with when it ran its op without hitting the crash point.
const NOT_CRASHED: i32 = 3;
const NEW_TITLE: &str = "Written Before The Crash";

/// The child half. Ignored in a normal run; the parent runs it with `--ignored --exact` and
/// `SOUNDHOOD_CHILD=1`, and it does nothing without that variable.
#[test]
#[ignore = "helper: the kill tests run it as a child process"]
fn kill_child() {
  if std::env::var(CHILD_ENV).as_deref() != Ok("1") {
    return;
  }
  let env = |k: &str| std::env::var(k).unwrap();
  let lib = lib_at(Path::new(&env(ROOT_ENV)));
  let target = rel(&env(TARGET_ENV));
  let arg = std::env::var(ARG_ENV).unwrap_or_default();
  let opts = ApplyOptions::default();
  match env(SCENARIO_ENV).as_str() {
    "tags" => {
      let changes = TagSet {
        title: Some(NEW_TITLE.into()),
        ..TagSet::default()
      };
      apply(&lib, vec![Op::WriteTags { rel: target, changes }], &opts);
    }
    "move" => {
      apply(
        &lib,
        vec![Op::Move {
          rel: target,
          to_folder: arg,
        }],
        &opts,
      );
    }
    "delete" => {
      apply(&lib, vec![Op::Delete { rel: target }], &opts);
    }
    "playlist" => {
      apply(
        &lib,
        vec![Op::PlaylistAdd {
          name: arg,
          rels: vec![target],
        }],
        &opts,
      );
    }
    "land" => {
      land(&lib, Path::new(&arg), &target, &opts);
    }
    other => panic!("unknown scenario {other}"),
  }
  std::process::exit(NOT_CRASHED);
}

/// Runs the child for `scenario` with the crash armed at `point`; asserts that it died there.
fn crash(lib: &Library, scenario: &str, target: &RelPath, arg: &str, point: &str) {
  let status = Command::new(std::env::current_exe().unwrap())
    .args(["kill_child", "--exact", "--ignored", "--test-threads=1"])
    .env(CHILD_ENV, "1")
    .env(ROOT_ENV, &lib.root)
    .env(SCENARIO_ENV, scenario)
    .env(TARGET_ENV, target.as_str())
    .env(ARG_ENV, arg)
    .env(CRASH_ENV, point)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .unwrap();
  assert!(
    aborted(&status),
    "{scenario}: the child should have aborted at {point}, got {status:?}"
  );
}

/// `std::process::abort`: SIGABRT on unix, `__fastfail` (STATUS_STACK_BUFFER_OVERRUN) on Windows.
/// Anything else (a panic exits 101, a run past the point exits 3) is not the crash under test.
fn aborted(status: &std::process::ExitStatus) -> bool {
  #[cfg(unix)]
  {
    use std::os::unix::process::ExitStatusExt;
    status.signal() == Some(6)
  }
  #[cfg(windows)]
  {
    status.code() == Some(0xC000_0409_u32 as i32)
  }
  #[cfg(not(any(unix, windows)))]
  {
    !status.success() && status.code() != Some(NOT_CRASHED) && status.code() != Some(101)
  }
}

/// Every file under `_Playlists/` with its bytes.
fn playlists(lib: &Library) -> BTreeMap<String, Vec<u8>> {
  std::fs::read_dir(lib.root.join("_Playlists"))
    .unwrap()
    .map(|e| e.unwrap())
    .filter(|e| e.file_type().unwrap().is_file())
    .map(|e| {
      (
        e.file_name().to_string_lossy().to_string(),
        std::fs::read(e.path()).unwrap(),
      )
    })
    .collect()
}

/// Every line of every journal file of the library.
fn journal_lines(lib: &Library) -> usize {
  walk(&lib.root.join("_Soundhood/journal"))
    .iter()
    .map(|f| std::fs::read_to_string(f).unwrap().lines().count())
    .sum()
}

/// Startup after the crash: cleanup runs (recovery first) and no temp is left. A crash before the
/// change happened leaves its pre-image open, which means "never happened", and there is nothing to
/// undo. A crash after it (`after_replace`) is finished on record: committed, source "recovery",
/// and "Undo last change" names exactly that change. A second start writes nothing more. Returns
/// the interrupted entry as it is now.
fn after_restart(lib: &Library, interrupted: Kind, point: &str) -> JournalEntry {
  cleanup_orphans(lib).unwrap();
  assert!(temps(&lib.root).is_empty(), "cleanup left a temp behind");
  let e = entries(lib)
    .into_iter()
    .find(|e| e.kind == interrupted)
    .expect("the pre-image was journaled");
  if point == "after_replace" {
    assert!(e.committed, "{point}: recovery finished the change on record");
    assert_eq!(e.source, "recovery");
    assert_eq!(e.note.as_deref(), Some("finished after an interrupted run"));
    let last = undo::last_change(lib)
      .unwrap()
      .expect("the interrupted change can be undone");
    assert_eq!(
      (last.batch.as_str(), last.label.as_str()),
      (e.batch.as_str(), e.label.as_str())
    );
  } else {
    assert!(!e.committed, "{point}: the crash came before the change");
    assert_eq!(
      e.note.as_deref(),
      Some(INTERRUPTED),
      "{point}: the first start closes the entry, so no later start looks at it again"
    );
    assert!(undo::last_change(lib).unwrap().is_none(), "{point}: nothing to undo");
  }
  let lines = journal_lines(lib);
  cleanup_orphans(lib).unwrap();
  assert_eq!(journal_lines(lib), lines, "a second start writes nothing");
  e
}

/// The note on the line that closes an entry whose change the crash came before.
const INTERRUPTED: &str = "not applied: interrupted before the change";
/// The same when the disk does not show the state from before the change either.
const NOT_ON_DISK: &str = "not applied: interrupted, and the change is not on disk";

/// "Undo last change" after a recovered crash: one change undone, nothing skipped.
fn undo_recovered(lib: &Library, e: &JournalEntry) {
  let u = undo::undo_batch(lib, &e.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  assert!(u.skipped.is_empty() && u.failed.is_empty(), "{}", show(&u));
}

fn tag_write_at(point: &str, ext: &str) {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, ext);
  let original = read_bytes(&lib, &r);
  let lists = playlists(&lib);
  crash(&lib, "tags", &r, "", point);
  let temp_left = !temps(&lib.root).is_empty();
  match point {
    "after_preimage" => assert!(!temp_left, "no temp before the copy"),
    "after_tmp_write" | "after_verify" | "after_ready" => {
      assert!(temp_left, "the temp is there for cleanup to find")
    }
    _ => {}
  }
  if point == "after_replace" {
    // The rename happened: the new file is complete and reads back with the new title.
    let now = read_bytes(&lib, &r);
    assert_ne!(now, original);
    let t = tags::read(&lib.abs(&r)).unwrap();
    assert_eq!(t.title, NEW_TITLE);
    assert!(t.duration_ms > 2000, "{ext}: the whole stream is there");
  } else {
    assert_eq!(read_bytes(&lib, &r), original, "{ext}: the original is untouched");
  }
  assert_eq!(playlists(&lib), lists, "playlists intact");
  let e = after_restart(&lib, Kind::Tags, point);
  if point == "after_replace" {
    assert_eq!(
      e.file_hash_after.as_deref(),
      Some(soundhood_core::fs::file_hash(&lib.abs(&r)).unwrap().as_str())
    );
    undo_recovered(&lib, &e);
    let t = tags::read(&lib.abs(&r)).unwrap();
    assert_ne!(t.title, NEW_TITLE, "{ext}: the title is back");
    assert_eq!(t.title, original_title(&original, ext), "{ext}");
  } else {
    assert_eq!(read_bytes(&lib, &r), original);
  }
}

/// The title the original bytes carried, read from a scratch copy.
fn original_title(bytes: &[u8], ext: &str) -> String {
  let d = tempfile::tempdir().unwrap();
  let p = d.path().join(format!("original.{ext}"));
  std::fs::write(&p, bytes).unwrap();
  tags::read(&p).unwrap().title
}

#[test]
fn kill_tag_write_after_preimage() {
  tag_write_at("after_preimage", "m4a");
}

#[test]
fn kill_tag_write_after_tmp_write() {
  tag_write_at("after_tmp_write", "m4a");
  tag_write_at("after_tmp_write", "mp3");
}

#[test]
fn kill_tag_write_after_verify() {
  tag_write_at("after_verify", "flac");
  tag_write_at("after_verify", "opus");
}

/// The checked copy's hash is on record, the rename has not run: the file is untouched, so the
/// entry is closed as interrupted, not finished.
#[test]
fn kill_tag_write_after_ready() {
  tag_write_at("after_ready", "m4a");
  tag_write_at("after_ready", "mp3");
}

#[test]
fn kill_tag_write_after_replace() {
  tag_write_at("after_replace", "ogg");
  tag_write_at("after_replace", "m4a");
}

/// The temp a crash left (its bytes are exactly what the edit would have put in place).
fn the_temp(lib: &Library) -> PathBuf {
  let t = temps(&lib.root);
  assert_eq!(t.len(), 1, "{t:?}");
  lib.abs(&t[0])
}

/// A crash before the rename, then the same change made some other way before the next start: here
/// the very bytes the app's checked copy held, copied over the track by hand. The journal never
/// said the rename was about to run (no checked-copy hash on record), so the change is not taken
/// for the app's: the entry is closed as interrupted, Undo has nothing to offer, and the file keeps
/// what the hand put there.
#[test]
fn an_identical_change_made_by_hand_after_a_crash_before_the_rename_is_not_taken_for_the_apps() {
  for ext in ["m4a", "flac"] {
    let (_d, lib, report) = fixture_lib(10, false);
    let r = track_with_ext(&report, ext);
    crash(&lib, "tags", &r, "", "after_verify");
    let by_hand = std::fs::read(the_temp(&lib)).unwrap();
    std::fs::write(lib.abs(&r), &by_hand).unwrap();
    assert_eq!(tags::read(&lib.abs(&r)).unwrap().title, NEW_TITLE, "{ext}");
    let e = after_restart(&lib, Kind::Tags, "after_verify");
    assert_eq!(e.note.as_deref(), Some(INTERRUPTED), "{ext}");
    assert_eq!(read_bytes(&lib, &r), by_hand, "{ext}: the hand's change stays");
  }
}

/// A crash after the checked copy's hash went on record, then another version of the track arrives
/// before the next start: the file holds neither the old bytes nor the checked copy's, so the entry
/// is closed as not on disk and the new version is left alone.
#[test]
fn a_tag_edit_is_finished_only_when_the_file_holds_exactly_the_checked_copy() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "mp3");
  let other = report
    .tracks
    .iter()
    .map(|t| rel(&t.rel))
    .find(|o| *o != r && o.as_str().ends_with(".mp3"))
    .unwrap();
  crash(&lib, "tags", &r, "", "after_ready");
  let newer = read_bytes(&lib, &other);
  std::fs::write(lib.abs(&r), &newer).unwrap();
  cleanup_orphans(&lib).unwrap();
  let e = entries(&lib).into_iter().find(|e| e.kind == Kind::Tags).unwrap();
  assert!(!e.committed);
  assert_eq!(e.note.as_deref(), Some(NOT_ON_DISK));
  assert!(undo::last_change(&lib).unwrap().is_none());
  assert_eq!(read_bytes(&lib, &r), newer);
  let lines = journal_lines(&lib);
  cleanup_orphans(&lib).unwrap();
  assert_eq!(journal_lines(&lib), lines, "a second start writes nothing");
}

/// The first start after a crash before a move decides the entry once: closed as interrupted. A
/// move to that same place made by hand later is never taken for the app's at a later start.
#[test]
fn a_move_made_by_hand_after_the_first_start_is_never_taken_for_the_apps() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, folder) = favourite(&lib);
  let to = rel(&format!("{folder}/{}", r.file_name()));
  let lists = playlists(&lib);
  crash(&lib, "move", &r, &folder, "after_preimage");
  after_restart(&lib, Kind::Move, "after_preimage");
  let lines = journal_lines(&lib);
  std::fs::rename(lib.abs(&r), lib.abs(&to)).unwrap();
  cleanup_orphans(&lib).unwrap();
  assert_eq!(journal_lines(&lib), lines, "nothing is finished on record");
  assert!(undo::last_change(&lib).unwrap().is_none());
  assert_eq!(playlists(&lib), lists, "no playlist is rewritten for it");
}

/// A recovery that was itself interrupted after it created the temp for a playlist rewrite leaves
/// that temp behind under the same job name the next start uses: it goes first, so the playlist
/// is still rewritten and lists the track where it is.
#[test]
fn a_temp_left_by_an_interrupted_recovery_does_not_stop_the_next_one() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, folder) = favourite(&lib);
  let to = rel(&format!("{folder}/{}", r.file_name()));
  crash(&lib, "move", &r, &folder, "after_replace");
  let e = entries(&lib).into_iter().find(|e| e.kind == Kind::Move).unwrap();
  assert!(!e.playlists_touched.is_empty());
  for i in 0..e.playlists_touched.len() {
    let stale = lib
      .root
      .join("_Playlists")
      .join(format!(".soundhood-tmp-{}-c{i}.m3u8", e.id));
    std::fs::write(&stale, "#EXTM3U\nhalf written").unwrap();
  }
  let e = after_restart(&lib, Kind::Move, "after_replace");
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  assert!(
    fav.contains(&to.to_string()) && !fav.contains(&r.to_string()),
    "{fav:?}"
  );
  assert!(e.playlists_touched.iter().all(|pc| pc.after_hash.is_some()), "{e:?}");
}

/// Two names left on one file: on unix the no-replace rename links the new name and then unlinks
/// the old one, and a crash in between leaves both (here made exactly by the `after_link` point).
/// Recovery takes that as the move having happened: the old name goes (the bytes are the same
/// file), the playlists follow, and Undo puts everything back.
#[cfg(unix)]
#[test]
fn kill_move_after_link() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, folder) = favourite(&lib);
  let to = rel(&format!("{folder}/{}", r.file_name()));
  let audio = read_bytes(&lib, &r);
  let lists = playlists(&lib);
  crash(&lib, "move", &r, &folder, "after_link");
  assert_eq!(read_bytes(&lib, &r), audio, "both names are there");
  assert_eq!(read_bytes(&lib, &to), audio);
  let e = after_restart(&lib, Kind::Move, "after_replace");
  assert!(!lib.abs(&r).exists(), "the old name is gone");
  assert_eq!(read_bytes(&lib, &to), audio);
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  assert!(
    fav.contains(&to.to_string()) && !fav.contains(&r.to_string()),
    "{fav:?}"
  );
  undo_recovered(&lib, &e);
  assert_eq!(read_bytes(&lib, &r), audio);
  assert!(!lib.abs(&to).exists());
  assert_eq!(playlists(&lib), lists);
}

/// The same two-name state built by hand after a crash before the move: on unix a hard link (one
/// file, two names) is finished as the move; anywhere else two names are two files, so nothing is
/// removed and the entry is closed as interrupted.
#[test]
fn two_names_after_a_crash_count_as_the_move_only_when_they_are_one_file() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, folder) = favourite(&lib);
  let to = rel(&format!("{folder}/{}", r.file_name()));
  let audio = read_bytes(&lib, &r);
  crash(&lib, "move", &r, &folder, "after_preimage");
  #[cfg(unix)]
  std::fs::hard_link(lib.abs(&r), lib.abs(&to)).unwrap();
  #[cfg(not(unix))]
  std::fs::copy(lib.abs(&r), lib.abs(&to)).unwrap();
  cleanup_orphans(&lib).unwrap();
  let e = entries(&lib).into_iter().find(|e| e.kind == Kind::Move).unwrap();
  if cfg!(unix) {
    assert!(e.committed && e.source == "recovery", "{e:?}");
    assert!(!lib.abs(&r).exists());
  } else {
    assert!(!e.committed, "{e:?}");
    assert_eq!(e.note.as_deref(), Some(INTERRUPTED));
    assert_eq!(read_bytes(&lib, &r), audio, "nothing is removed");
  }
  assert_eq!(read_bytes(&lib, &to), audio);
}

/// A Favourites track in a folder, a folder to move it to, and a lyrics file beside it.
fn favourite(lib: &Library) -> (RelPath, String) {
  let fav = playlist::read(&lib.root, "Favourites").unwrap();
  let r = fav
    .entries
    .iter()
    .map(|e| rel(e))
    .find(|r| r.parent().is_some())
    .unwrap();
  let folder = ["Evenings", "Ambient"]
    .into_iter()
    .find(|f| r.top_folder() != Some(f))
    .unwrap();
  let stem = r.file_name().rsplit_once('.').unwrap().0.to_string();
  std::fs::write(
    lib.abs(&r.parent().unwrap()).join(format!("{stem}.lrc")),
    "[00:01.00]x\n",
  )
  .unwrap();
  (r, folder.to_string())
}

fn move_at(point: &str) {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, folder) = favourite(&lib);
  let to = rel(&format!("{folder}/{}", r.file_name()));
  let audio = read_bytes(&lib, &r);
  let lists = playlists(&lib);
  crash(&lib, "move", &r, &folder, point);
  // Exactly one copy of the track, intact, wherever the crash left it.
  let (at, gone) = if point == "after_preimage" {
    (&r, &to)
  } else {
    (&to, &r)
  };
  assert_eq!(read_bytes(&lib, at), audio);
  assert!(!lib.abs(gone).exists());
  // The crash came before the playlist rewrite: every playlist is intact (the moved track shows
  // as missing until it is moved back or re-added; nothing is lost).
  assert_eq!(playlists(&lib), lists);
  for pl in playlist::list(&lib.root).unwrap() {
    assert!(!pl.entries.is_empty() || pl.name == "Empty", "{} still parses", pl.name);
  }
  let e = after_restart(&lib, Kind::Move, point);
  if point == "after_replace" {
    // Recovery finished the move: the playlists list the track where it is now.
    let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
    assert!(
      fav.contains(&to.to_string()) && !fav.contains(&r.to_string()),
      "{fav:?}"
    );
    undo_recovered(&lib, &e);
    assert_eq!(read_bytes(&lib, &r), audio);
    assert!(!lib.abs(&to).exists());
    assert_eq!(playlists(&lib), lists, "undo puts every playlist line back exactly");
  }
}

#[test]
fn kill_move_after_preimage() {
  move_at("after_preimage");
}

#[test]
fn kill_move_after_replace() {
  move_at("after_replace");
}

fn delete_at(point: &str) {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite(&lib);
  let audio = read_bytes(&lib, &r);
  let lists = playlists(&lib);
  crash(&lib, "delete", &r, "", point);
  if point == "after_preimage" {
    assert_eq!(read_bytes(&lib, &r), audio);
  } else {
    assert!(!lib.abs(&r).exists());
    let binned = walk(&lib.root.join("_Soundhood/.bin"));
    assert_eq!(binned.len(), 1, "{binned:?}");
    assert_eq!(std::fs::read(&binned[0]).unwrap(), audio, "intact in the bin");
  }
  assert_eq!(playlists(&lib), lists);
  let e = after_restart(&lib, Kind::Delete, point);
  if point == "after_replace" {
    assert!(e.bin.is_some(), "recovery found the file in the bin");
    let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
    assert!(!fav.contains(&r.to_string()), "recovery took the line out: {fav:?}");
    undo_recovered(&lib, &e);
    assert_eq!(read_bytes(&lib, &r), audio);
    assert_eq!(playlists(&lib), lists, "undo puts every playlist line back exactly");
  }
}

fn walk(dir: &Path) -> Vec<PathBuf> {
  let mut out = Vec::new();
  if let Ok(rd) = std::fs::read_dir(dir) {
    for e in rd.map(|e| e.unwrap()) {
      if e.file_type().unwrap().is_dir() {
        out.extend(walk(&e.path()));
      } else {
        out.push(e.path());
      }
    }
  }
  out
}

#[test]
fn kill_delete_after_preimage() {
  delete_at("after_preimage");
}

#[test]
fn kill_delete_after_replace() {
  delete_at("after_replace");
}

fn playlist_add_at(point: &str) {
  let (_d, lib, report) = fixture_lib(20, false);
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  let newcomer = report
    .tracks
    .iter()
    .map(|t| rel(&t.rel))
    .find(|r| !fav.contains(&r.as_str().to_string()))
    .unwrap();
  let file = lib.root.join("_Playlists/Favourites.m3u8");
  let before = std::fs::read(&file).unwrap();
  crash(&lib, "playlist", &newcomer, "Favourites", point);
  let now = std::fs::read(&file).unwrap();
  if point == "after_preimage" {
    assert_eq!(now, before);
  } else {
    // Written whole: the old lines and the new one, in the house format.
    let mut want = fav.clone();
    want.push(newcomer.to_string());
    assert_eq!(String::from_utf8(now).unwrap(), playlist::render(&want));
  }
  let e = after_restart(&lib, Kind::Playlist, point);
  if point == "after_replace" {
    undo_recovered(&lib, &e);
    assert_eq!(
      std::fs::read(&file).unwrap(),
      before,
      "undo restores the playlist exactly"
    );
  }
}

#[test]
fn kill_playlist_add_after_preimage() {
  playlist_add_at("after_preimage");
}

#[test]
fn kill_playlist_add_after_replace() {
  playlist_add_at("after_replace");
}

fn land_at(point: &str) {
  let (_d, lib, report) = fixture_lib(10, false);
  let staging = tempfile::tempdir().unwrap();
  let staged = staging.path().join("incoming.mp3");
  std::fs::copy(lib.abs(&track_with_ext(&report, "mp3")), &staged).unwrap();
  let bytes = std::fs::read(&staged).unwrap();
  let dest = rel("Downloads/Landed - Someone.mp3");
  crash(&lib, "land", &dest, staged.to_str().unwrap(), point);
  match point {
    "after_preimage" => {
      assert!(!lib.abs(&dest).exists());
      assert!(temps(&lib.root).is_empty());
    }
    "after_stage_copy" => {
      assert!(!lib.abs(&dest).exists(), "not landed under its name");
      assert_eq!(temps(&lib.root).len(), 1, "the staged copy waits for cleanup");
    }
    _ => assert_eq!(read_bytes(&lib, &dest), bytes, "landed whole"),
  }
  if point != "after_replace" {
    assert_eq!(
      std::fs::read(&staged).unwrap(),
      bytes,
      "the download is still there to retry"
    );
  }
  let e = after_restart(&lib, Kind::Ingest, point);
  if point == "after_replace" {
    undo_recovered(&lib, &e);
    assert!(!lib.abs(&dest).exists(), "undo of the landing sent it to the bin");
  } else {
    assert!(!lib.abs(&dest).exists());
  }
}

#[test]
fn kill_land_after_preimage() {
  land_at("after_preimage");
}

#[test]
fn kill_land_after_stage_copy() {
  land_at("after_stage_copy");
}

#[test]
fn kill_land_after_replace() {
  land_at("after_replace");
}
