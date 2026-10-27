//! Kill-mid-write: the test binary re-runs itself as a child that aborts (no unwinding, no
//! destructors) at one fault point inside the write path; the parent then checks that the library
//! is intact and that startup cleanup leaves no temp behind. Feature `fault-injection`.
#![cfg(feature = "fault-injection")]

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::fault::CRASH_ENV;
use soundhood_core::ingest::tagwrite::{apply, cleanup_orphans, land, ApplyOptions};
use soundhood_core::ingest::{Kind, Op};
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

/// Startup after the crash: cleanup runs, no temp is left, and the interrupted entry is on record
/// as never committed.
fn after_restart(lib: &Library, interrupted: Kind) {
  cleanup_orphans(lib).unwrap();
  assert!(temps(&lib.root).is_empty(), "cleanup left a temp behind");
  let journal = entries(lib);
  let e = journal
    .iter()
    .find(|e| e.kind == interrupted)
    .expect("the pre-image was journaled");
  assert!(!e.committed, "the crash came before the commit line");
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
    "after_tmp_write" | "after_verify" => assert!(temp_left, "the temp is there for cleanup to find"),
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
  after_restart(&lib, Kind::Tags);
  if point != "after_replace" {
    assert_eq!(read_bytes(&lib, &r), original);
  }
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

#[test]
fn kill_tag_write_after_replace() {
  tag_write_at("after_replace", "ogg");
  tag_write_at("after_replace", "m4a");
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
  after_restart(&lib, Kind::Move);
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
  after_restart(&lib, Kind::Delete);
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
  after_restart(&lib, Kind::Playlist);
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
  after_restart(&lib, Kind::Ingest);
  if point != "after_replace" {
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
