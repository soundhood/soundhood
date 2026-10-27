//! Per-device SQLite index (rebuildable cache): schema + migrations, change detection, queries.
//! Zone: core-index. Contract: core/CONTRACT.md. The signatures below are binding; the bodies are
//! placeholders until the index lands.

use crate::error::Result;
use crate::model::{Library, RelPath, Track};
use std::path::{Path, PathBuf};

/// The open index for one library root on this device.
pub struct Index {
  _private: (),
}

/// What a refresh or rebuild did.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct RefreshReport {
  pub total: usize,
  pub read: usize,
  pub removed: usize,
  pub millis: u128,
}

impl Index {
  /// Opens or creates `<app data>/library-<roothash>.sqlite`, sets the pragmas, runs migrations and
  /// asserts FTS5 is compiled in.
  pub fn open(app_data_dir: &Path, root: &Path) -> Result<Index> {
    let _ = (app_data_dir, root);
    todo!("core-index")
  }

  pub fn db_path(app_data_dir: &Path, root: &Path) -> PathBuf {
    let _ = (app_data_dir, root);
    todo!("core-index")
  }

  /// Incremental refresh from disk; re-reads tags only where mtime+size changed. Never writes into
  /// the library.
  pub fn refresh(&self, lib: &Library) -> Result<RefreshReport> {
    let _ = lib;
    todo!("core-index")
  }

  /// "Rebuild index": drop every row, then refresh from scratch.
  pub fn rebuild(&self, lib: &Library) -> Result<RefreshReport> {
    let _ = lib;
    todo!("core-index")
  }

  /// The UI's track list, with the pre-rebuild artist fallback.
  pub fn tracks(&self, lib: &Library) -> Result<Vec<Track>> {
    let _ = lib;
    todo!("core-index")
  }

  pub fn track(&self, lib: &Library, rel: &RelPath) -> Result<Option<Track>> {
    let _ = (lib, rel);
    todo!("core-index")
  }

  pub fn fts5_available(&self) -> Result<bool> {
    todo!("core-index")
  }
}

/// Removes the legacy JSON tag cache `<cache dir>/library-<fnv64 hex of root>.json`, if present.
pub fn remove_legacy_json_cache(cache_dir: &Path, root: &Path) -> Result<bool> {
  let _ = (cache_dir, root);
  todo!("core-index")
}
