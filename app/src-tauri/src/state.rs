//! One `Core` per library root, opened lazily and shared by every command, plus the helpers that
//! turn a core result into what the UI expects (plain-string errors, the `core:batch` event).

use crate::paths::{clean_root, root_key, tilde};
use soundhood_core::api::{Core, OpenReport};
use soundhood_core::ingest::BatchReport;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted after every mutating command with the batch's `BatchReport`.
pub const BATCH_EVENT: &str = "core:batch";

/// Tauri-managed: the open cores by root key, and what each one reported when it opened.
#[derive(Default)]
pub struct Cores {
  cores: Mutex<HashMap<String, Arc<Core>>>,
  opened: Mutex<HashMap<String, OpenReport>>,
}

/// A poisoned lock only means an earlier command panicked; the map itself is still consistent
/// (entries are inserted only after a successful open), so keep serving it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
  m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Cores {
  /// The core for `dir`, opening it on first use. Refuses a root that is not a folder, so a
  /// mistyped path never gets an index or a journal.
  pub fn get(&self, app: &AppHandle, dir: &str) -> Result<Arc<Core>, String> {
    let root = clean_root(dir);
    if root.as_os_str().is_empty() {
      return Err("No Music folder selected — click Import first.".into());
    }
    if !root.is_dir() {
      return Err(format!("Music folder not found: {}", root.display()));
    }
    let key = root_key(&root);
    // Held across the open: two commands racing on a fresh root must not open two cores, and
    // with them two single writers.
    let mut cores = lock(&self.cores);
    if let Some(core) = cores.get(&key) {
      return Ok(core.clone());
    }
    let data_dir = app_data_dir(app)?;
    // The pre-rebuild JSON tag cache lived in the cache dir; the core deletes it after the first
    // successful index refresh.
    let cache_dir = app.path().app_cache_dir().ok();
    let (core, report) = Core::open(&root, &data_dir, cache_dir.as_deref()).map_err(|e| e.to_string())?;
    log_open(app, &core, &report);
    let core = Arc::new(core);
    cores.insert(key.clone(), core.clone());
    lock(&self.opened).insert(key, report);
    Ok(core)
  }

  /// What the core for `dir` reported when it opened in this session, if it did.
  pub fn open_report(&self, dir: &str) -> Option<OpenReport> {
    lock(&self.opened).get(&root_key(&clean_root(dir))).cloned()
  }
}

fn log_open(app: &AppHandle, core: &Core, report: &OpenReport) {
  let home = home_dir(app);
  log(&format!(
    "library opened: index {}; {} orphaned temp file(s) removed{}; legacy tag cache removed: {}",
    tilde(&core.index_path(), home.as_deref()),
    report.orphans_removed.len(),
    if report.orphans_removed.is_empty() {
      String::new()
    } else {
      format!(" ({})", report.orphans_removed.join(", "))
    },
    report.legacy_cache_removed
  ));
}

/// The user's home folder, for `paths::tilde`.
pub fn home_dir(app: &AppHandle) -> Option<PathBuf> {
  app.path().home_dir().ok()
}

/// One host log line: stdout, which `tauri dev` prints and Android forwards to logcat. Callers
/// pass paths through `paths::tilde` first.
pub fn log(line: &str) {
  println!("[soundhood] {line}");
}

/// Runs `f` with the core for `dir` on a blocking worker: core calls walk the disk, read tags and
/// fsync, which must not stall the window (or the Android main thread).
pub async fn with_core<T, F>(app: &AppHandle, dir: String, f: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(&AppHandle, &Core) -> Result<T, String> + Send + 'static,
{
  let app = app.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let core = app.state::<Cores>().get(&app, &dir)?;
    f(&app, &core)
  })
  .await
  .map_err(|e| format!("internal error: {e}"))?
}

/// Tells the UI what a mutating command did; sent whether the op applied, was skipped or failed.
pub fn emit_batch(app: &AppHandle, report: &BatchReport) {
  let _ = app.emit(BATCH_EVENT, report);
}

/// A single-op command fails when its one operation did not apply: the reason ("file in use",
/// "read-only file", "already exists in <folder>") is what the UI shows.
pub fn single_op(report: &BatchReport) -> Result<(), String> {
  if let Some(s) = report.skipped.first() {
    return Err(s.reason.clone());
  }
  if let Some(f) = report.failed.first() {
    return Err(f.error.clone());
  }
  if report.aborted {
    return Err("The change was stopped before it was made".into());
  }
  Ok(())
}

/// An absolute track path from the UI that is a file inside this library; the error strings are
/// the ones the UI has always shown.
pub fn track_in_library(core: &Core, path: &str) -> Result<PathBuf, String> {
  let abs = PathBuf::from(path);
  if !abs.is_file() {
    return Err(format!("File not found: {}", abs.display()));
  }
  core
    .rel(&abs)
    .map_err(|_| "Track is outside the Music folder".to_string())?;
  Ok(abs)
}

/// The app data folder (device id, index, verified sidecars, the fixture library).
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map_err(|e| format!("No app data folder: {e}"))
}

/// The app cache folder (scratch space for the self-test; the system temp dir is not writable on
/// the phone).
pub fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_cache_dir()
    .map_err(|e| format!("No app cache folder: {e}"))
}

/// True when `dir` names an existing folder (after the same clean-up `Cores::get` applies).
pub fn is_library_dir(dir: &str) -> bool {
  let root = clean_root(dir);
  !root.as_os_str().is_empty() && root.is_dir()
}

#[cfg(test)]
mod tests {
  use super::*;
  use soundhood_core::ingest::{Applied, Failed, Skipped};

  fn report() -> BatchReport {
    BatchReport {
      batch: "b1".into(),
      ..Default::default()
    }
  }

  #[test]
  fn single_op_passes_an_applied_op() {
    let mut r = report();
    r.applied.push(Applied {
      label: "Tags of a.m4a".into(),
      path_before: Some("a.m4a".into()),
      path_after: Some("a.m4a".into()),
    });
    assert_eq!(single_op(&r), Ok(()));
  }

  #[test]
  fn single_op_returns_the_skip_or_failure_reason() {
    let mut r = report();
    r.skipped.push(Skipped {
      path: "a.m4a".into(),
      reason: "file in use".into(),
    });
    assert_eq!(single_op(&r), Err("file in use".into()));

    let mut r = report();
    r.failed.push(Failed {
      path: "a.m4a".into(),
      error: "verification failed: duration".into(),
    });
    assert_eq!(single_op(&r), Err("verification failed: duration".into()));

    let mut r = report();
    r.aborted = true;
    assert!(single_op(&r).is_err());
  }
}
