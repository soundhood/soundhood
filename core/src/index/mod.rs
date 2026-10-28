//! Per-device SQLite index (rebuildable cache): schema + migrations, change detection, queries.
//! Zone: core-index. Contract: core/CONTRACT.md.
//!
//! The index never writes into the library and is never the source of truth: deleting the
//! `.sqlite` file and running "Rebuild index" gives back the same library from the files alone.
//! "Rebuild index" (tags, file stamps, playlist reconciliation, art hash) lives here; "Analyse
//! library" (audio hash, fingerprint, loudness) is a separate job and never runs inside a refresh.

pub mod artists;
mod db;
mod legacy;
mod refresh;
mod view;

use crate::error::Result;
use crate::model::{Library, RelPath, Track};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// The open index for one library root on this device.
pub struct Index {
  conn: Mutex<Connection>,
  /// Serialises refresh and rebuild. Tags are read without holding `conn`, so the track list
  /// stays readable while a refresh is busy reading files.
  pass: Mutex<()>,
  /// Where the pre-rebuild JSON tag cache lived (`with_legacy_cache_dir`).
  legacy_cache_dir: Option<PathBuf>,
  /// Legacy cache entries loaded by `seed_from_legacy_json`, consumed by the next refresh.
  seed: Mutex<HashMap<String, legacy::Entry>>,
  /// What the last scan could not read (`"<rel>: <reason>"`).
  skipped: Mutex<Vec<String>>,
}

/// What a refresh or rebuild did.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct RefreshReport {
  /// Tracks in the index after the pass.
  pub total: usize,
  /// Files whose tags were read (new or changed since the last pass).
  pub read: usize,
  /// Rows dropped because their file is gone.
  pub removed: usize,
  pub millis: u128,
}

impl Index {
  /// Opens or creates `<app data>/library-<roothash>.sqlite`, sets the pragmas, runs migrations and
  /// asserts FTS5 is compiled in.
  pub fn open(app_data_dir: &Path, root: &Path) -> Result<Index> {
    std::fs::create_dir_all(app_data_dir)?;
    let conn = db::open(&Self::db_path(app_data_dir, root), root)?;
    Ok(Index {
      conn: Mutex::new(conn),
      pass: Mutex::new(()),
      legacy_cache_dir: None,
      seed: Mutex::new(HashMap::new()),
      skipped: Mutex::new(Vec::new()),
    })
  }

  /// `<app data>/library-<16 hex digits>.sqlite`: FNV-1a 64 over the root path string, the same
  /// hash the pre-rebuild JSON cache used for its file name.
  pub fn db_path(app_data_dir: &Path, root: &Path) -> PathBuf {
    app_data_dir.join(format!("library-{:016x}.sqlite", root_hash(root)))
  }

  /// Names the folder that holds the pre-rebuild JSON tag cache. The first refresh of an empty
  /// index then takes title, artist and duration from it for every file whose mtime and size still
  /// match, instead of reading those files (which would download every online-only cloud file).
  pub fn with_legacy_cache_dir(mut self, cache_dir: Option<&Path>) -> Index {
    self.legacy_cache_dir = cache_dir.map(Path::to_path_buf);
    self
  }

  /// Incremental refresh from disk; re-reads tags only where mtime+size changed. Never writes into
  /// the library.
  pub fn refresh(&self, lib: &Library) -> Result<RefreshReport> {
    self.pass(lib, refresh::Mode::Incremental)
  }

  /// "Rebuild index": drop every row, then refresh from scratch, reading every file (the legacy
  /// cache is never used here). Runs as one transaction: a rebuild that fails leaves the old index.
  pub fn rebuild(&self, lib: &Library) -> Result<RefreshReport> {
    self.pass(lib, refresh::Mode::Rebuild)
  }

  /// The UI's track list, with the pre-rebuild artist fallback. Same order as the old scan:
  /// first-level folder (`"(root)"` for files in the root), then file name, byte-wise.
  pub fn tracks(&self, lib: &Library) -> Result<Vec<Track>> {
    view::tracks(&self.conn(), lib)
  }

