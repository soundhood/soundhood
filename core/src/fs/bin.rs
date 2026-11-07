//! Deletes go to a bin, never to oblivion. Desktop: the OS recycle bin (`trash`). Android, where
//! shared storage has no recycle bin: `<root>/_Soundhood/.bin/<yyyy-mm>/<rel_path>` on the same
//! volume, moved there by rename.

use super::{rename_no_clobber, APP_DIR};
use crate::error::{Error, Result};
use crate::model::{Library, RelPath};
use serde::{Deserialize, Serialize};
// Only the recycle-bin search (Windows, Linux) takes paths apart.
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
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
  let Some(item) = newest_match(items, &original) else {
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

/// For startup recovery: the OS recycle bin's item for `rel` that holds exactly the bytes `hash`
/// (blake3) and was deleted at or after `since_ms` (a delete a crash interrupted before it was
/// journaled as done); the newest such item. The hash keeps a deletion made some other way, of
/// other bytes, from being taken for the app's. `Ok(None)` when there is none; `Err` when the bin
/// cannot be listed. Slow on a full bin; it only runs after a crash in the middle of a delete.
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
pub(crate) fn find_in_os_bin(lib: &Library, rel: &RelPath, since_ms: i64, hash: &str) -> Result<Option<BinRecord>> {
  let items = trash::os_limited::list().map_err(|e| Error::Other(format!("cannot read the recycle bin: {e}")))?;
  // The bin keeps whole seconds; the entry's clock reading may be a little later than the delete.
  let since = since_ms.div_euclid(1000) - 2;
  let item = same_path(items, &lib.abs(rel))
    .into_iter()
    .filter(|item| item.time_deleted >= since)
    .filter(|item| super::file_hash(&bin_file(item)).ok().as_deref() == Some(hash))
    .max_by_key(|item| item.time_deleted);
  Ok(item.map(|item| BinRecord {
    kind: BinKind::Os,
    original: rel.clone(),
    bin_rel: None,
    deleted_at: item.time_deleted,
  }))
}

/// Where the recycle bin keeps an item's bytes. Windows: the item's parsing name is the file in
/// `$Recycle.Bin\<SID>\` (`$R…`). Freedesktop: `<trash>/files/<name>` beside `<trash>/info/<name>.trashinfo`.
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn bin_file(item: &trash::TrashItem) -> std::path::PathBuf {
  let id = Path::new(&item.id);
  if cfg!(windows) {
    return id.to_path_buf();
  }
  let trash = id.parent().and_then(Path::parent).unwrap_or(Path::new(""));
  trash.join("files").join(id.file_stem().unwrap_or_default())
}

/// The macOS Trash and another device's bin cannot be searched: nothing is recovered from them.
#[cfg(not(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
)))]
pub(crate) fn find_in_os_bin(_lib: &Library, _rel: &RelPath, _since_ms: i64, _hash: &str) -> Result<Option<BinRecord>> {
  Ok(None)
}

/// For startup recovery: where a delete a crash interrupted put `rel` in the app bin. The name is
/// chosen at delete time (`_Soundhood/.bin/<yyyy-mm>/<rel>`, ` (n)` for a repeat), so every month
/// from `since_ms` to now is searched, newest first, for a copy holding `hash`. `Some(None)` when no
/// copy holds it; `None` when a name cannot be read now (the caller leaves the decision for later).
pub(crate) fn find_in_app_bin(lib: &Library, rel: &RelPath, since_ms: i64, hash: &str) -> Option<Option<BinRecord>> {
  find_in_app_bin_by(lib, rel, since_ms, |bin_rel| {
    match super::file_hash(&lib.abs(bin_rel)) {
      Ok(h) => Some(h == hash),
      Err(Error::Io(e)) if absent(&e) => Some(false),
      Err(_) => None,
    }
  })
}

