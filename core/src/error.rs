//! One error type for the whole core. Hosts turn it into a plain string for the UI.

use std::fmt;

#[derive(Debug, thiserror::Error)]
pub enum Error {
  #[error("{0}")]
  Io(#[from] std::io::Error),
  #[error("tag error: {0}")]
  Tag(String),
  #[error("index error: {0}")]
  Index(#[from] rusqlite::Error),
  #[error("json error: {0}")]
  Json(#[from] serde_json::Error),
  /// A path that is not a clean root-relative path, or lies outside the library root.
  #[error("invalid path: {0}")]
  InvalidPath(String),
  /// The destination already exists; the write path never overwrites to make room.
  #[error("already exists: {0}")]
  Exists(String),
  #[error("not found: {0}")]
  NotFound(String),
  /// Another process (the Proton client, a player) holds the file; retried, then skipped.
  #[error("file in use: {0}")]
  InUse(String),
  /// A write was re-read and did not match what was intended; the original is untouched.
  #[error("verification failed: {0}")]
  Verify(String),
  /// The operation was refused by a safety rule (e.g. undo of an entry whose file has changed since).
  #[error("refused: {0}")]
  Refused(String),
  #[error("{0}")]
  Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
  pub fn other(msg: impl fmt::Display) -> Self {
    Error::Other(msg.to_string())
  }
}
