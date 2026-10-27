//! The one write path (`tagwrite`), the per-device journal and undo.
//! Zone: core-writepath. Contract: core/CONTRACT.md.
//!
//! Every change to a user file (audio files and `_Playlists/**/*.m3u8`) is an [`Op`] applied by
//! [`tagwrite::apply`]: journal pre-image first, then the change, then a commit line. Undo replays a
//! batch in reverse through the same mechanics.

mod companions;
mod decode;
pub mod fault;
pub mod journal;
pub mod tagwrite;
pub mod undo;

use crate::error::{Error, Result};
use crate::fs::BinRecord;
use crate::model::{DeviceId, RelPath, TagSet};
use serde::{Deserialize, Serialize};

pub use tagwrite::ApplyOptions;

/// One line of the journal. A pre-image line (`committed: false`) is written before a user file is
/// touched; a commit line with the same `id` (`committed: true`, after hashes) once it is in place.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct JournalEntry {
  pub id: String,
  /// Unix time, milliseconds.
  pub ts: i64,
  pub device: DeviceId,
  pub kind: Kind,
  pub path_before: Option<RelPath>,
  pub path_after: Option<RelPath>,
  pub tags_before: Option<TagSet>,
  pub tags_after: Option<TagSet>,
  pub file_hash_before: Option<String>,
  pub file_hash_after: Option<String>,
  #[serde(default)]
  pub playlists_touched: Vec<PlaylistChange>,
  #[serde(default)]
  pub bin: Option<BinRecord>,
  /// `"user"`, `"undo:<batch>"`, `"cleanup"`, ...
  pub source: String,
  pub batch: String,
  /// Plain words for the UI, e.g. "Edited tags of Song - Artist.m4a".
  pub label: String,
  pub committed: bool,
  /// What the write path wants on record beyond the fields above, e.g. that the decode check was
  /// skipped because symphonia cannot decode the original either (Opus, HE-AAC).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub note: Option<String>,
}

/// What an entry changed.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
  Tags,
  Rename,
  Move,
  Delete,
  Playlist,
  PlaylistCreate,
  PlaylistDelete,
  /// A file arriving in the library (a download landing, or a delete being undone).
  Ingest,
  /// An orphaned temp file removed at startup.
  Cleanup,
}

/// One playlist rewritten by an entry. `before`/`after` are entry lists; `None` = file absent.
/// Hashes are blake3 hex of the file bytes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PlaylistChange {
  pub name: String,
  pub before: Option<Vec<String>>,
  pub after: Option<Vec<String>>,
  pub before_hash: Option<String>,
  pub after_hash: Option<String>,
}

/// One requested change. A batch is a `Vec<Op>` applied in order by [`tagwrite::apply`].
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
  WriteTags { rel: RelPath, changes: TagSet },
  /// Into the first-level folder `to_folder`, keeping the file name; never over an existing file.
  Move { rel: RelPath, to_folder: String },
  Rename { rel: RelPath, to: RelPath },
  /// To the bin; playlists are updated in the same batch.
  Delete { rel: RelPath },
  PlaylistAdd { name: String, rels: Vec<RelPath> },
  PlaylistRemove { name: String, rels: Vec<RelPath> },
  PlaylistCreate { name: String },
  /// The `.m3u8` goes to the bin.
  PlaylistDelete { name: String },
  PlaylistsFromFolders,
}

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

/// Names the user types for a folder (a move target, a download folder) all go through here. A
/// name the file system or the library would trip over is refused rather than repaired: empty,
/// `.`/`..`, a leading dot (the scan skips dot-folders), path separators or other characters Windows
/// rejects, control characters, a reserved DOS name (`CON`, `NUL`, `COM1`, ... with or without an
/// extension), a trailing dot or space, and the app's own `_Playlists` / `_Soundhood` (a track moved
/// there would vanish from the index). Surrounding spaces are trimmed first. Returns the name to use.
pub fn validate_folder_name(raw: &str) -> Result<String> {
  let name = raw.trim();
  validate_segment(name, "Folder name")?;
  if name.eq_ignore_ascii_case(crate::fs::PLAYLISTS_DIR) || name.eq_ignore_ascii_case(crate::fs::APP_DIR) {
    return Err(Error::InvalidPath(format!("{name} is the app's own folder")));
  }
  Ok(name.to_string())
}

