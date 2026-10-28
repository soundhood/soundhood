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
mod recover;
pub mod tagwrite;
pub mod undo;

use crate::error::{Error, Result};
use crate::fs::BinRecord;
use crate::model::{DeviceId, RelPath, TagSet};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub use tagwrite::ApplyOptions;

/// One line of the journal. A pre-image line (`committed: false`) is written before a user file is
/// touched; a commit line with the same `id` (`committed: true`, after hashes) once it is in place.
/// A change the write path gives up on before touching anything gets a closing line instead, still
/// `committed: false`, whose `note` starts with `"not applied: "`. One left open by a crash after
/// the change happened is finished at the next start by a commit line with source `"recovery"`
/// (an undo keeps `"undo:<batch>"`) and note `"finished after an interrupted run"`.
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
  /// On a commit line, the bytes left in place. A landing's pre-image carries it already (the
  /// download's hash), so a crash right after the rename can be recognised and finished.
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
  /// skipped because symphonia cannot decode the original either (Opus, HE-AAC), why a change was
  /// given up (`"not applied: …"`, with the technical detail the report leaves out), or that
  /// startup recovery finished it. Never an absolute path.
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
  WriteTags {
    rel: RelPath,
    changes: TagSet,
  },
  /// Into the first-level folder `to_folder`, keeping the file name; never over an existing file.
  Move {
    rel: RelPath,
    to_folder: String,
  },
  Rename {
    rel: RelPath,
    to: RelPath,
  },
  /// To the bin; playlists are updated in the same batch.
  Delete {
    rel: RelPath,
  },
  PlaylistAdd {
    name: String,
    rels: Vec<RelPath>,
  },
  PlaylistRemove {
    name: String,
    rels: Vec<RelPath>,
  },
  PlaylistCreate {
    name: String,
  },
  /// The `.m3u8` goes to the bin.
  PlaylistDelete {
    name: String,
  },
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

/// The words of a report row for `e` on the file (or playlist) `path`: the error's own message,
/// an I/O error in plain words, and no absolute path (see [`scrub`]).
pub(crate) fn report_text(e: &Error, root: &Path, path: &str) -> String {
  let text = match e {
    Error::Io(io) => plain_io(io),
    other => message(other),
  };
  scrub(&text, root, path)
}

/// `e` with its message scrubbed (see [`scrub`]), same variant, so a host that shows a single op's
/// error shows the same words as the report row. An I/O error becomes `Error::Other` with its plain
/// words.
pub(crate) fn scrubbed(e: Error, root: &Path, path: &str) -> Error {
  let fix = |m: String| scrub(&m, root, path);
  match e {
    Error::Tag(m) => Error::Tag(fix(m)),
    Error::InvalidPath(m) => Error::InvalidPath(fix(m)),
    Error::Exists(m) => Error::Exists(fix(m)),
    Error::NotFound(m) => Error::NotFound(fix(m)),
    Error::InUse(m) => Error::InUse(fix(m)),
    Error::Verify(m) => Error::Verify(fix(m)),
    Error::Refused(m) => Error::Refused(fix(m)),
    Error::Other(m) => Error::Other(fix(m)),
    Error::Io(io) => Error::Other(fix(plain_io(&io))),
    other => other,
  }
}

/// `text` without the library's absolute path, for report rows and journal notes: they must never
/// show where the library lives (on Windows the account name is part of that path). `path` is the
/// file (library-relative, `/`-separated) or the playlist name the text is about.
///
/// Every end is found from names the write path knows, never from punctuation, so a quote or a
/// bracket in the root or in a folder name cannot cut a path short:
/// - the absolute path of `path` itself (or of the playlist `_Playlists/<path>.m3u8`) becomes its
///   file name;
/// - a temp copy the core made (`.soundhood-tmp-<entry id>[-<p|r|c><n>][.<ext>]`, in `path`'s
///   folder, `_Playlists/` or the root) becomes the name of the file it was a copy of, with or
///   without the root before it;
/// - any other path inside the root loses the root and keeps the rest (`Evenings/Song.mp3`);
/// - the root on its own becomes its last name.
///
/// The words around a path are kept.
pub(crate) fn scrub(text: &str, root: &Path, path: &str) -> String {
  let root = root.to_string_lossy();
  let root = root.trim_end_matches(['/', '\\']);
  let own_name = path.rsplit('/').next().unwrap_or(path);
  let mut out = text.to_string();
  if !root.is_empty() {
    let root_name = root.rsplit(['/', '\\']).next().unwrap_or_default();
    let playlist = format!("{}/{path}.m3u8", crate::fs::PLAYLISTS_DIR);
    let known = [(path, own_name.to_string()), (playlist.as_str(), format!("{own_name}.m3u8"))];
    let parent = path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    let temp_dirs = [parent, crate::fs::PLAYLISTS_DIR, ""];
    for prefix in [format!(r"\\?\{root}"), root.to_string(), root.replace('\\', "/")] {
      let mut from = 0;
      while let Some(at) = out[from..].find(&prefix).map(|i| i + from) {
        let after = at + prefix.len();
        let (len, shown) = inside_root(&out[after..], &known, &temp_dirs, path, own_name)
          .unwrap_or_else(|| (0, root_name.to_string()));
        out.replace_range(at..after + len, &shown);
        from = at + shown.len();
      }
    }
  }
  // A temp's own name, wherever it is left (a message that names it without the root).
  let mut from = 0;
  while let Some(at) = out[from..].find(crate::fs::TMP_PREFIX).map(|i| i + from) {
    match temp_name_len(&out[at..], path) {
      Some(len) => {
        out.replace_range(at..at + len, own_name);
        from = at + own_name.len();
      }
      None => from = at + crate::fs::TMP_PREFIX.len(),
    }
  }
  out
}

