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
    // Only an entry that vanished meanwhile is passed over: any other failure to look at a
    // playlist is an error, so no caller mistakes an unreadable playlist for an absent one.
    let meta = match std::fs::metadata(&path) {
      Ok(meta) => meta,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
      Err(e) => return Err(e.into()),
    };
    if !meta.is_file() {
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

/// The playlist `name` (`_Playlists/<clean name>.m3u8`). `Error::NotFound` only when it does not
/// exist: a playlist that exists but cannot be read (locked, not UTF-8, a folder of that name) is
/// another error, so the write path never takes it for absent and writes over it.
pub fn read(root: &Path, name: &str) -> Result<PlaylistFile> {
  let (_, path) = existing(root, name)?;
  Ok(PlaylistFile {
    name: sanitize_name(name)?,
    entries: read_file(&path)?,
  })
}

/// `name`'s rel path and absolute path, when it is a file; the errors of [`read`] otherwise.
fn existing(root: &Path, name: &str) -> Result<(RelPath, std::path::PathBuf)> {
  let rel = file_rel(name)?;
  let path = rel.to_abs(root);
  match std::fs::metadata(&path) {
    Ok(meta) if meta.is_file() => Ok((rel, path)),
    Ok(_) => Err(Error::Other(format!("{rel} is a folder, not a playlist"))),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::NotFound(rel.to_string())),
    Err(e) => Err(e.into()),
  }
}

/// A playlist as the write path needs it, from one read of its bytes: its lines, the blake3 hex of
/// the bytes, whether it reads as a text playlist at all (`readable`) and whether the app wrote it
/// in its own format (`ours`: rendering the lines gives the bytes back exactly). Errors as
/// [`read`], except that bytes which are no playlist (see `readable`) are not an error here.
pub(crate) struct Exact {
  pub file: PlaylistFile,
  pub hash: String,
  pub ours: bool,
  /// UTF-8 text that is not blank and holds no NUL byte. A 0-byte file (a placeholder a sync
  /// client left mid-download), a zeroed or binary file is not: it has no lines, is never `ours`,
  /// and the write path leaves it alone with [`unreadable`].
  pub readable: bool,
}

/// See [`Exact`].
pub(crate) fn read_exact(root: &Path, name: &str) -> Result<Exact> {
  let (_, path) = existing(root, name)?;
  let bytes = std::fs::read(&path)?;
  let hash = blake3::hash(&bytes).to_hex().to_string();
  let text = String::from_utf8(bytes)
    .ok()
    .filter(|t| !t.trim().is_empty() && !t.contains('\0'));
  let entries = text.as_deref().map(parse).unwrap_or_default();
  let ours = text.as_deref().is_some_and(|t| render(&entries) == t);
  Ok(Exact {
    file: PlaylistFile {
      name: sanitize_name(name)?,
      entries,
    },
    hash,
    ours,
    readable: text.is_some(),
  })
}

/// How every refusal of a playlist the app does not write ends.
const LEFT_AS_IS: &str = "; it was left as it is";

/// The refusal for a playlist the app did not write in its own format (another program's
/// `#EXTINF` lines, a BOM, CRLF, backslashes, comments): the app writes only its own format, so
/// any write would drop what the other program put there, and undo could not bring it back.
pub(crate) fn foreign(name: &str) -> Error {
  Error::Refused(format!(
    "the playlist {name} was written by another program{LEFT_AS_IS}"
  ))
}

/// The refusal for a `.m3u8` that does not read as a playlist at all (see [`Exact::readable`]).
pub(crate) fn unreadable(name: &str) -> Error {
  Error::Refused(format!("the playlist {name} could not be read{LEFT_AS_IS}"))
}

/// The refusal for a playlist `x` the app leaves alone: [`unreadable`] or [`foreign`].
pub(crate) fn not_ours(x: &Exact) -> Error {
  if x.readable {
    foreign(&x.file.name)
  } else {
    unreadable(&x.file.name)
  }
}

/// True for the errors of [`foreign`] and [`unreadable`]: the playlist was left as it is, so the op
/// that needed it was not done either.
pub(crate) fn is_left_as_is(e: &Error) -> bool {
  matches!(e, Error::Refused(m) if m.starts_with("the playlist ") && m.ends_with(LEFT_AS_IS))
}

const CHANGED: &str = " changed since it was read";

/// The refusal when a playlist is no longer what the write path read (another device's edit arrived
/// through sync in between): it is not written over.
pub(crate) fn changed(name: &str) -> Error {
  Error::Refused(format!("the playlist {name}{CHANGED}"))
}

/// True for the error of [`changed`].
pub(crate) fn is_changed(e: &Error) -> bool {
  matches!(e, Error::Refused(m) if m.starts_with("the playlist ") && m.ends_with(CHANGED))
}