  /// One track as `tracks` would list it; `None` when the index has no row for `rel`.
  pub fn track(&self, lib: &Library, rel: &RelPath) -> Result<Option<Track>> {
    view::track(&self.conn(), lib, rel)
  }

  /// True when this SQLite build has FTS5 (`open` already refuses one that does not).
  pub fn fts5_available(&self) -> Result<bool> {
    db::fts5_available(&self.conn())
  }

  /// Loads the pre-rebuild JSON tag cache for `lib.root` from `cache_dir` into memory, converting
  /// its absolute-path keys to `RelPath`s. The next refresh uses an entry instead of reading the
  /// file when the file's mtime and size still match it. Returns how many entries were loaded
  /// (0 when there is no cache file). Never changes the cache file.
  pub fn seed_from_legacy_json(&self, lib: &Library, cache_dir: &Path) -> Result<usize> {
    let entries = legacy::load(&legacy::cache_path(cache_dir, &lib.root), lib)?;
    let n = entries.len();
    *lock(&self.seed) = entries;
    Ok(n)
  }

  /// What the last refresh's scan had to leave out (protected folders, unreadable files), as
  /// `"<rel>: <reason>"` lines.
  pub fn skipped_last_refresh(&self) -> Vec<String> {
    lock(&self.skipped).clone()
  }

  fn conn(&self) -> MutexGuard<'_, Connection> {
    lock(&self.conn)
  }
}

/// Removes the legacy JSON tag cache `<cache dir>/library-<fnv64 hex of root>.json` (and the
/// `.json.tmp` its writer may have left), if present. True when something was removed.
pub fn remove_legacy_json_cache(cache_dir: &Path, root: &Path) -> Result<bool> {
  let path = legacy::cache_path(cache_dir, root);
  let mut removed = false;
  for p in [path.with_extension("json.tmp"), path] {
    match std::fs::remove_file(&p) {
      Ok(()) => removed = true,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
      Err(e) => return Err(e.into()),
    }
  }
  Ok(removed)
}

/// FNV-1a 64 over the UTF-8 bytes of the root path string, exactly as the pre-rebuild host keyed
/// its cache file (so `D:\Music` and `D:\Music\` are different roots, as they were).
fn root_hash(root: &Path) -> u64 {
  let mut h: u64 = 0xcbf2_9ce4_8422_2325;
  for b in root.to_string_lossy().as_bytes() {
    h ^= u64::from(*b);
    h = h.wrapping_mul(0x0100_0000_01b3);
  }
  h
}

/// A poisoned lock only means another pass panicked; its transaction rolled back on drop, so the
/// data behind the lock is still consistent.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
  m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_secs() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| clamp_i64(d.as_secs()))
    .unwrap_or(0)
}

/// SQLite integers are i64; sizes and durations never get near the limit, so clamp, never fail.
fn clamp_i64(v: u64) -> i64 {
  i64::try_from(v).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn root_hash_is_fnv1a_64() {
    // Standard FNV-1a 64 vectors, so the legacy cache file is found under the same name.
    assert_eq!(root_hash(Path::new("")), 0xcbf29ce484222325);
    assert_eq!(root_hash(Path::new("a")), 0xaf63dc4c8601ec8c);
    assert_eq!(root_hash(Path::new("foobar")), 0x85944171f73967e8);
    assert_ne!(root_hash(Path::new("D:\\Music")), root_hash(Path::new("D:\\Music\\")));
  }

  #[test]
  fn index_can_live_in_shared_host_state() {
    fn shared<T: Send + Sync>() {}
    shared::<Index>();
  }

  #[test]
  fn db_path_is_per_root_in_app_data() {
    let p = Index::db_path(Path::new("app"), Path::new("foobar"));
    assert_eq!(p, Path::new("app").join("library-85944171f73967e8.sqlite"));
  }
}