/// What follows the root in a text: `(bytes it covers, what to show)` for a path inside the root,
/// `None` when the root is not followed by a separator (the root itself).
fn inside_root(
  rest: &str,
  known: &[(&str, String)],
  temp_dirs: &[&str],
  path: &str,
  own_name: &str,
) -> Option<(usize, String)> {
  let rel = rest.strip_prefix(['/', '\\'])?;
  for (name, shown) in known {
    if !name.is_empty() && starts_with_path(rel, name) {
      return Some((1 + name.len(), shown.clone()));
    }
  }
  for dir in temp_dirs {
    let at = if dir.is_empty() {
      0
    } else if starts_with_path(rel, dir) && rel[dir.len()..].starts_with(['/', '\\']) {
      dir.len() + 1
    } else {
      continue;
    };
    if let Some(len) = temp_name_len(&rel[at..], path) {
      return Some((1 + at + len, own_name.to_string()));
    }
  }
  // Another path inside the library: shown relative, as it is.
  Some((1, String::new()))
}

/// `text` starts with the library-relative `rel`, its `/` written as `/` or `\`.
fn starts_with_path(text: &str, rel: &str) -> bool {
  text.len() >= rel.len()
    && text
      .bytes()
      .zip(rel.bytes())
      .all(|(t, r)| t == r || (r == b'/' && t == b'\\'))
}

/// Length of the temp name `text` starts with, of the exact shape the core gives its temps
/// (`fs::tmp_path`): the prefix, a 32-digit entry id, an optional `-p<n>` / `-r<n>` / `-c<n>`, and
/// an optional extension, which is `path`'s own or `m3u8`. `None` for anything else.
fn temp_name_len(text: &str, path: &str) -> Option<usize> {
  let rest = text.strip_prefix(crate::fs::TMP_PREFIX)?;
  let id = rest.get(..32)?;
  if !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
    return None;
  }
  let mut len = crate::fs::TMP_PREFIX.len() + 32;
  let tail = &text[len..];
  if let Some(n) = tail.strip_prefix(['-']).and_then(|t| t.strip_prefix(['p', 'r', 'c'])) {
    let digits = n.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 {
      len += 2 + digits;
    }
  }
  // A longer id or another suffix is a name of another shape (`fs::temp_entry_id` refuses it too).
  if text[len..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
    return None;
  }
  let own_ext = path.rsplit_once('.').map(|(_, e)| e).filter(|e| !e.contains('/'));
  if let Some(ext) = text[len..].strip_prefix('.') {
    let word = ext.bytes().take_while(u8::is_ascii_alphanumeric).count();
    let ext = &ext[..word];
    if word > 0 && (ext.eq_ignore_ascii_case("m3u8") || own_ext.is_some_and(|o| o.eq_ignore_ascii_case(ext))) {
      len += 1 + word;
    }
  }
  Some(len)
}