/// [`find_in_app_bin`] with the test for "this is the copy" given: among the names a delete of
/// `rel` could have used since `since_ms` that hold a file, the newest month first and the highest
/// number within it for which `is_it` holds. `None` when the answer depends on something that
/// cannot be read now (a month folder newer than the copy, or a name above the highest copy that
/// cannot be looked at or that `is_it` cannot tell, `None`), so the caller can leave the decision
/// for later; `Some(None)` when no name is the copy.
pub(crate) fn find_in_app_bin_by(
  lib: &Library,
  rel: &RelPath,
  since_ms: i64,
  mut is_it: impl FnMut(&RelPath) -> Option<bool>,
) -> Option<Option<BinRecord>> {
  let Ok(since) = time::OffsetDateTime::from_unix_timestamp(since_ms.div_euclid(1000)) else {
    return Some(None);
  };
  for m in months_between(since, time::OffsetDateTime::now_utc()) {
    // A month the bin has no folder for is passed over with one look.
    match std::fs::metadata(lib.root.join(APP_DIR).join(".bin").join(&m)) {
      Ok(md) if md.is_dir() => {}
      Ok(_) => continue,
      Err(e) if absent(&e) => continue,
      Err(_) => return None,
    }
    let base = format!("{APP_DIR}/.bin/{m}/{}", rel.as_str());
    let mut found = None;
    // A name that cannot be looked at or told apart now leaves the answer open, unless a higher
    // number turns out to be the copy: the highest-numbered copy wins either way.
    let mut unsure = false;
    let mut misses = 0;
    for n in 1..1000 {
      let Ok(bin_rel) = RelPath::new(&numbered(&base, n)) else {
        break;
      };
      // Only a name that is not there is free.
      let here = match std::fs::metadata(lib.abs(&bin_rel)) {
        Ok(md) => Some(md.is_file()),
        Err(e) if absent(&e) => Some(false),
        Err(_) => None,
      };
      if here == Some(false) {
        // Restored copies leave gaps in the numbering; a long run of free names ends the search.
        misses += 1;
        if misses > 20 {
          break;
        }
        continue;
      }
      misses = 0;
      match here.and_then(|_| is_it(&bin_rel)) {
        Some(true) => {
          found = Some(bin_rel);
          unsure = false;
        }
        Some(false) => {}
        None => unsure = true,
      }
    }
    if unsure {
      return None;
    }
    if let Some(bin_rel) = found {
      return Some(Some(BinRecord {
        kind: BinKind::App,
        original: rel.clone(),
        bin_rel: Some(bin_rel),
        deleted_at: since_ms.div_euclid(1000),
      }));
    }
  }
  Some(None)
}

/// An error that means "nothing is at that name" (a folder on the way is missing, or the name is one
/// no file can have), as opposed to "it cannot be looked at now".
fn absent(e: &std::io::Error) -> bool {
  use std::io::ErrorKind::{InvalidFilename, NotADirectory, NotFound};
  matches!(e.kind(), NotFound | NotADirectory | InvalidFilename)
}

