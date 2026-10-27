//! m3u8 playlists under `_Playlists/`: read, pure transforms, and the sole writer.
//! Zone: core-foundation. Contract: core/CONTRACT.md.
//!
//! Ported from the pre-rebuild host with the on-disk format unchanged: `#EXTM3U\n`, then one
//! root-relative, forward-slash entry per line, LF, trailing newline. Entries keep their exact
//! characters (an NFD file name stays NFD, or it no longer opens on NTFS); only comparisons fold
//! case and normalise to NFC.

use crate::error::{Error, Result};
use crate::fs::{FileStamp, APP_DIR, PLAYLISTS_DIR, TMP_PREFIX};
use crate::model::{PlaylistFile, RelPath};
use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// Every playlist in `_Playlists/` (not its sub-folders), `.m3u8` and `.m3u`, sorted by lower-cased
/// name. No `_Playlists/` folder means no playlists. A playlist that cannot be read is an error,
/// not an empty list: an empty read must never be written back over a real playlist.
pub fn list(root: &Path) -> Result<Vec<PlaylistFile>> {
  let dir = root.join(PLAYLISTS_DIR);
  let rd = match std::fs::read_dir(&dir) {
    Ok(rd) => rd,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(e) => return Err(e.into()),
  };
  let mut out = Vec::new();
  for entry in rd {
    let path = entry?.path();
    if !path.is_file() {
      continue;
    }
    let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
      continue;
    };
    if file_name.starts_with(TMP_PREFIX) {
      continue; // the writer's own temp, mid-write
    }
    let is_playlist = path
      .extension()
      .and_then(|x| x.to_str())
      .is_some_and(|x| x.eq_ignore_ascii_case("m3u8") || x.eq_ignore_ascii_case("m3u"));
    if !is_playlist {
      continue;
    }
    let name = path
      .file_stem()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_default();
    out.push(PlaylistFile {
      name,
      entries: read_file(&path)?,
    });
  }
  out.sort_by_key(|p| p.name.to_lowercase());
  Ok(out)
}

/// The playlist `name` (`_Playlists/<clean name>.m3u8`). `Error::NotFound` when it does not exist.
pub fn read(root: &Path, name: &str) -> Result<PlaylistFile> {
  let rel = file_rel(name)?;
  let path = rel.to_abs(root);
  if !path.is_file() {
    return Err(Error::NotFound(rel.to_string()));
  }
  Ok(PlaylistFile {
    name: sanitize_name(name)?,
    entries: read_file(&path)?,
  })
}

/// `_Playlists/<clean name>.m3u8`.
pub fn file_rel(name: &str) -> Result<RelPath> {
  RelPath::new(&format!("{PLAYLISTS_DIR}/{}.m3u8", sanitize_name(name)?))
}

/// A playlist name is a single file name: trimmed, outer dots removed, and refused when empty or
/// when it holds a character Windows rejects (the old host's `sanitize_folder_name`).
pub fn sanitize_name(raw: &str) -> Result<String> {
  let name = raw.trim().trim_matches('.').trim();
  if name.is_empty() {
    return Err(Error::InvalidPath("Playlist name is empty".into()));
  }
  if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    return Err(Error::InvalidPath(format!(
      "Playlist name contains a character Windows rejects: {name}"
    )));
  }
  Ok(name.to_string())
}

/// Lines of an m3u/m3u8 file: BOM stripped, trimmed, blank and `#` lines skipped, `\` -> `/`.
/// Anything else is kept exactly. Not UTF-8 is an error (decoding lossily would corrupt the names
/// on the next write).
fn read_file(path: &Path) -> Result<Vec<String>> {
  let bytes = std::fs::read(path)?;
  let text = String::from_utf8(bytes).map_err(|_| Error::other(format!("{} is not UTF-8 text", path.display())))?;
  Ok(parse(&text))
}

fn parse(text: &str) -> Vec<String> {
  text
    .lines()
    .map(|l| l.trim_start_matches('\u{feff}').trim())
    .filter(|l| !l.is_empty() && !l.starts_with('#'))
    .map(|l| l.replace('\\', "/"))
    .collect()
}

/// Membership key of a playlist line: NFC + lower-case, the same as [`RelPath::key`].
fn entry_key(entry: &str) -> String {
  entry.nfc().collect::<String>().to_lowercase()
}

/// `entries` plus each of `add` not already present (case-insensitive, NFC), in order.
pub fn with_added(entries: &[String], add: &[RelPath]) -> Vec<String> {
  let mut out = entries.to_vec();
  let mut keys: Vec<String> = out.iter().map(|e| entry_key(e)).collect();
  for rel in add {
    let key = rel.key();
    if !keys.contains(&key) {
      keys.push(key);
      out.push(rel.as_str().to_string());
    }
  }
  out
}

