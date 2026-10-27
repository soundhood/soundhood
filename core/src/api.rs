//! The surface the hosts call. Lead-owned: signatures change only through an interface change
//! request. Every mutating method routes through `ingest::tagwrite` and returns its `BatchReport`.

use crate::error::Result;
use crate::index::{Index, RefreshReport};
use crate::ingest::{BatchReport, ChangeSummary};
use crate::model::{Library, PlaylistFile, RelPath, Track};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One open library on one device. Hosts keep one `Core` per library root.
#[allow(dead_code)] // fields are used once the Phase 0 bodies land
pub struct Core {
  pub lib: Library,
  index: Index,
  /// Serialises every write: the core is the single writer of user files on this device.
  write_lock: Mutex<()>,
  app_data_dir: PathBuf,
}

/// What a host learns at startup.
#[derive(serde::Serialize, Clone, Debug)]
pub struct OpenReport {
  pub device: String,
  pub orphans_removed: Vec<String>,
  pub legacy_cache_removed: bool,
}

impl Core {
  /// Opens the library at `root`: device id from `app_data_dir`, index in `app_data_dir`, orphaned
  /// temp files from interrupted writes cleaned up (journaled). `legacy_cache_dir` is where the
  /// pre-rebuild JSON tag cache lived; it is deleted after the first successful index refresh.
  pub fn open(root: &Path, app_data_dir: &Path, legacy_cache_dir: Option<&Path>) -> Result<(Core, OpenReport)> {
    let _ = (root, app_data_dir, legacy_cache_dir);
    todo!("core-writepath: implement")
  }

  /// Where this device's index lives (for diagnostics and "Copy log").
  pub fn index_path(&self) -> PathBuf {
    todo!("core-writepath: implement")
  }

  /// Refresh the index from disk (incremental) and return the UI's track list.
  pub fn scan(&self) -> Result<Vec<Track>> {
    todo!("core-index: implement")
  }

  /// "Rebuild index": drop and rebuild from the files alone.
  pub fn rebuild_index(&self) -> Result<RefreshReport> {
    todo!("core-index: implement")
  }

  pub fn playlists(&self) -> Result<Vec<PlaylistFile>> {
    todo!("core-writepath: implement")
  }

  /// Tier 1. Writes title + artist (empty = clear) and returns the re-read track.
  pub fn write_tags(&self, abs: &Path, title: &str, artist: &str) -> Result<(Track, BatchReport)> {
    let _ = (abs, title, artist);
    todo!("core-writepath: implement")
  }

  /// Tier 1. Moves a file into `<root>/<target_folder>/`, same name; playlists follow in the same batch.
  pub fn move_track(&self, abs: &Path, target_folder: &str) -> Result<(Track, BatchReport)> {
    let _ = (abs, target_folder);
    todo!("core-writepath: implement")
  }

  /// Tier 1. To the bin (desktop recycle bin, Android `_Soundhood/.bin`); playlists follow.
  pub fn delete_track(&self, abs: &Path) -> Result<BatchReport> {
    let _ = abs;
    todo!("core-writepath: implement")
  }

  /// Tier 2. Adds absolute paths (converted to RelPath) to a playlist, creating it if needed.
  pub fn playlist_add(&self, name: &str, abs_paths: &[PathBuf]) -> Result<(PlaylistFile, BatchReport)> {
    let _ = (name, abs_paths);
    todo!("core-writepath: implement")
  }

  pub fn playlist_remove(&self, name: &str, abs_paths: &[PathBuf]) -> Result<(PlaylistFile, BatchReport)> {
    let _ = (name, abs_paths);
    todo!("core-writepath: implement")
  }

  pub fn playlist_create(&self, name: &str) -> Result<(PlaylistFile, BatchReport)> {
    let _ = name;
    todo!("core-writepath: implement")
  }

  pub fn playlist_delete(&self, name: &str) -> Result<BatchReport> {
    let _ = name;
    todo!("core-writepath: implement")
  }

  /// The one-time "Make playlists from folders" import; never overwrites an existing playlist.
  pub fn playlists_from_folders(&self) -> Result<(Vec<PlaylistFile>, BatchReport)> {
    todo!("core-writepath: implement")
  }

  /// The last change on this device that can still be undone, in plain words.
  pub fn last_change(&self) -> Result<Option<ChangeSummary>> {
    todo!("core-writepath: implement")
  }

  pub fn undo_last(&self) -> Result<BatchReport> {
    todo!("core-writepath: implement")
  }

  pub fn undo_batch(&self, batch: &str) -> Result<BatchReport> {
    let _ = batch;
    todo!("core-writepath: implement")
  }

  /// Runs the bundled fixture checks through this build ("Run self-test"). `scratch_dir` must be
  /// app-writable: the phone cannot write to the system temp dir, so the host passes its cache dir.
  pub fn self_test(scratch_dir: &Path) -> SelfTestReport {
    let lines = crate::fixtures::self_test_lines_in(scratch_dir);
    let failed = lines.iter().filter(|(ok, _)| !ok).count();
    SelfTestReport {
      passed: lines.len() - failed,
      failed,
      lines: lines
        .into_iter()
        .map(|(ok, l)| format!("{} {l}", if ok { "PASS" } else { "FAIL" }))
        .collect(),
    }
  }

  pub fn rel(&self, abs: &Path) -> Result<RelPath> {
    self.lib.rel(abs)
  }
}

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct SelfTestReport {
  pub passed: usize,
  pub failed: usize,
  pub lines: Vec<String>,
}
