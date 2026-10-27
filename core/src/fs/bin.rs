//! Deletes go to a bin, never to oblivion. Desktop: the OS recycle bin (`trash`). Android, where
//! shared storage has no recycle bin: `<root>/_Soundhood/.bin/<yyyy-mm>/<rel_path>` on the same
//! volume, moved there by rename.

use super::{rename_no_clobber, APP_DIR};
use crate::error::{Error, Result};
use crate::model::{Library, RelPath};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Which bin a deleted file went to.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BinKind {
  /// The OS recycle bin / Trash (desktop).
  Os,
  /// The app-managed bin under `_Soundhood/.bin/` (Android).
  App,
}

/// Where a deleted file went; journaled with the delete so undo can bring it back.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BinRecord {
  pub kind: BinKind,
  pub original: RelPath,
  /// The file's place inside the app bin (`_Soundhood/.bin/...`); `None` for the OS bin.
  pub bin_rel: Option<RelPath>,
  /// Unix seconds.
  pub deleted_at: i64,
}

/// Delete to a bin. Desktop: OS recycle bin via `trash` (cfg not android). Android: move to
/// <root>/_Soundhood/.bin/<yyyy-mm>/<rel_path> (same volume). Returns where it went.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn to_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord> {
  #[cfg(target_os = "android")]
  {
    to_app_bin(lib, rel)
  }
  #[cfg(not(target_os = "android"))]
  {
    to_os_bin(lib, rel)
  }
}

/// Brings a binned file back to `rec.original`, never overwriting what is there now
/// (`Error::Exists`). Windows/Linux/Android; macOS -> Error::Refused("restore from the Trash").
#[allow(dead_code)] // reached from ingest::undo (zone core-writepath)
pub(crate) fn restore_from_bin(lib: &Library, rec: &BinRecord) -> Result<()> {
  match rec.kind {
    BinKind::App => restore_from_app_bin(lib, rec),
    BinKind::Os => restore_from_os_bin(lib, rec),
  }
}

fn now_unix() -> i64 {
  time::OffsetDateTime::now_utc().unix_timestamp()
}

#[cfg(not(target_os = "android"))]
fn to_os_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord> {
  let abs = lib.abs(rel);
  if !abs.is_file() {
    return Err(Error::NotFound(rel.to_string()));
  }
  trash::delete(&abs).map_err(|e| Error::Other(format!("could not move {rel} to the recycle bin: {e}")))?;
  Ok(BinRecord {
    kind: BinKind::Os,
    original: rel.clone(),
    bin_rel: None,
    deleted_at: now_unix(),
  })
}

#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn restore_from_os_bin(lib: &Library, rec: &BinRecord) -> Result<()> {
  let original = lib.abs(&rec.original);
  if original.symlink_metadata().is_ok() {
    return Err(Error::Exists(rec.original.to_string()));
  }
  let items = trash::os_limited::list().map_err(|e| Error::Other(format!("cannot read the recycle bin: {e}")))?;
  // The same path may have been binned more than once: the newest deletion is ours.
  let newest = items
    .into_iter()
    .filter(|item| same_path(&item.original_path(), &original))
    .max_by_key(|item| item.time_deleted);
  let Some(item) = newest else {
    return Err(Error::NotFound(format!(
      "{} is no longer in the recycle bin",
      rec.original
    )));
  };
  trash::os_limited::restore_all([item]).map_err(|e| match e {
    trash::Error::RestoreCollision { .. } => Error::Exists(rec.original.to_string()),
    e => Error::Other(format!("could not restore {} from the recycle bin: {e}", rec.original)),
  })
}

#[cfg(target_os = "macos")]
fn restore_from_os_bin(_lib: &Library, _rec: &BinRecord) -> Result<()> {
  Err(Error::Refused("restore from the Trash".into()))
}

