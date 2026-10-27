//! The pre-rebuild JSON tag cache (`<app cache>/library-<fnv64 hex>.json`), read once to seed the
//! index so the first refresh does not have to read every file again.
//!
//! Format, as the old host wrote it: one JSON object keyed by the track's absolute path (on
//! Windows with backslashes, under the root string exactly as the UI passed it), each value
//! `{mtime: unix seconds, size, title, artist, duration_secs}`.

use crate::error::Result;
use crate::model::Library;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One cached file, keyed in the seed map by its `RelPath` string.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub(super) struct Entry {
  pub mtime: u64,
  pub size: u64,
  #[serde(default)]
  pub title: String,
  #[serde(default)]
  pub artist: String,
  #[serde(default)]
  pub duration_secs: u64,
}

impl Entry {
  /// The cache entry still describes the file on disk.
  pub fn matches(&self, mtime: i64, size: u64) -> bool {
    i64::try_from(self.mtime).is_ok_and(|m| m == mtime) && self.size == size
  }
}

pub(super) fn cache_path(cache_dir: &Path, root: &Path) -> PathBuf {
  cache_dir.join(format!("library-{:016x}.json", super::root_hash(root)))
}

/// Reads the cache at `path` into `rel_path -> entry`. A missing file is an empty map; a file that
/// is not a JSON object is an error. Keys outside the root and malformed entries are skipped,
/// one at a time, like the old reader skipped a whole bad file: it is only a cache.
pub(super) fn load(path: &Path, lib: &Library) -> Result<HashMap<String, Entry>> {
  let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
    Err(e) => return Err(e.into()),
  };
  let raw: HashMap<String, serde_json::Value> = serde_json::from_str(&text)?;
  let mut out = HashMap::with_capacity(raw.len());
  for (abs, value) in raw {
    let Ok(rel) = lib.rel(Path::new(&abs)) else {
      continue;
    };
    if let Ok(entry) = serde_json::from_value::<Entry>(value) {
      out.insert(rel.as_str().to_string(), entry);
    }
  }
  Ok(out)
}
