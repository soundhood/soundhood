//! Crash points inside the write path for the kill-mid-write tests (feature `fault-injection`).
//!
//! Points, in write order: `after_preimage` (journal pre-image written, file untouched),
//! `after_tmp_write` (tags written on the hidden temp), `after_verify` (temp verified, not yet
//! renamed), `after_stage_copy` (a landing file copied next to its destination), `after_replace`
//! (the file op happened, the journal commit line not yet written). Without the feature every
//! point is a no-op the compiler removes.

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