/// `entries` without any line matching one of `remove` (case-insensitive, NFC).
pub fn with_removed(entries: &[String], remove: &[RelPath]) -> Vec<String> {
  let keys: Vec<String> = remove.iter().map(RelPath::key).collect();
  entries
    .iter()
    .filter(|e| !keys.contains(&entry_key(e)))
    .cloned()
    .collect()
}

/// `entries` with every line matching `from` replaced by `to`, or dropped when `to` is `None`
/// (a delete). Positions are kept.
pub fn with_path_replaced(entries: &[String], from: &RelPath, to: Option<&RelPath>) -> Vec<String> {
  let key = from.key();
  entries
    .iter()
    .filter_map(|e| {
      if entry_key(e) == key {
        to.map(|t| t.as_str().to_string())
      } else {
        Some(e.clone())
      }
    })
    .collect()
}

/// The exact file contents: `#EXTM3U\n` + one entry per line, each ending in `\n`.
pub fn render(entries: &[String]) -> String {
  let mut out = String::from("#EXTM3U\n");
  for e in entries {
    out.push_str(e);
    out.push('\n');
  }
  out
}

/// Which playlists mention `rel` (case-insensitive): for move/rename/delete consistency.
pub fn containing(root: &Path, rel: &RelPath) -> Result<Vec<PlaylistFile>> {
  let key = rel.key();
  Ok(
    list(root)?
      .into_iter()
      .filter(|p| p.entries.iter().any(|e| entry_key(e) == key))
      .collect(),
  )
}

/// One playlist per first-level folder, filename order; never overwrites an existing playlist.
///
/// The old host's `playlists_from_folders`, as a plan: files directly in the root are skipped, each
/// first-level folder (sub-folders included) becomes a playlist named after it, entries sorted by
/// lower-cased file name, folders in name order. A folder whose name is not a valid playlist name,
/// or that already has a playlist of that name (`.m3u8` or `.m3u`, any case), is left out.
pub fn plan_from_folders(root: &Path, stamps: &[FileStamp]) -> Result<Vec<PlaylistFile>> {
  let existing: Vec<String> = list(root)?.iter().map(|p| p.name.to_lowercase()).collect();
  let mut by_folder: BTreeMap<&str, Vec<&FileStamp>> = BTreeMap::new();
  for s in stamps {
    let Some(folder) = s.rel.top_folder() else {
      continue; // "(root)" files
    };
    if folder == "(root)" || folder.eq_ignore_ascii_case(PLAYLISTS_DIR) || folder.eq_ignore_ascii_case(APP_DIR) {
      continue;
    }
    by_folder.entry(folder).or_default().push(s);
  }
  let mut out = Vec::new();
  for (folder, mut files) in by_folder {
    let Ok(name) = sanitize_name(folder) else {
      continue;
    };
    if existing.contains(&name.to_lowercase()) {
      continue;
    }
    files.sort_by_cached_key(|s| s.rel.file_name().to_lowercase());
    out.push(PlaylistFile {
      name,
      entries: files.iter().map(|s| s.rel.as_str().to_string()).collect(),
    });
  }
  Ok(out)
}

/// The sole m3u8 writer: write-then-rename through a hidden temp in `_Playlists/`. Writes `entries`
/// exactly as given. Refuses (`Error::InvalidPath`) a line the reader could not give back
/// unchanged: empty, padded with spaces, multi-line, or starting with `#` (read as a comment).
#[cfg_attr(not(test), allow(dead_code))] // ingest::tagwrite (zone core-writepath) is the caller
pub(crate) fn write(root: &Path, name: &str, entries: &[String], job: &str) -> Result<()> {
  for e in entries {
    if e.is_empty() || e.trim() != e || e.contains(['\n', '\r']) || e.starts_with('#') || e.starts_with('\u{feff}') {
      return Err(Error::InvalidPath(format!("cannot be a playlist line: {e:?}")));
    }
  }
  let dest = file_rel(name)?.to_abs(root);
  let dir = root.join(PLAYLISTS_DIR);
  std::fs::create_dir_all(&dir)?;
  let tmp = crate::fs::tmp_path(&dir, job, "m3u8");
  let mut file = crate::fs::create_hidden(&tmp)?;
  let written = file
    .write_all(render(entries).as_bytes())
    .and_then(|_| file.sync_all())
    .map_err(Error::from);
  drop(file);
  let result = written.and_then(|_| crate::fs::atomic_replace(&tmp, &dest));
  if result.is_err() && tmp.exists() {
    let _ = crate::fs::remove_file(&tmp);
  }
  result
}

#[cfg(test)]
mod tests;