/// What a playlist file must still be right before the sole writer renames its new version over it.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Expect<'a> {
  /// No file of that name (a playlist being created).
  Absent,
  /// The file still holds the bytes with this blake3 hex.
  Hash(&'a str),
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

/// Lines of an m3u/m3u8 file: BOM stripped, trimmed, blank and `#` lines skipped, `\` -> `/`, one
/// leading `./` removed (how [`render`] protects a path that starts with `#`). Anything else is kept
/// exactly. Not UTF-8 is an error (decoding lossily would corrupt the names on the next write).
fn read_file(path: &Path) -> Result<Vec<String>> {
  let bytes = std::fs::read(path)?;
  let text = String::from_utf8(bytes).map_err(|_| not_utf8(path))?;
  Ok(parse(&text))
}

/// A playlist that is not UTF-8, named by its file name only (never where the library lives).
fn not_utf8(path: &Path) -> Error {
  let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
  Error::other(format!("{name} is not UTF-8 text"))
}

fn parse(text: &str) -> Vec<String> {
  text
    .lines()
    .map(|l| l.trim_start_matches('\u{feff}').trim())
    .filter(|l| !l.is_empty() && !l.starts_with('#'))
    .map(|l| {
      let l = l.replace('\\', "/");
      match l.strip_prefix("./") {
        Some(rest) => rest.to_string(),
        None => l,
      }
    })
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

/// The exact file contents: `#EXTM3U\n` + one entry per line, each ending in `\n`. An entry that
/// starts with `#` (a root-level `#1 Song.mp3`) is written as `./#1 Song.mp3`, or every reader
/// would skip it as a comment; [`read`] strips the `./` again. Other entries go out as they are.
pub fn render(entries: &[String]) -> String {
  let mut out = String::from("#EXTM3U\n");
  for e in entries {
    if e.starts_with('#') {
      out.push_str("./");
    }
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
/// laid out by [`render`] (a `#` entry gets its `./`). Refuses (`Error::InvalidPath`) a line the
/// reader could not give back unchanged: empty, padded with spaces, multi-line, or starting with
/// `./` (the reader strips it).
#[cfg_attr(not(test), allow(dead_code))] // the write path calls write_expecting
pub(crate) fn write(root: &Path, name: &str, entries: &[String], job: &str) -> Result<()> {
  write_expecting(root, name, entries, job, None)
}

/// The hidden temp the sole writer uses for job `job`: `_Playlists/.soundhood-tmp-<job>.m3u8`.
pub(crate) fn temp_path(root: &Path, job: &str) -> std::path::PathBuf {
  crate::fs::tmp_path(&root.join(PLAYLISTS_DIR), job, "m3u8")
}

/// [`write`], checking right before the rename (after the temp is written and fsynced) that the
/// playlist is still what `expect` says; otherwise the temp goes and the playlist is left as it is
/// ([`changed`]). The read that `expect` comes from and this write are apart in time, and an edit
/// from the other device can land in between: renaming over it would lose its lines on both
/// devices once sync uploads the result.
///
/// A playlist being created (`Expect::Absent`) is renamed into place by the no-replace rename, so
/// one that lands after that check, in the instant before the rename, is kept too ([`changed`]),
/// as is one whose name differs only in case on a case-sensitive disk. Replacing an existing
/// playlist keeps the replacing rename: there the instant between the check and the rename is left.
pub(crate) fn write_expecting(
  root: &Path,
  name: &str,
  entries: &[String],
  job: &str,
  expect: Option<Expect<'_>>,
) -> Result<()> {
  for e in entries {
    if e.is_empty() || e.trim() != e || e.contains(['\n', '\r']) || e.starts_with("./") || e.starts_with('\u{feff}') {
      return Err(Error::InvalidPath(format!("cannot be a playlist line: {e:?}")));
    }
  }
  let clean = sanitize_name(name)?;
  let dest = file_rel(&clean)?.to_abs(root);
  std::fs::create_dir_all(root.join(PLAYLISTS_DIR))?;
  let tmp = temp_path(root, job);
  let mut file = crate::fs::create_hidden(&tmp)?;
  let written = file
    .write_all(render(entries).as_bytes())
    .and_then(|_| file.sync_all())
    .map_err(Error::from);
  drop(file);
  let still = || match expect {
    None => true,
    Some(Expect::Absent) => dest.symlink_metadata().is_err(),
    Some(Expect::Hash(h)) => crate::fs::file_hash(&dest).ok().as_deref() == Some(h),
  };
  let result = written.and_then(|_| {
    crate::ingest::fault::hook("before_replace", &dest);
    if !still() {
      return Err(changed(&clean));
    }
    crate::ingest::fault::hook("before_rename", &dest);
    match expect {
      Some(Expect::Absent) => crate::fs::place_new(&tmp, &dest).map_err(|e| match e {
        Error::Exists(_) => changed(&clean),
        e => e,
      }),
      _ => crate::fs::atomic_replace(&tmp, &dest),
    }
  });
  if result.is_err() && tmp.exists() {
    let _ = crate::fs::remove_file(&tmp);
  }
  result
}

#[cfg(test)]
mod tests;
