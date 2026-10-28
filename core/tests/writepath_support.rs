//! Shared helpers for the write-path tests (`#[path]`-included by each `writepath_*` / `kill_*`
//! file; on its own this target has no tests). Every library is a generated fixture library in a
//! temp dir; `Platform::Android` makes deletes use the app bin, never the machine's recycle bin.
#![allow(dead_code)]

use soundhood_core::fixtures::{self, FixtureReport, FixtureSpec};
use soundhood_core::ingest::{journal, BatchReport, JournalEntry};
use soundhood_core::model::{DeviceId, Library, Platform, RelPath};
use std::path::Path;
use std::time::{Duration, SystemTime};

pub const DEVICE: &str = "test-device";

pub fn rel(s: &str) -> RelPath {
  RelPath::new(s).unwrap()
}

pub fn lib_at(root: &Path) -> Library {
  Library {
    root: root.to_path_buf(),
    device: DeviceId(DEVICE.into()),
    platform: Platform::Android,
  }
}

/// A fixture library in a fresh temp dir: `tracks` tracks, 5 folders, 5 playlists, messy names off
/// unless asked for.
pub fn fixture_lib(tracks: usize, messy: bool) -> (tempfile::TempDir, Library, FixtureReport) {
  let dir = tempfile::tempdir().unwrap();
  let spec = FixtureSpec {
    tracks,
    folders: 5,
    playlists: 5,
    messy,
  };
  let report = fixtures::generate(dir.path(), &spec).unwrap();
  age_all(dir.path());
  let lib = lib_at(dir.path());
  (dir, lib, report)
}

/// Makes `path` look like a file the user has had for a while: its modification time an hour
/// back. The write path leaves alone a file that changed in the last 10 s (it may be mid-sync), and
/// a freshly generated fixture would be one.
pub fn age(path: &Path) {
  let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
  f.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
}

/// [`age`] for every file under `root`.
pub fn age_all(root: &Path) {
  for e in std::fs::read_dir(root).unwrap() {
    let p = e.unwrap().path();
    if p.is_dir() {
      age_all(&p);
    } else {
      age(&p);
    }
  }
}

/// The first fixture track with this extension that sits in a folder.
pub fn track_with_ext(report: &FixtureReport, ext: &str) -> RelPath {
  let t = report
    .tracks
    .iter()
    .find(|t| t.rel.ends_with(&format!(".{ext}")) && t.rel.contains('/') && t.note.is_empty())
    .unwrap_or_else(|| panic!("no plain .{ext} fixture in a folder"));
  rel(&t.rel)
}

pub fn temps(root: &Path) -> Vec<RelPath> {
  soundhood_core::fs::list_tmp_files(root).unwrap()
}

pub fn entries(lib: &Library) -> Vec<JournalEntry> {
  journal::read_device(&lib.root, &lib.device).unwrap()
}

/// One-line summary of a report for assertion messages.
pub fn show(r: &BatchReport) -> String {
  format!(
    "applied {:?} skipped {:?} failed {:?} aborted {}",
    r.applied.iter().map(|a| &a.label).collect::<Vec<_>>(),
    r.skipped.iter().map(|s| (&s.path, &s.reason)).collect::<Vec<_>>(),
    r.failed.iter().map(|f| (&f.path, &f.error)).collect::<Vec<_>>(),
    r.aborted
  )
}

pub fn read_bytes(lib: &Library, r: &RelPath) -> Vec<u8> {
  std::fs::read(lib.abs(r)).unwrap()
}