/// An `Os` record on Android was written by another device; its file sits in that device's bin.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn restore_from_os_bin(_lib: &Library, rec: &BinRecord) -> Result<()> {
  Err(Error::Refused(format!(
    "{} is in another device's recycle bin",
    rec.original
  )))
}

/// The recycle bin reports the path it was given, possibly in another spelling (`\\?\` prefix,
/// case, 8.3 names). Compare canonical parents and the name, case-insensitively on Windows.
#[cfg(not(target_os = "android"))]
fn same_path(a: &Path, b: &Path) -> bool {
  let canon_parent = |p: &Path| p.parent().and_then(|d| std::fs::canonicalize(d).ok());
  let (Some(an), Some(bn)) = (a.file_name(), b.file_name()) else {
    return false;
  };
  let parents_equal = match (canon_parent(a), canon_parent(b)) {
    (Some(x), Some(y)) => fold(&x) == fold(&y),
    _ => a.parent().map(fold) == b.parent().map(fold),
  };
  parents_equal && fold(Path::new(an)) == fold(Path::new(bn))
}

#[cfg(not(target_os = "android"))]
fn fold(p: &Path) -> String {
  let s = p.to_string_lossy();
  let s = s.strip_prefix(r"\\?\").unwrap_or(&s).replace('/', "\\");
  if cfg!(windows) {
    s.to_lowercase()
  } else {
    s
  }
}

/// The Android bin: `<root>/_Soundhood/.bin/<yyyy-mm>/<rel_path>`, renamed there (same volume).
/// A second deletion of the same path in one month gets ` (2)`, ` (3)`, ... before the extension.
/// Compiled on every platform so it is tested on the desktop too.
#[cfg_attr(not(any(test, target_os = "android")), allow(dead_code))] // desktop builds use the OS bin
pub(crate) fn to_app_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord> {
  let abs = lib.abs(rel);
  if !abs.is_file() {
    return Err(Error::NotFound(rel.to_string()));
  }
  let month = time::OffsetDateTime::now_utc()
    .format(time::macros::format_description!("[year]-[month]"))
    .map_err(Error::other)?;
  let base = format!("{APP_DIR}/.bin/{month}/{}", rel.as_str());
  for n in 1..1000 {
    let bin_rel = RelPath::new(&numbered(&base, n))?;
    match rename_no_clobber(&abs, &lib.abs(&bin_rel)) {
      Ok(()) => {
        return Ok(BinRecord {
          kind: BinKind::App,
          original: rel.clone(),
          bin_rel: Some(bin_rel),
          deleted_at: now_unix(),
        })
      }
      Err(Error::Exists(_)) => continue,
      Err(e) => return Err(e),
    }
  }
  Err(Error::Other(format!("no free name in the bin for {rel}")))
}

/// `a/b.mp3` with n = 2 -> `a/b (2).mp3`; n = 1 leaves it as is.
fn numbered(rel: &str, n: u32) -> String {
  if n == 1 {
    return rel.to_string();
  }
  let (dir, name) = match rel.rsplit_once('/') {
    Some((d, f)) => (format!("{d}/"), f),
    None => (String::new(), rel),
  };
  match name.rsplit_once('.') {
    Some((stem, ext)) if !stem.is_empty() => format!("{dir}{stem} ({n}).{ext}"),
    _ => format!("{dir}{name} ({n})"),
  }
}

fn restore_from_app_bin(lib: &Library, rec: &BinRecord) -> Result<()> {
  let Some(bin_rel) = &rec.bin_rel else {
    return Err(Error::InvalidPath(format!(
      "bin record for {} has no bin path",
      rec.original
    )));
  };
  let from = lib.abs(bin_rel);
  if !from.is_file() {
    return Err(Error::NotFound(format!("{bin_rel} is no longer in the bin")));
  }
  rename_no_clobber(&from, &lib.abs(&rec.original))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::model::{DeviceId, Platform};
  use std::fs;

  fn lib(root: &Path) -> Library {
    Library {
      root: root.to_path_buf(),
      device: DeviceId("dev".into()),
      platform: Platform::Android,
    }
  }

  #[test]
  fn numbered_names() {
    assert_eq!(
      numbered("_Soundhood/.bin/2026-10/a/b.mp3", 1),
      "_Soundhood/.bin/2026-10/a/b.mp3"
    );
    assert_eq!(
      numbered("_Soundhood/.bin/2026-10/a/b.mp3", 2),
      "_Soundhood/.bin/2026-10/a/b (2).mp3"
    );
    assert_eq!(numbered("x", 3), "x (3)");
  }

  #[test]
  fn app_bin_round_trip() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("Chill/Song - Artist.m4a").unwrap();
    fs::create_dir_all(d.path().join("Chill")).unwrap();
    fs::write(l.abs(&rel), b"audio").unwrap();

    let rec = to_app_bin(&l, &rel).unwrap();
    assert_eq!(rec.kind, BinKind::App);
    assert_eq!(rec.original, rel);
    let bin_rel = rec.bin_rel.clone().unwrap();
    assert!(bin_rel.as_str().starts_with("_Soundhood/.bin/"), "{bin_rel}");
    assert!(bin_rel.as_str().ends_with("/Chill/Song - Artist.m4a"), "{bin_rel}");
    assert!(!l.abs(&rel).exists());
    assert_eq!(fs::read(l.abs(&bin_rel)).unwrap(), b"audio");

    // the record survives the journal (serde)
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"kind\":\"app\""), "{json}");
    let back: BinRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(back, rec);

    restore_from_bin(&l, &back).unwrap();
    assert_eq!(fs::read(l.abs(&rel)).unwrap(), b"audio");
    assert!(!l.abs(&bin_rel).exists());
  }

  #[test]
  fn app_bin_numbers_repeat_deletions_and_restore_never_clobbers() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("a.mp3").unwrap();
    fs::write(l.abs(&rel), b"first").unwrap();
    let r1 = to_app_bin(&l, &rel).unwrap();
    fs::write(l.abs(&rel), b"second").unwrap();
    let r2 = to_app_bin(&l, &rel).unwrap();
    assert_ne!(r1.bin_rel, r2.bin_rel);
    assert!(r2.bin_rel.as_ref().unwrap().as_str().ends_with("/a (2).mp3"));

    fs::write(l.abs(&rel), b"third").unwrap();
    assert!(matches!(restore_from_bin(&l, &r1), Err(Error::Exists(_))));
    assert_eq!(fs::read(l.abs(&rel)).unwrap(), b"third");
    assert_eq!(fs::read(l.abs(r1.bin_rel.as_ref().unwrap())).unwrap(), b"first");
  }

  #[test]
  fn app_bin_missing_file_is_not_found() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("gone.mp3").unwrap();
    assert!(matches!(to_app_bin(&l, &rel), Err(Error::NotFound(_))));
  }

  /// Touches the real OS recycle bin (adds one temp file, then restores it), so it only runs on
  /// request: `cargo test -p soundhood-core -- --ignored os_bin`.
  #[cfg(any(windows, all(unix, not(target_os = "macos"))))]
  #[test]
  #[ignore]
  fn os_bin_round_trip() {
    let d = tempfile::tempdir().unwrap();
    let mut l = lib(d.path());
    l.platform = Platform::Desktop;
    let rel = RelPath::new(&format!("soundhood-bin-test-{}.mp3", uuid::Uuid::new_v4())).unwrap();
    fs::write(l.abs(&rel), b"binned").unwrap();
    let rec = to_os_bin(&l, &rel).unwrap();
    assert_eq!(rec.kind, BinKind::Os);
    assert!(rec.bin_rel.is_none());
    assert!(!l.abs(&rel).exists());
    restore_from_bin(&l, &rec).unwrap();
    assert_eq!(fs::read(l.abs(&rel)).unwrap(), b"binned");
  }
}