/// The per-segment rules of [`validate_folder_name`], also applied to every segment of a rename
/// target. `what` starts the error message ("Folder name", "File name").
pub(crate) fn validate_segment(name: &str, what: &str) -> Result<()> {
  let bad = |why: &str| Err(Error::InvalidPath(format!("{what} {why}: {name:?}")));
  if name.is_empty() {
    return Err(Error::InvalidPath(format!("{what} is empty")));
  }
  if name == "." || name == ".." || name.starts_with('.') {
    return bad("cannot start with a dot");
  }
  if name.ends_with('.') || name.ends_with(' ') {
    return bad("cannot end with a dot or a space");
  }
  if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    return bad("contains a character Windows rejects");
  }
  if name.chars().any(|c| c.is_control()) {
    return bad("contains a control character");
  }
  // Windows reserves these names with any extension, and ignores spaces before the dot.
  let stem = name.split('.').next().unwrap_or(name).trim_end().to_ascii_uppercase();
  let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (stem.len() == 4
      && (stem.starts_with("COM") || stem.starts_with("LPT"))
      && matches!(stem.as_bytes()[3], b'1'..=b'9'));
  if reserved {
    return bad("is a name Windows reserves");
  }
  Ok(())
}

/// The UI's name for where a file sits: its folder, or "the library folder" at the root.
pub(crate) fn folder_label(rel: &RelPath) -> String {
  rel
    .parent()
    .map(|p| p.to_string())
    .unwrap_or_else(|| "the library folder".to_string())
}

/// "1 track" / "3 tracks".
pub(crate) fn tracks(n: usize) -> String {
  if n == 1 {
    "1 track".to_string()
  } else {
    format!("{n} tracks")
  }
}

/// A plain message for a report row: the error's own words, without the variant prefix that
/// `Display` adds ("already exists: ...").
pub(crate) fn message(e: &Error) -> String {
  match e {
    Error::InvalidPath(m)
    | Error::Exists(m)
    | Error::NotFound(m)
    | Error::InUse(m)
    | Error::Verify(m)
    | Error::Refused(m)
    | Error::Other(m)
    | Error::Tag(m) => m.clone(),
    other => other.to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn folder_names_the_library_would_trip_over_are_refused() {
    for bad in [
      "", " ", ".", "..", ".hidden", "a/b", "a\\b", "x:y", "what?", "tab\there", "CON", "con", "Nul.txt",
      "com1", "LPT9", "lpt1.mp3", "Rock.", "Rock. ", "_Playlists", "_soundhood", "_PLAYLISTS",
    ] {
      assert!(validate_folder_name(bad).is_err(), "{bad:?} must be refused");
    }
    for good in ["Chill", " Chill ", "Rock & Roll", "COM10", "Console", "CONcerts", "a.b", "Café"] {
      assert!(validate_folder_name(good).is_ok(), "{good:?} must be accepted");
    }
    assert_eq!(validate_folder_name("  Chill ").unwrap(), "Chill");
  }

  #[test]
  fn journal_lines_keep_the_documented_shape() {
    let e = JournalEntry {
      id: "e1".into(),
      ts: 1,
      device: DeviceId("d".into()),
      kind: Kind::PlaylistCreate,
      path_before: None,
      path_after: Some(RelPath::new("_Playlists/A.m3u8").unwrap()),
      tags_before: None,
      tags_after: None,
      file_hash_before: None,
      file_hash_after: None,
      playlists_touched: vec![],
      bin: None,
      source: "user".into(),
      batch: "b1".into(),
      label: "Created playlist A".into(),
      committed: false,
      note: None,
    };
    let json = serde_json::to_string(&e).unwrap();
    assert!(json.contains("\"kind\":\"playlist_create\""), "{json}");
    assert!(json.contains("\"path_before\":null"), "{json}");
    assert!(!json.contains("note"), "{json}");
    let back: JournalEntry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, e);
  }
}