/// The bin's month folders (`yyyy-mm`, as [`to_app_bin`] names them) from the later of `a` and `b`
/// back to the earlier, both included. A delete's bin month is read from the clock at the rename, a
/// moment after its journal entry's time, so it can be the month after that entry's.
fn months_between(a: time::OffsetDateTime, b: time::OffsetDateTime) -> Vec<String> {
  let ym = |t: time::OffsetDateTime| (t.year(), u8::from(t.month()));
  let (lo, hi) = (ym(a).min(ym(b)), ym(a).max(ym(b)));
  let (mut y, mut m) = hi;
  let mut out = Vec::new();
  loop {
    out.push(format!("{y:04}-{m:02}"));
    if (y, m) <= lo {
      return out;
    }
    (y, m) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
  }
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

/// The bin item that is `original`'s newest deletion (the same path may have been binned more than
/// once: the newest is ours). A full recycle bin holds thousands of items, so they are matched by
/// file name first, which is a string compare; only the few with the right name get their folder
/// canonicalized (a file-system call each, which made an undo take a minute on a 10,000-item bin).
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn newest_match(items: Vec<trash::TrashItem>, original: &Path) -> Option<trash::TrashItem> {
  same_path(items, original)
    .into_iter()
    .max_by_key(|item| item.time_deleted)
}

/// Every bin item that is a deletion of `original` (see [`newest_match`] for how they are matched).
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn same_path(items: Vec<trash::TrashItem>, original: &Path) -> Vec<trash::TrashItem> {
  let Some(file_name) = original.file_name() else {
    return Vec::new();
  };
  let name = fold(Path::new(file_name));
  let parent = canonical_parent(original);
  items
    .into_iter()
    .filter(|item| fold(Path::new(&item.name)) == name)
    .filter(|item| same_parent(&item.original_parent, original, parent.as_deref()))
    .collect()
}

/// The canonical form of `p`'s folder, when it exists.
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn canonical_parent(p: &Path) -> Option<std::path::PathBuf> {
  p.parent().and_then(|d| std::fs::canonicalize(d).ok())
}

/// The recycle bin reports the folder it was given, possibly in another spelling (`\\?\` prefix,
/// case, 8.3 names). Compare canonical folders (case-insensitively on Windows); `canon_b` is
/// `b`'s canonical folder, computed once by the caller.
#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn same_parent(a_parent: &Path, b: &Path, canon_b: Option<&Path>) -> bool {
  match (std::fs::canonicalize(a_parent).ok(), canon_b) {
    (Some(x), Some(y)) => fold(&x) == fold(y),
    _ => Some(fold(a_parent)) == b.parent().map(fold),
  }
}