/// An I/O error in plain words, without the OS error number.
fn plain_io(e: &std::io::Error) -> String {
  use std::io::ErrorKind as K;
  match e.kind() {
    K::NotFound => "it is not there any more".into(),
    K::PermissionDenied => "the system did not allow the change".into(),
    K::AlreadyExists => "a file of that name is already there".into(),
    K::StorageFull => "the disk is full".into(),
    K::ReadOnlyFilesystem => "the drive is read-only".into(),
    _ => {
      let text = e.to_string();
      match text.rfind(" (os error ") {
        Some(i) => text[..i].to_string(),
        None => text,
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// No absolute path survives: the library path is cut down to the last name, a temp copy's
  /// name becomes the file it copies, and the words around stay.
  #[test]
  fn scrub_keeps_the_words_and_drops_the_library_path() {
    let root = if cfg!(windows) {
      Path::new(r"C:\Users\user\Music")
    } else {
      Path::new("/home/user/Music")
    };
    let sep = std::path::MAIN_SEPARATOR;
    let tmp = format!(
      "{}{sep}Ambient{sep}.soundhood-tmp-0123456789abcdef0123456789abcdef.mp3",
      root.display()
    );
    let path = "Ambient/Song - Artist.mp3";
    assert_eq!(
      scrub(&format!("not changed: {tmp}: frame TCON changed"), root, path),
      "not changed: Song - Artist.mp3: frame TCON changed"
    );
    let file = format!("{}{sep}Ambient{sep}Song (Live).mp3", root.display());
    assert_eq!(
      scrub(&format!("could not move {file} to the bin"), root, "Ambient/Song (Live).mp3"),
      "could not move Song (Live).mp3 to the bin"
    );
    // A path the text is not about keeps its library-relative part; the root goes.
    assert_eq!(
      scrub(&format!("could not move {file} to the bin"), root, path),
      format!("could not move Ambient{sep}Song (Live).mp3 to the bin")
    );
    let verbatim = format!(r"\\?\{}{sep}a.mp3", root.display());
    assert_eq!(scrub(&format!("x '{verbatim}' y"), root, path), "x 'a.mp3' y");
    let slashes = format!("{}/Chill/b.mp3", root.display().to_string().replace('\\', "/"));
    assert_eq!(scrub(&slashes, root, path), "Chill/b.mp3");
    assert_eq!(scrub(&slashes, root, "Chill/b.mp3"), "b.mp3");
    assert_eq!(scrub("file in use", root, path), "file in use");
    assert_eq!(scrub(&format!("{} is not a folder", root.display()), root, path), "Music is not a folder");
  }

  /// Quotes, apostrophes and brackets in the root or in a folder name never cut a path short: the
  /// end of a path comes from the names the write path knows, so nothing of the root, and no temp
  /// name, is left behind in the text.
  #[test]
  fn scrub_finds_the_path_end_from_known_names_not_punctuation() {
    let root = if cfg!(windows) {
      Path::new(r"C:\Users\O'Brien (home)\Music")
    } else {
      Path::new("/home/o'brien (home)/Music")
    };
    let sep = std::path::MAIN_SEPARATOR;
    let id = "0123456789abcdef0123456789abcdef";
    let path = "Chill (2019)/Don't Stop (Live).m4a";
    let r = root.display();
    let cases = [
      (
        format!("not changed: {r}{sep}Chill (2019){sep}.soundhood-tmp-{id}.m4a: mp4 error"),
        "not changed: Don't Stop (Live).m4a: mp4 error".to_string(),
      ),
      (
        format!("x '{r}{sep}Chill (2019){sep}Don't Stop (Live).m4a' y"),
        "x 'Don't Stop (Live).m4a' y".to_string(),
      ),
      (
        format!("panicked at \"{r}{sep}Chill (2019){sep}.soundhood-tmp-{id}.m4a\")"),
        "panicked at \"Don't Stop (Live).m4a\")".to_string(),
      ),
      (
        format!("{r}{sep}_Playlists{sep}.soundhood-tmp-{id}-p0.m3u8 exists"),
        "Don't Stop (Live).m4a exists".to_string(),
      ),
      (
        format!("in '{r}{sep}Other (B){sep}x.mp3'"),
        format!("in 'Other (B){sep}x.mp3'"),
      ),
      (
        format!("bare .soundhood-tmp-{id}-c3.m4a name"),
        "bare Don't Stop (Live).m4a name".to_string(),
      ),
    ];
    for (text, want) in cases {
      let got = scrub(&text, root, path);
      assert_eq!(got, want, "{text}");
      assert!(!got.contains("Brien") && !got.contains("soundhood-tmp"), "{got}");
    }
    // A playlist: its own file and its temps become its name.
    assert_eq!(
      scrub(&format!("{r}{sep}_Playlists{sep}Mix (2).m3u8: in use"), root, "Mix (2)"),
      "Mix (2).m3u8: in use"
    );
    // A user's file that only starts like a temp is not one: it is left as it is.
    assert_eq!(
      scrub("saw .soundhood-tmp-My Song.m4a", root, path),
      "saw .soundhood-tmp-My Song.m4a"
    );
  }

  #[test]
  fn io_errors_read_in_plain_words() {
    let e = Error::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    assert_eq!(
      report_text(&e, Path::new("/x"), "a.mp3"),
      "the system did not allow the change"
    );
    let raw = Error::Io(std::io::Error::from_raw_os_error(if cfg!(windows) { 1117 } else { 5 }));
    assert!(!report_text(&raw, Path::new("/x"), "a.mp3").contains("os error"));
    assert!(matches!(scrubbed(raw, Path::new("/x"), "a.mp3"), Error::Other(_)));
  }

  #[test]
  fn folder_names_the_library_would_trip_over_are_refused() {
    for bad in [
      "",
      " ",
      ".",
      "..",
      ".hidden",
      "a/b",
      "a\\b",
      "x:y",
      "what?",
      "tab\there",
      "CON",
      "con",
      "Nul.txt",
      "com1",
      "LPT9",
      "lpt1.mp3",
      "Rock.",
      "Rock. ",
      "_Playlists",
      "_soundhood",
      "_PLAYLISTS",
    ] {
      assert!(validate_folder_name(bad).is_err(), "{bad:?} must be refused");
    }
    for good in [
      "Chill",
      " Chill ",
      "Rock & Roll",
      "COM10",
      "Console",
      "CONcerts",
      "a.b",
      "Café",
    ] {
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
