//! Library root handling: scanning, stamps, hashes, temp files, atomic replace, bins.
//! Write helpers are `pub(crate)`: only `ingest::tagwrite` calls them.

mod bin;
#[cfg(windows)]
mod win;
mod write;

#[allow(unused_imports)] // the bin helpers are reached from ingest::tagwrite (zone core-writepath)
pub(crate) use bin::{restore_from_bin, to_bin};
pub use bin::{BinKind, BinRecord};
#[allow(unused_imports)] // the write helpers are reached from ingest::tagwrite (zone core-writepath)
pub(crate) use write::{
  atomic_replace, copy_to_tmp, create_hidden, fsync, remove_file, rename_no_clobber, stage_move, tmp_path,
};

use crate::error::{Error, Result};
use crate::model::{DeviceId, RelPath};
use std::io::Write as _;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// App bookkeeping inside the root (synced, one file per device). Never scanned as music.
pub const APP_DIR: &str = "_Soundhood";
/// Playlist files inside the root; the app is their sole writer.
pub const PLAYLISTS_DIR: &str = "_Playlists";
/// Prefix of the hidden temp files the write path creates next to the file it replaces.
pub const TMP_PREFIX: &str = ".soundhood-tmp-";

/// Audio extensions the library recognises (same list as the pre-rebuild host).
pub fn is_audio_file(name: &str) -> bool {
  let Some((_, ext)) = name.rsplit_once('.') else {
    return false;
  };
  matches!(
    ext.to_ascii_lowercase().as_str(),
    "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "wma" | "aiff" | "alac"
  )
}

/// One audio file as the scanner saw it: where it is and the stamp change detection keys on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStamp {
  pub rel: RelPath,
  /// Modification time, unix seconds.
  pub mtime: i64,
  pub size: u64,
}

/// Every audio file under `root`, sorted by `rel`. Skips the app's own folders (`_Soundhood/`,
/// `_Playlists/` at the top level), every dot-folder (`.stfolder`, `.git`, the Android bin) and the
/// write path's `.soundhood-tmp-*` files. Symlinks are not followed.
pub fn scan(root: &Path) -> Result<Vec<FileStamp>> {
  let mut out = Vec::new();
  let walk = WalkDir::new(root)
    .min_depth(1)
    .into_iter()
    .filter_entry(|e| !skipped_dir(e));
  for entry in walk {
    let entry = entry.map_err(walk_error)?;
    if !entry.file_type().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with(TMP_PREFIX) || !is_audio_file(&name) {
      continue;
    }
    let meta = entry.metadata().map_err(walk_error)?;
    out.push(FileStamp {
      rel: RelPath::from_abs(root, entry.path())?,
      mtime: unix_secs(&meta),
      size: meta.len(),
    });
  }
  out.sort_by(|a, b| a.rel.cmp(&b.rel));
  Ok(out)
}

/// True for folders the scan never enters. The root itself (depth 0) may be a dot-folder
/// (tempdirs are), so only entries below it are judged.
fn skipped_dir(e: &walkdir::DirEntry) -> bool {
  if e.depth() == 0 || !e.file_type().is_dir() {
    return false;
  }
  let name = e.file_name().to_string_lossy();
  name.starts_with('.')
    || (e.depth() == 1 && (name.eq_ignore_ascii_case(APP_DIR) || name.eq_ignore_ascii_case(PLAYLISTS_DIR)))
}

fn walk_error(e: walkdir::Error) -> Error {
  Error::Io(e.into())
}

fn unix_secs(meta: &std::fs::Metadata) -> i64 {
  match meta.modified().map(|t| t.duration_since(UNIX_EPOCH)) {
    Ok(Ok(d)) => d.as_secs() as i64,
    // before 1970: negative seconds rather than a bogus large number
    Ok(Err(e)) => -(e.duration().as_secs() as i64),
    Err(_) => 0,
  }
}

/// `(mtime unix seconds, size)` of one file.
pub fn stamp(abs: &Path) -> Result<(i64, u64)> {
  let meta = std::fs::metadata(abs)?;
  Ok((unix_secs(&meta), meta.len()))
}

/// blake3 of the file's bytes, lowercase hex. Streams the file; never loads it whole.
pub fn file_hash(abs: &Path) -> Result<String> {
  let file = std::fs::File::open(abs)?;
  let mut hasher = blake3::Hasher::new();
  hasher.update_reader(file)?;
  Ok(hasher.finalize().to_hex().to_string())
}

/// This install's device id, from `<app_data_dir>/device-id`; created (uuid v4) on first use with
/// write-then-rename. A file that does not hold a uuid is replaced: an id must be safe to use in
/// file names under `_Soundhood/`.
pub fn device_id(app_data_dir: &Path) -> Result<DeviceId> {
  let path = app_data_dir.join("device-id");
  match std::fs::read_to_string(&path) {
    Ok(text) => {
      if let Ok(id) = uuid::Uuid::parse_str(text.trim()) {
        return Ok(DeviceId(id.hyphenated().to_string()));
      }
    }
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
    Err(e) => return Err(e.into()),
  }
  std::fs::create_dir_all(app_data_dir)?;
  let id = uuid::Uuid::new_v4().hyphenated().to_string();
  let tmp = app_data_dir.join(format!("device-id.{id}.tmp"));
  let written = (|| {
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(id.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, &path)
  })();
  if let Err(e) = written {
    let _ = std::fs::remove_file(&tmp);
    return Err(e.into());
  }
  // Two first starts racing: the last rename wins, so report what is on disk now.
  let on_disk = std::fs::read_to_string(&path)?;
  Ok(DeviceId(on_disk.trim().to_string()))
}

/// Every `.soundhood-tmp-*` file under the root (including `_Soundhood/` and `_Playlists/`; not
/// inside dot-folders, where the core never writes), sorted.
pub fn list_tmp_files(root: &Path) -> Result<Vec<RelPath>> {
  let mut out = Vec::new();
  let walk = WalkDir::new(root)
    .min_depth(1)
    .into_iter()
    .filter_entry(|e| e.depth() == 0 || !e.file_type().is_dir() || !e.file_name().to_string_lossy().starts_with('.'));
  for entry in walk {
    let entry = entry.map_err(walk_error)?;
    if entry.file_type().is_file() && entry.file_name().to_string_lossy().starts_with(TMP_PREFIX) {
      out.push(RelPath::from_abs(root, entry.path())?);
    }
  }
  out.sort();
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn audio_extensions() {
    assert!(is_audio_file("Song - Artist.M4A"));
    assert!(is_audio_file("a.b.flac"));
    assert!(!is_audio_file("cover.jpg"));
    assert!(!is_audio_file("noext"));
  }
}