#[cfg(any(
  windows,
  all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
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
  use std::path::Path;

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

  /// The month folders are counted back from the later date to the earlier, across a year end,
  /// and spelled as `to_app_bin` names them.
  #[test]
  fn months_between_counts_back_across_a_year_and_spells_months_as_the_bin_does() {
    use time::macros::datetime;
    let (nov, feb) = (datetime!(2025-11-30 23:59:59 UTC), datetime!(2026-02-01 00:00:00 UTC));
    assert_eq!(months_between(nov, feb), ["2026-02", "2026-01", "2025-12", "2025-11"]);
    assert_eq!(months_between(feb, nov), months_between(nov, feb));
    assert_eq!(months_between(feb, feb), ["2026-02"]);
    let now = time::OffsetDateTime::now_utc();
    let named = now.format(time::macros::format_description!("[year]-[month]")).unwrap();
    assert_eq!(months_between(now, now), [named]);
  }

  /// A delete's bin month is read from the clock at the rename, so it can be later than its
  /// journal entry's month: every month from the entry's to now is searched, not only those two.
  #[test]
  fn find_in_app_bin_searches_every_month_since_the_delete() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("Chill/a.mp3").unwrap();
    let now = time::OffsetDateTime::now_utc();
    let since = now - time::Duration::days(62);
    let months = months_between(since, now);
    assert!(months.len() >= 3, "{months:?}");
    let between = &months[1];
    let bin_rel = RelPath::new(&format!("{APP_DIR}/.bin/{between}/Chill/a.mp3")).unwrap();
    fs::create_dir_all(l.abs(&bin_rel).parent().unwrap()).unwrap();
    fs::write(l.abs(&bin_rel), b"audio").unwrap();
    let hash = super::super::file_hash(&l.abs(&bin_rel)).unwrap();
    let rec = find_in_app_bin(&l, &rel, since.unix_timestamp() * 1000, &hash)
      .flatten()
      .expect("found");
    assert_eq!(rec.bin_rel, Some(bin_rel));
    assert_eq!(rec.original, rel);
  }

  /// A name that cannot be told apart now ends the search with "cannot tell" (`None`), so recovery
  /// leaves the decision for the next start; "no" for every name is `Some(None)`.
  #[test]
  fn find_in_app_bin_by_leaves_the_decision_when_a_name_cannot_be_read() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("a.mp3").unwrap();
    fs::write(l.abs(&rel), b"audio").unwrap();
    let since_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    let rec = to_app_bin(&l, &rel).unwrap();
    assert_eq!(find_in_app_bin_by(&l, &rel, since_ms, |_| None), None);
    assert_eq!(find_in_app_bin_by(&l, &rel, since_ms, |_| Some(false)), Some(None));
    let found = find_in_app_bin_by(&l, &rel, since_ms, |_| Some(true))
      .flatten()
      .unwrap();
    assert_eq!(found.bin_rel, rec.bin_rel);
  }

  /// The highest-numbered copy wins, so a name below it that cannot be told apart does not matter,
  /// while one above it does: the copy could be that one.
  #[test]
  fn find_in_app_bin_by_is_unsure_only_above_the_highest_copy() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path());
    let rel = RelPath::new("a.mp3").unwrap();
    let since_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    fs::write(l.abs(&rel), b"first").unwrap();
    let first = to_app_bin(&l, &rel).unwrap().bin_rel;
    fs::write(l.abs(&rel), b"second").unwrap();
    let second = to_app_bin(&l, &rel).unwrap().bin_rel;
    let unsure_about = |which: &Option<RelPath>| {
      let which = which.clone();
      move |b: &RelPath| if Some(b) == which.as_ref() { None } else { Some(true) }
    };
    let found = find_in_app_bin_by(&l, &rel, since_ms, unsure_about(&first))
      .flatten()
      .unwrap();
    assert_eq!(found.bin_rel, second, "a lower name it cannot tell does not matter");
    assert_eq!(
      find_in_app_bin_by(&l, &rel, since_ms, unsure_about(&second)),
      None,
      "a higher name it cannot tell leaves the answer open"
    );
  }

  /// Restore picks the newest deletion of the same path among items with that name, ignores the
  /// same name from another folder and other names in the same folder, and matches the folder in
  /// another spelling (case on Windows, a trailing separator).
  #[cfg(any(windows, all(unix, not(target_os = "macos"))))]
  #[test]
  fn restore_picks_the_newest_deletion_of_that_path() {
    let d = tempfile::tempdir().unwrap();
    let here = d.path().join("Chill");
    let elsewhere = d.path().join("Other");
    fs::create_dir_all(&here).unwrap();
    fs::create_dir_all(&elsewhere).unwrap();
    let item = |id: &str, parent: &Path, name: &str, t: i64| trash::TrashItem {
      id: id.into(),
      name: name.into(),
      original_parent: parent.to_path_buf(),
      time_deleted: t,
    };
    let mut respelled = here.clone().into_os_string();
    if cfg!(windows) {
      respelled = respelled.to_string_lossy().to_uppercase().into();
    }
    respelled.push(std::path::MAIN_SEPARATOR_STR);
    let items = vec![
      item("old", &here, "Song - Artist.m4a", 100),
      item("other-folder", &elsewhere, "Song - Artist.m4a", 900),
      item("other-name", &here, "Other - Artist.m4a", 950),
      item("newest", Path::new(&respelled), "Song - Artist.m4a", 500),
      item("older", &here, "Song - Artist.m4a", 300),
    ];
    let original = here.join("Song - Artist.m4a");
    let got = newest_match(items.clone(), &original).map(|i| i.id);
    assert_eq!(got, Some("newest".into()));
    assert!(newest_match(items, &here.join("Missing.m4a")).is_none());
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
    let hash = super::super::file_hash(&l.abs(&rel)).unwrap();
    let since_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    let rec = to_os_bin(&l, &rel).unwrap();
    assert_eq!(rec.kind, BinKind::Os);
    assert!(rec.bin_rel.is_none());
    assert!(!l.abs(&rel).exists());
    // Recovery finds the item by its bytes, and not with other bytes or before the delete.
    let found = find_in_os_bin(&l, &rel, since_ms, &hash)
      .unwrap()
      .expect("found by hash");
    assert_eq!(found.original, rel);
    assert!(find_in_os_bin(&l, &rel, since_ms, &"0".repeat(64)).unwrap().is_none());
    assert!(find_in_os_bin(&l, &rel, since_ms + 60_000, &hash).unwrap().is_none());
    let started = std::time::Instant::now();
    restore_from_bin(&l, &rec).unwrap();
    eprintln!("restore from the OS bin took {:?}", started.elapsed());
    assert_eq!(fs::read(l.abs(&rel)).unwrap(), b"binned");
  }
}
