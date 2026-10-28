//! Crash points inside the write path for the kill-mid-write tests (feature `fault-injection`).
//!
//! Points, in write order: `after_preimage` (journal pre-image written, file untouched),
//! `after_tmp_write` (tags written on the hidden temp), `after_verify` (temp verified, not yet
//! renamed), `after_stage_copy` (a landing file copied next to its destination), `after_replace`
//! (the file op happened, the journal commit line not yet written). Without the feature every
//! point is a no-op the compiler removes.
//!
//! Hooks are the gentler kind of point: a test registers a closure for one file at one point
//! ([`once_at`]) and the write path runs it when it passes there, which lets a test change a file
//! at the exact moment a sync client could. Hook points: `before_replace`, right before the write
//! path checks, one last time, that a file (audio or playlist) is still what it read; and
//! `before_rename` (playlists), after that check, right before the rename itself: the instant only
//! a no-replace rename covers.

/// The environment variable a kill test sets to the name of the point to crash at.
pub const CRASH_ENV: &str = "SOUNDHOOD_CRASH_AT";

/// Aborts the process (no unwinding, no destructors: like a power cut for everything not yet
/// fsynced) when `SOUNDHOOD_CRASH_AT` equals `name`.
#[inline]
pub fn point(name: &str) {
  #[cfg(feature = "fault-injection")]
  if std::env::var(CRASH_ENV).is_ok_and(|v| v == name) {
    std::process::abort();
  }
  #[cfg(not(feature = "fault-injection"))]
  let _ = name;
}

#[cfg(feature = "fault-injection")]
type Hook = (String, std::path::PathBuf, Box<dyn FnOnce() + Send>);

#[cfg(feature = "fault-injection")]
static HOOKS: std::sync::Mutex<Vec<Hook>> = std::sync::Mutex::new(Vec::new());

/// Test-only: runs `f` once, the next time the write path passes the hook point `name` for the
/// file `path` (tests run in parallel; each names its own file, so hooks never cross).
#[cfg(feature = "fault-injection")]
pub fn once_at(name: &str, path: &std::path::Path, f: impl FnOnce() + Send + 'static) {
  let mut hooks = HOOKS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  hooks.push((name.to_string(), path.to_path_buf(), Box::new(f)));
}

/// A hook point (see [`once_at`]) for the file `path`; a no-op without the feature.
#[inline]
pub(crate) fn hook(name: &str, path: &std::path::Path) {
  #[cfg(feature = "fault-injection")]
  {
    let found = {
      let mut hooks = HOOKS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
      hooks
        .iter()
        .position(|(n, p, _)| n == name && p == path)
        .map(|i| hooks.remove(i).2)
    };
    if let Some(f) = found {
      f();
    }
  }
  #[cfg(not(feature = "fault-injection"))]
  let _ = (name, path);
}
