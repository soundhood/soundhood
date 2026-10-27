//! The one write path (`tagwrite`), the per-device journal and undo.
//! Zone: core-writepath. Contract: core/CONTRACT.md.

use serde::Serialize;

/// The receipt of one batch through the write path; hosts show it, the UI offers Undo from it.
#[derive(Serialize, Clone, Debug, Default)]
pub struct BatchReport {
  pub batch: String,
  pub applied: Vec<Applied>,
  pub skipped: Vec<Skipped>,
  pub failed: Vec<Failed>,
  pub aborted: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Applied {
  pub label: String,
  pub path_before: Option<String>,
  pub path_after: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Skipped {
  pub path: String,
  pub reason: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Failed {
  pub path: String,
  pub error: String,
}

/// The last undoable change on this device, in plain words.
#[derive(Serialize, Clone, Debug)]
pub struct ChangeSummary {
  pub batch: String,
  pub ts: i64,
  pub label: String,
  pub count: usize,
}
