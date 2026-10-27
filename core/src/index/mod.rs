//! Per-device SQLite index (rebuildable cache): schema + migrations, change detection, queries.
//! Zone: core-index. Contract: core/CONTRACT.md.

/// Placeholder until the index lands; the contract in CONTRACT.md is binding.
pub struct Index;

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct RefreshReport {
  pub total: usize,
  pub read: usize,
  pub removed: usize,
  pub millis: u128,
}
