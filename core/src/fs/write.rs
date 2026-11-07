//! The low-level steps of the one write path: hidden temps, fsync, atomic replace with retries,
//! no-clobber renames and the cross-volume staging move. Only `ingest::tagwrite` (and the playlist
//! sole writer) call these.

use super::TMP_PREFIX;
use crate::error::{Error, Result};
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;

/// How often a replace blocked by another process's handle is retried, and how far apart.
const IN_USE_RETRIES: u32 = 3;
const IN_USE_BACKOFF: Duration = Duration::from_millis(250);

/// `<dir>/.soundhood-tmp-<job>.<ext>` (no trailing dot when `ext` is empty).
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn tmp_path(dir: &Path, job: &str, ext: &str) -> PathBuf {
  if ext.is_empty() {
    dir.join(format!("{TMP_PREFIX}{job}"))
  } else {
    dir.join(format!("{TMP_PREFIX}{job}.{ext}"))
  }
}

/// Length of a journal entry id: a uuid v4 in its simple form, 32 lower-case hex digits.
const ENTRY_ID_LEN: usize = 32;

/// The journal entry id inside a temp name the core itself made with [`tmp_path`]:
/// `.soundhood-tmp-<id>[-<p|r|c><n>][.<ext>]`, `<id>` being 32 lower-case hex digits. `None` for
/// any other name, including a user's own file that merely starts with the prefix
/// (`.soundhood-tmp-My Song.m4a`): only names of this exact shape are ever removed.
pub(crate) fn temp_entry_id(name: &str) -> Option<&str> {
  let rest = name.strip_prefix(TMP_PREFIX)?;
  let (job, ext) = match rest.split_once('.') {
    Some((job, ext)) => (job, Some(ext)),
    None => (rest, None),
  };
  if ext.is_some_and(|e| e.is_empty() || e.contains('.')) {
    return None;
  }
  let (id, suffix) = job.split_at_checked(ENTRY_ID_LEN)?;
  if !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
    return None;
  }
  if !suffix.is_empty() {
    let part = suffix.strip_prefix('-')?;
    let (kind, n) = part.split_at_checked(1)?;
    if !matches!(kind, "p" | "r" | "c") || n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) {
      return None;
    }
  }
  Some(id)
}

/// Creates `path` for writing; fails if it already exists. On Windows the file is created with
/// the hidden attribute (on unix the leading dot of the temp name already hides it).
pub(crate) fn create_hidden(path: &Path) -> Result<File> {
  let mut opts = OpenOptions::new();
  opts.write(true).create_new(true);
  #[cfg(windows)]
  {
    use std::os::windows::fs::OpenOptionsExt;
    opts.attributes(super::win::HIDDEN);
  }
  opts.open(path).map_err(|e| match e.kind() {
    io::ErrorKind::AlreadyExists => Error::Exists(path.display().to_string()),
    _ => Error::Io(e),
  })
}

/// Copies `src` to a hidden temp in the same folder (`.soundhood-tmp-<job>.<ext>`) and fsyncs
/// it. The copy keeps the source's permissions on unix so the replaced file keeps its mode.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn copy_to_tmp(src: &Path, job: &str) -> Result<PathBuf> {
  let dir = src
    .parent()
    .ok_or_else(|| Error::InvalidPath(src.display().to_string()))?;
  let ext = src
    .extension()
    .map(|e| e.to_string_lossy().to_string())
    .unwrap_or_default();
  let tmp = tmp_path(dir, job, &ext);
  let mut input = File::open(src).map_err(|e| in_use_or_io(e, src))?;
  let mut out = create_hidden(&tmp)?;
  let copied = (|| {
    io::copy(&mut input, &mut out)?;
    out.sync_all()?;
    #[cfg(unix)]
    std::fs::set_permissions(&tmp, input.metadata()?.permissions())?;
    Ok::<(), io::Error>(())
  })();
  if let Err(e) = copied {
    drop(out);
    let _ = std::fs::remove_file(&tmp);
    return Err(e.into());
  }
  Ok(tmp)
}

/// Flushes `path` to stable storage. Directories are fsynced on unix (so a rename inside them is
/// durable) and skipped on Windows, which cannot open them as files.
pub(crate) fn fsync(path: &Path) -> Result<()> {
  if path.is_dir() {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    return Ok(());
  }
  // FlushFileBuffers needs write access on Windows; read access is enough elsewhere.
  let file = OpenOptions::new().read(true).write(cfg!(windows)).open(path)?;
  file.sync_all()?;
  Ok(())
}

/// Atomic replace of `dest` by `tmp` (same volume). On Windows sharing violations / EACCES:
/// 3 retries, 250 ms apart, then Error::InUse.
///
/// A read-only `dest` is refused up front (`Error::Refused`) rather than retried as "in use".
/// The temp's hidden bit is cleared first (a rename carries attributes along) unless `dest` was
/// itself hidden. On any failure `dest` is untouched and `tmp` is left (hidden again) for the
/// caller to remove.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn atomic_replace(tmp: &Path, dest: &Path) -> Result<()> {
  if let Ok(meta) = std::fs::metadata(dest) {
    if meta.permissions().readonly() {
      return Err(Error::Refused(format!("read-only file: {}", dest.display())));
    }
  }
  #[cfg(windows)]
  super::win::set_hidden(tmp, super::win::is_hidden(dest))?;
  let mut attempt = 0;
  loop {
    match std::fs::rename(tmp, dest) {
      Ok(()) => {
        sync_parent(dest);
        return Ok(());
      }
      Err(e) if is_in_use(&e) && attempt < IN_USE_RETRIES => {
        attempt += 1;
        std::thread::sleep(IN_USE_BACKOFF);
      }
      Err(e) => {
        #[cfg(windows)]
        let _ = super::win::set_hidden(tmp, true);
        if is_in_use(&e) {
          return Err(Error::InUse(dest.display().to_string()));
        }
        return Err(e.into());
      }
    }
  }
}

/// Rename within the root; refuses (Error::Exists) when the destination exists, case-insensitively.
///
/// The collision check compares lower-cased NFC names inside the destination folder, because
/// Windows is case-insensitive and Proton web is not. Renaming a file to a different case (or
/// normalisation) of its own name is allowed. Creates the destination folder if needed.
///
/// The rename itself never replaces either: a file that appears under the destination name after
/// the check (a sync client landing it) makes the rename fail with `Error::Exists` instead of
/// being overwritten. See [`rename_no_replace`].
pub(crate) fn rename_no_clobber(from: &Path, to: &Path) -> Result<()> {
  let dir = to
    .parent()
    .ok_or_else(|| Error::InvalidPath(to.display().to_string()))?;
  std::fs::create_dir_all(dir)?;
  check_free(from, to)?;
  rename_no_replace(from, to).map_err(|e| match e.kind() {
    io::ErrorKind::AlreadyExists => Error::Exists(to.display().to_string()),
    _ => in_use_or_io(e, from),
  })?;
  sync_parent(to);
  Ok(())
}

/// A rename that fails (`AlreadyExists`) rather than replace a file at `to`, decided by the file
/// system at the moment of the rename, not by an earlier look. `std::fs::rename` replaces on every
/// platform, so: Windows uses `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`; unix links the
/// new name (`link` refuses an existing name) and then unlinks the old one, falling back to the
/// checked rename where the file system has no hard links (FAT, the Android shared-storage layer).
/// A case- or normalisation-only change of the file's own name is a plain rename: on a
/// case-insensitive disk the "existing" destination is the file itself.
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
  #[cfg(windows)]
  {
    super::win::move_no_replace(from, to)
  }
  #[cfg(unix)]
  {
    if same_name_in_same_folder(from, to) {
      return std::fs::rename(from, to);
    }
    match std::fs::hard_link(from, to) {
      // A crash between the link and the unlink leaves both names on the one file: startup
      // recovery finishes that rename, whether a move, a rename, a delete into the app bin or an
      // undo bringing a file back from it (`ingest::recover`).
      Ok(()) => {
        crate::ingest::fault::point("after_link");
        std::fs::remove_file(from).inspect_err(|_| {
          // Leave one name, the old one, rather than two.
          let _ = std::fs::remove_file(to);
        })
      }
      Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
      Err(_) => {
        if to.symlink_metadata().is_ok() {
          return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        std::fs::rename(from, to)
      }
    }
  }
  #[cfg(not(any(windows, unix)))]
  {
    std::fs::rename(from, to)
  }
}

/// `to` is `from`'s own name in another case or Unicode normalisation, in the same folder.
#[cfg(unix)]
fn same_name_in_same_folder(from: &Path, to: &Path) -> bool {
  let name = |p: &Path| p.file_name().map(|n| name_key(&n.to_string_lossy()));
  from.parent() == to.parent() && name(from).is_some() && name(from) == name(to)
}

/// Err(Exists) when a name equal to `to`'s (lower-cased NFC) is taken in `to`'s folder by
/// anything other than `from` itself.
fn check_free(from: &Path, to: &Path) -> Result<()> {
  let exists = || Err(Error::Exists(to.display().to_string()));
  let Some(to_name) = to.file_name() else {
    return Err(Error::InvalidPath(to.display().to_string()));
  };
  let key = name_key(&to_name.to_string_lossy());
  let same_dir = from.parent() == to.parent();
  let from_name = from
    .file_name()
    .map(|n| n.to_string_lossy().to_string())
    .unwrap_or_default();
  let dir = to.parent().unwrap_or(Path::new("."));
  for entry in std::fs::read_dir(dir)? {
    let name = entry?.file_name().to_string_lossy().to_string();
    if name_key(&name) != key {
      continue;
    }
    if same_dir && name == from_name {
      continue; // the source itself: a pure case / normalisation change
    }
    return exists();
  }
  // The listing can disagree with the file system's own folding (e.g. Unicode case rules);
  // trust the file system too.
  if to.symlink_metadata().is_ok() && !(same_dir && name_key(&from_name) == key) {
    return exists();
  }
  Ok(())
}

fn name_key(name: &str) -> String {
  name.nfc().collect::<String>().to_lowercase()
}

/// What a new library path would clash with once synced to a disk that folds names.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Twin {
  /// The path's own name is taken (by a file or a folder), in another case or normalisation.
  Name,
  /// A folder on the way there exists in another case or normalisation: its path as on disk.
  Folder(String),
  /// A file stands where a folder on the way would go, in another case or normalisation: its
  /// path as on disk.
  NotAFolder(String),
}

/// `rel` with every folder on the way spelled as it is on disk: a folder segment that folds (lower-
/// cased NFC, as in [`check_free`]) to an existing folder's name takes that folder's spelling, so
/// a change goes into the folder that is there instead of making a second one beside it. That is
/// what a disk that folds case does by itself (Windows, Android's shared storage). A case-sensitive
/// disk (Linux, Android app storage) would keep both, and NTFS keeps NFC and NFD apart, so a folder
/// that came from a Mac in NFD has a twin there too; both clash once synced. An exact spelling
/// wins; below the first folder that does not exist yet, the rest is new and kept as given. The
/// last segment is kept as given too: another spelling of a name that is there is a clash
/// ([`case_twin`]) or a rename of a file's own spelling. Errors only for a folder that cannot be
/// listed.
pub(crate) fn folders_as_on_disk(root: &Path, rel: &str) -> Result<String> {
  let segs: Vec<&str> = rel.split('/').collect();
  let Some((last, folders)) = segs.split_last() else {
    return Ok(rel.to_string());
  };
  let mut dir = root.to_path_buf();
  let mut out: Vec<String> = Vec::with_capacity(segs.len());
  let mut existing = true;
  for seg in folders {
    let name = match existing.then(|| existing_folder(&dir, seg)).transpose()?.flatten() {
      Some(name) => name,
      None => {
        existing = false;
        seg.to_string()
      }
    };
    dir = dir.join(&name);
    out.push(name);
  }
  out.push(last.to_string());
  Ok(out.join("/"))
}

/// The on-disk name of `dir`'s folder spelled `seg`, or folding to it; `None` when there is none.
/// The exact spelling wins; then a folder that differs only in case, in the same Unicode form (the
/// one a disk that folds case opens); then one in the other form. Two candidates at the same step
/// are refused by name rather than chosen by the order the disk lists them.
fn existing_folder(dir: &Path, seg: &str) -> Result<Option<String>> {
  let entries = match std::fs::read_dir(dir) {
    Ok(entries) => entries,
    Err(e) if matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => return Ok(None),
    Err(e) => return Err(e.into()),
  };
  let key = name_key(seg);
  let lower = seg.to_lowercase();
  let (mut same_form, mut other_form) = (Vec::new(), Vec::new());
  for entry in entries {
    let entry = entry?;
    let name = entry.file_name().to_string_lossy().to_string();
    if name_key(&name) != key || !entry.path().is_dir() {
      continue;
    }
    if name == seg {
      return Ok(Some(name));
    }
    if name.to_lowercase() == lower {
      same_form.push(name);
    } else {
      other_form.push(name);
    }
  }
  let mut found = if same_form.is_empty() { other_form } else { same_form };
  if found.len() > 1 {
    found.sort();
    return Err(Error::Refused(format!(
      "more than one folder is named like {seg} ({}), so nothing was changed",
      found.join(", ")
    )));
  }
  Ok(found.pop())
}

/// Ok when the name `to` is free in its folder for `from`, the check the no-clobber rename makes
/// ([`check_free`]): `Error::Exists` when another entry has it in any case or Unicode form. For a
/// refusal before anything is journaled, where the destination folder already exists.
pub(crate) fn name_free(from: &Path, to: &Path) -> Result<()> {
  check_free(from, to)
}

/// `rel`'s case twin under `root`, walking it one segment at a time: a segment whose own spelling
/// is not there but whose folded name (lower-cased NFC, as in [`check_free`]) another entry of that
/// folder has. A disk that folds case and normalisation finds the exact spelling and this is
/// `None`. A case-sensitive disk (Linux, Android app storage) keeps both names side by side, as
/// NTFS does for NFC and NFD, and the pair clashes as soon as it syncs to a folding disk, so the
/// write path refuses it before it journals anything. Destinations the user asks for have their
/// folders resolved first ([`folders_as_on_disk`]), so for them only the name itself can be a twin;
/// a folder twin is left for an undo, which puts a file back where it was. A folder twin is
/// followed, so a file twin inside it is reported as the name being taken, the answer Windows
/// gives for that path. Errors only for a folder that cannot be listed.
pub(crate) fn case_twin(root: &Path, rel: &str) -> Result<Option<Twin>> {
  let segs: Vec<&str> = rel.split('/').collect();
  let mut dir = root.to_path_buf();
  let mut on_disk: Vec<String> = Vec::new();
  let mut folder = None;
  for (i, seg) in segs.iter().enumerate() {
    let last = i + 1 == segs.len();
    let exact = dir.join(seg);
    let name = if exact.symlink_metadata().is_ok() {
      seg.to_string()
    } else {
      let key = name_key(seg);
      let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => break,
        Err(e) => return Err(e.into()),
      };
      let mut found = None;
      for entry in entries {
        let name = entry?.file_name().to_string_lossy().to_string();
        if name_key(&name) == key {
          found = Some(name);
          break;
        }
      }
      match found {
        Some(name) => name,
        None => break, // this segment is new, and so is everything below it
      }
    };
    if last {
      // Reached only through a folder twin (callers refuse the exact path themselves) or as one.
      return Ok(Some(Twin::Name));
    }
    let twin = name != *seg;
    dir = dir.join(&name);
    on_disk.push(name);
    if twin && !dir.is_dir() {
      return Ok(Some(Twin::NotAFolder(on_disk.join("/"))));
    }
    if twin && folder.is_none() {
      folder = Some(on_disk.join("/"));
    }
  }
  Ok(folder.map(Twin::Folder))
}

/// Cross-volume landing: copy to <dest dir>/.soundhood-tmp-<job>, fsync, rename to dest, then remove src.
///
/// The staged copy is hidden and named `.soundhood-tmp-<job>.<ext of dest>`. The final rename
/// never overwrites (Error::Exists). `src` lives in app data (the download staging area), so
/// failing to remove it after a successful landing is not an error.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn stage_move(src: &Path, dest: &Path, job: &str) -> Result<()> {
  let tmp = stage_copy(src, dest, job)?;
  stage_finish(&tmp, dest, src)
}

/// First half of [`stage_move`]: refuses early when `dest`'s name is taken, then copies `src` to
/// the hidden `<dest dir>/.soundhood-tmp-<job>.<ext of dest>` and fsyncs it. Returns the temp.
/// Split out so the write path can journal (and crash-test, `after_stage_copy`) between the copy
/// and the rename; a crash here leaves only a temp that orphan cleanup finds.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn stage_copy(src: &Path, dest: &Path, job: &str) -> Result<PathBuf> {
  let dir = dest
    .parent()
    .ok_or_else(|| Error::InvalidPath(dest.display().to_string()))?;
  std::fs::create_dir_all(dir)?;
  check_free(src, dest)?;
  let ext = dest
    .extension()
    .map(|e| e.to_string_lossy().to_string())
    .unwrap_or_default();
  let tmp = tmp_path(dir, job, &ext);
  let mut input = File::open(src).map_err(|e| in_use_or_io(e, src))?;
  let mut out = create_hidden(&tmp)?;
  let copied = io::copy(&mut input, &mut out).and_then(|_| out.sync_all());
  drop(out);
  if let Err(e) = copied {
    let _ = std::fs::remove_file(&tmp);
    return Err(e.into());
  }
  Ok(tmp)
}

/// Second half of [`stage_move`]: the staged temp becomes `dest` (never overwriting; on failure
/// the temp is removed and `src` kept), then `src` is removed. `src` lives in app data (the
/// download staging area), so failing to remove it after a successful landing is not an error.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn stage_finish(tmp: &Path, dest: &Path, src: &Path) -> Result<()> {
  if let Err(e) = place_new(tmp, dest) {
    let _ = std::fs::remove_file(tmp);
    return Err(e);
  }
  let _ = std::fs::remove_file(src);
  Ok(())
}

/// A hidden temp becomes the new file `dest`: its hidden bit comes off (Windows carries the temp's
/// attributes through the rename), then it is renamed without ever replacing ([`rename_no_clobber`]:
/// `Error::Exists` when the name is taken, also at the instant of the rename). On failure the temp
/// is left, unhidden, for the caller to remove.
pub(crate) fn place_new(tmp: &Path, dest: &Path) -> Result<()> {
  #[cfg(windows)]
  super::win::set_hidden(tmp, false)?;
  rename_no_clobber(tmp, dest)
}

/// Removes one of the core's own temp files. Refuses any other name, including a user's file that
/// only starts with the temp prefix (see [`temp_entry_id`]), so this can never delete a user file.
/// A file that is already gone is not an error.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn remove_file(abs: &Path) -> Result<()> {
  let is_tmp = abs
    .file_name()
    .is_some_and(|n| temp_entry_id(&n.to_string_lossy()).is_some());
  if !is_tmp {
    return Err(Error::Refused("not one of the app's temp files".into()));
  }
  match std::fs::remove_file(abs) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(in_use_or_io(e, abs)),
  }
}

/// Best-effort durability of a rename: fsync the containing folder (unix only; some Android file
/// systems reject it, which is harmless).
fn sync_parent(path: &Path) {
  if let Some(dir) = path.parent() {
    let _ = fsync(dir);
  }
}

/// Another process holds the file: Windows sharing / lock violation or access denied while
/// open; EBUSY / EACCES / ETXTBSY on unix.
fn is_in_use(e: &io::Error) -> bool {
  #[cfg(windows)]
  const CODES: &[i32] = &[32, 33, 5];
  #[cfg(unix)]
  const CODES: &[i32] = &[16, 13, 26];
  #[cfg(not(any(windows, unix)))]
  const CODES: &[i32] = &[];
  e.raw_os_error().is_some_and(|c| CODES.contains(&c))
}

fn in_use_or_io(e: io::Error, path: &Path) -> Error {
  if is_in_use(&e) {
    Error::InUse(path.display().to_string())
  } else {
    Error::Io(e)
  }
}

/// Opening a file to read it failed because another program holds it exclusively: a Windows
/// sharing or lock violation (32, 33), EBUSY on unix. Narrower than [`is_in_use`]: access denied on
/// a read is a permission problem, not a busy file.
pub(crate) fn is_locked(e: &io::Error) -> bool {
  #[cfg(windows)]
  const CODES: &[i32] = &[32, 33];
  #[cfg(unix)]
  const CODES: &[i32] = &[16];
  #[cfg(not(any(windows, unix)))]
  const CODES: &[i32] = &[];
  e.raw_os_error().is_some_and(|c| CODES.contains(&c))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  fn tmp_path_shape() {
    let dir = Path::new("lib");
    assert_eq!(tmp_path(dir, "j1", "m4a"), dir.join(".soundhood-tmp-j1.m4a"));
    assert_eq!(tmp_path(dir, "j1", ""), dir.join(".soundhood-tmp-j1"));
  }

  #[test]
  fn create_hidden_refuses_existing() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join(".soundhood-tmp-a.mp3");
    create_hidden(&p).unwrap();
    assert!(matches!(create_hidden(&p), Err(Error::Exists(_))));
    #[cfg(windows)]
    assert!(super::super::win::is_hidden(&p));
  }

  #[test]
  fn copy_to_tmp_copies_bytes_next_to_source() {
    let d = tempfile::tempdir().unwrap();
    let src = d.path().join("Song - Artist.m4a");
    fs::write(&src, b"audio bytes").unwrap();
    let tmp = copy_to_tmp(&src, "job7").unwrap();
    assert_eq!(tmp, d.path().join(".soundhood-tmp-job7.m4a"));
    assert_eq!(fs::read(&tmp).unwrap(), b"audio bytes");
    #[cfg(windows)]
    assert!(super::super::win::is_hidden(&tmp));
    fsync(&tmp).unwrap();
    fsync(d.path()).unwrap();
  }

  #[test]
  fn atomic_replace_swaps_content_and_unhides() {
    let d = tempfile::tempdir().unwrap();
    let dest = d.path().join("a.mp3");
    fs::write(&dest, b"old").unwrap();
    let tmp = tmp_path(d.path(), "j", "mp3");
    {
      use std::io::Write;
      create_hidden(&tmp).unwrap().write_all(b"new").unwrap();
    }
    atomic_replace(&tmp, &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"new");
    assert!(!tmp.exists());
    #[cfg(windows)]
    assert!(
      !super::super::win::is_hidden(&dest),
      "the replaced file must not inherit the temp's hidden bit"
    );
  }

  #[test]
  fn atomic_replace_creates_missing_dest() {
    let d = tempfile::tempdir().unwrap();
    let dest = d.path().join("new.m3u8");
    let tmp = tmp_path(d.path(), "j", "m3u8");
    fs::write(&tmp, b"x").unwrap();
    atomic_replace(&tmp, &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"x");
  }

  #[test]
  fn atomic_replace_refuses_read_only_dest() {
    let d = tempfile::tempdir().unwrap();
    let dest = d.path().join("a.mp3");
    fs::write(&dest, b"old").unwrap();
    let mut perm = fs::metadata(&dest).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(&dest, perm.clone()).unwrap();
    let tmp = tmp_path(d.path(), "j", "mp3");
    fs::write(&tmp, b"new").unwrap();
    assert!(matches!(atomic_replace(&tmp, &dest), Err(Error::Refused(_))));
    assert_eq!(fs::read(&dest).unwrap(), b"old");
    assert!(tmp.exists());
    #[allow(clippy::permissions_set_readonly_false)]
    perm.set_readonly(false);
    fs::set_permissions(&dest, perm).unwrap();
  }

  /// A handle without FILE_SHARE_DELETE (what a player or the Proton client may hold) blocks the
  /// rename: retried, then reported as in use, original intact.
  #[cfg(windows)]
  #[test]
  fn atomic_replace_reports_in_use_and_keeps_dest() {
    use std::os::windows::fs::OpenOptionsExt;
    let d = tempfile::tempdir().unwrap();
    let dest = d.path().join("a.mp3");
    fs::write(&dest, b"old").unwrap();
    let tmp = tmp_path(d.path(), "j", "mp3");
    fs::write(&tmp, b"new").unwrap();
    let holder = OpenOptions::new()
      .read(true)
      .share_mode(1 /* FILE_SHARE_READ */)
      .open(&dest)
      .unwrap();
    let started = std::time::Instant::now();
    let res = atomic_replace(&tmp, &dest);
    assert!(matches!(res, Err(Error::InUse(_))), "{res:?}");
    assert!(started.elapsed() >= IN_USE_BACKOFF * IN_USE_RETRIES);
    drop(holder);
    assert_eq!(fs::read(&dest).unwrap(), b"old");
    assert_eq!(fs::read(&tmp).unwrap(), b"new");
  }

  #[test]
  fn rename_no_clobber_refuses_any_case() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a.mp3");
    let b = d.path().join("Sub").join("B.mp3");
    fs::write(&a, b"a").unwrap();
    fs::create_dir_all(b.parent().unwrap()).unwrap();
    fs::write(&b, b"b").unwrap();
    let to = d.path().join("Sub").join("b.MP3");
    assert!(matches!(rename_no_clobber(&a, &to), Err(Error::Exists(_))));
    assert_eq!(fs::read(&a).unwrap(), b"a");
    assert_eq!(fs::read(&b).unwrap(), b"b");
  }

  #[test]
  fn rename_no_clobber_refuses_nfd_twin() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("x.mp3");
    fs::write(&a, b"a").unwrap();
    fs::write(d.path().join("Beyonce\u{301}.mp3"), b"nfd").unwrap();
    let to = d.path().join("Beyonc\u{e9}.mp3");
    assert!(matches!(rename_no_clobber(&a, &to), Err(Error::Exists(_))));
  }

  /// Holds on any disk: where the disk folds names itself, the twin spelling simply is the folder.
  #[test]
  fn case_twin_finds_what_a_folding_disk_would_clash_with() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    fs::create_dir_all(root.join("Downloads")).unwrap();
    fs::write(root.join("Downloads").join("New Song.m4a"), b"x").unwrap();
    fs::create_dir_all(root.join("Beyonce\u{301}")).unwrap();
    let folds_case = root.join("DOWNLOADS").exists();
    let folds_nfc = root.join("Beyonc\u{e9}").exists();

    assert_eq!(case_twin(root, "Downloads/Other.m4a").unwrap(), None);
    assert_eq!(case_twin(root, "Brand New/Other.m4a").unwrap(), None);
    assert_eq!(case_twin(root, "Downloads/new song.M4A").unwrap(), Some(Twin::Name));
    assert_eq!(case_twin(root, "downloads/new song.m4a").unwrap(), Some(Twin::Name));
    assert_eq!(
      case_twin(root, "downloads/Other.m4a").unwrap(),
      (!folds_case).then(|| Twin::Folder("Downloads".into()))
    );
    assert_eq!(
      case_twin(root, "Beyonc\u{e9}/x.m4a").unwrap(),
      (!folds_nfc).then(|| Twin::Folder("Beyonce\u{301}".into()))
    );
    fs::write(root.join("Notes"), b"a file").unwrap();
    assert_eq!(
      case_twin(root, "notes/x.m4a").unwrap(),
      (!folds_case).then(|| Twin::NotAFolder("Notes".into()))
    );
  }

  /// On any disk: folders take the spelling that is on disk, the file name and new folders do not.
  #[test]
  fn folders_as_on_disk_spells_existing_folders_as_they_are() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    fs::create_dir_all(root.join("Downloads").join("Live Sets")).unwrap();
    fs::create_dir_all(root.join("Beyonce\u{301}")).unwrap();
    fs::write(root.join("Downloads").join("Song.m4a"), b"x").unwrap();
    fs::write(root.join("Notes"), b"a file, not a folder").unwrap();
    let as_on_disk = |rel: &str| folders_as_on_disk(root, rel).unwrap();

    assert_eq!(as_on_disk("Downloads/new.m4a"), "Downloads/new.m4a");
    assert_eq!(as_on_disk("downloads/new.m4a"), "Downloads/new.m4a");
    assert_eq!(as_on_disk("DOWNLOADS/live sets/new.m4a"), "Downloads/Live Sets/new.m4a");
    assert_eq!(
      as_on_disk("downloads/song.M4A"),
      "Downloads/song.M4A",
      "the name is kept as given"
    );
    assert_eq!(as_on_disk("Beyonc\u{e9}/x.m4a"), "Beyonce\u{301}/x.m4a");
    assert_eq!(
      as_on_disk("downloads/New Folder/sub/x.m4a"),
      "Downloads/New Folder/sub/x.m4a"
    );
    assert_eq!(
      as_on_disk("Fresh/downloads/x.m4a"),
      "Fresh/downloads/x.m4a",
      "below a new folder"
    );
    assert_eq!(
      as_on_disk("notes/x.m4a"),
      "notes/x.m4a",
      "a file is no folder to go into"
    );
    assert_eq!(as_on_disk("x.m4a"), "x.m4a");
  }

  /// Several folders matching a typed name: exact first, then the same Unicode form, then the
  /// other; two at one step are refused by name, never picked by listing order.
  #[test]
  fn folders_as_on_disk_never_lets_listing_order_choose() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    let count = |prefix: &str| {
      fs::read_dir(root)
        .unwrap()
        .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with(prefix))
        .count()
    };
    fs::create_dir_all(root.join("Caf\u{e9}")).unwrap();
    fs::create_dir_all(root.join("Cafe\u{301}")).unwrap();
    if count("Caf") == 2 {
      // NFC and NFD side by side (NTFS, Linux): the typed form decides.
      assert_eq!(folders_as_on_disk(root, "CAF\u{c9}/x.m4a").unwrap(), "Caf\u{e9}/x.m4a");
      assert_eq!(
        folders_as_on_disk(root, "CAFE\u{301}/x.m4a").unwrap(),
        "Cafe\u{301}/x.m4a"
      );
    }
    fs::create_dir_all(root.join("Rock")).unwrap();
    fs::create_dir_all(root.join("ROCK")).unwrap();
    if count("R") == 2 {
      // Case twins (a case-sensitive disk): a third spelling matches both equally.
      match folders_as_on_disk(root, "rock/x.m4a") {
        Err(Error::Refused(m)) => assert_eq!(
          m,
          "more than one folder is named like rock (ROCK, Rock), so nothing was changed"
        ),
        other => panic!("{other:?}"),
      }
      assert_eq!(
        folders_as_on_disk(root, "ROCK/x.m4a").unwrap(),
        "ROCK/x.m4a",
        "exact wins"
      );
    }
  }

  #[test]
  fn rename_no_clobber_moves_and_creates_folder() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a.mp3");
    fs::write(&a, b"a").unwrap();
    let to = d.path().join("New Folder").join("a.mp3");
    rename_no_clobber(&a, &to).unwrap();
    assert!(!a.exists());
    assert_eq!(fs::read(&to).unwrap(), b"a");
  }

  #[test]
  fn rename_no_clobber_allows_case_change_of_same_file() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("song - artist.mp3");
    fs::write(&a, b"a").unwrap();
    let to = d.path().join("Song - Artist.mp3");
    rename_no_clobber(&a, &to).unwrap();
    let names: Vec<String> = fs::read_dir(d.path())
      .unwrap()
      .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
      .collect();
    assert_eq!(names, vec!["Song - Artist.mp3".to_string()]);
  }

  #[test]
  fn stage_move_lands_file_and_removes_source() {
    let staging = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    let src = staging.path().join("dl.m4a");
    fs::write(&src, b"fresh").unwrap();
    let dest = lib.path().join("Chill").join("Song - Artist.m4a");
    stage_move(&src, &dest, "job1").unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"fresh");
    assert!(!src.exists());
    assert!(!lib.path().join("Chill").join(".soundhood-tmp-job1.m4a").exists());
    #[cfg(windows)]
    assert!(!super::super::win::is_hidden(&dest));
  }

  #[test]
  fn stage_move_never_overwrites() {
    let staging = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    let src = staging.path().join("dl.m4a");
    fs::write(&src, b"fresh").unwrap();
    let dest = lib.path().join("Song - Artist.m4a");
    fs::write(lib.path().join("SONG - ARTIST.m4a"), b"existing").unwrap();
    assert!(matches!(stage_move(&src, &dest, "job1"), Err(Error::Exists(_))));
    assert_eq!(fs::read(lib.path().join("SONG - ARTIST.m4a")).unwrap(), b"existing");
    assert!(src.exists(), "the staged source stays when landing is refused");
    assert_eq!(fs::read_dir(lib.path()).unwrap().count(), 1, "no temp left behind");
  }

  /// Stopping between the two halves (a crash at `after_stage_copy`) leaves only a hidden temp
  /// that orphan cleanup can find; the source and the destination name are untouched.
  #[test]
  fn stage_copy_then_finish() {
    let staging = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    let src = staging.path().join("dl.m4a");
    fs::write(&src, b"fresh").unwrap();
    let dest = lib.path().join("Chill").join("Song - Artist.m4a");

    let tmp = stage_copy(&src, &dest, "job2").unwrap();
    assert_eq!(tmp, lib.path().join("Chill").join(".soundhood-tmp-job2.m4a"));
    assert!(!dest.exists());
    assert!(src.exists());
    #[cfg(windows)]
    assert!(super::super::win::is_hidden(&tmp));
    let temps = super::super::list_tmp_files(lib.path()).unwrap();
    assert_eq!(temps.len(), 1);
    assert_eq!(temps[0].as_str(), "Chill/.soundhood-tmp-job2.m4a");

    stage_finish(&tmp, &dest, &src).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"fresh");
    assert!(!tmp.exists() && !src.exists());
  }

  #[test]
  fn stage_finish_refuses_a_name_taken_meanwhile() {
    let staging = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    let src = staging.path().join("dl.m4a");
    fs::write(&src, b"fresh").unwrap();
    let dest = lib.path().join("Song - Artist.m4a");
    let tmp = stage_copy(&src, &dest, "job3").unwrap();
    fs::write(lib.path().join("song - artist.M4A"), b"arrived via sync").unwrap();
    assert!(matches!(stage_finish(&tmp, &dest, &src), Err(Error::Exists(_))));
    assert_eq!(
      fs::read(lib.path().join("song - artist.M4A")).unwrap(),
      b"arrived via sync"
    );
    assert!(!tmp.exists(), "the staged temp is removed");
    assert!(src.exists(), "the source is kept for a retry");
  }

  const ID: &str = "0123456789abcdef0123456789abcdef";

  #[test]
  fn remove_file_only_removes_temps() {
    let d = tempfile::tempdir().unwrap();
    let user = d.path().join("a.mp3");
    fs::write(&user, b"a").unwrap();
    assert!(matches!(remove_file(&user), Err(Error::Refused(_))));
    assert!(user.exists());
    let tmp = tmp_path(d.path(), ID, "mp3");
    fs::write(&tmp, b"t").unwrap();
    remove_file(&tmp).unwrap();
    assert!(!tmp.exists());
    remove_file(&tmp).unwrap(); // already gone: fine
  }

  /// A user's own file whose name merely starts with the temp prefix is not a temp: remove_file
  /// refuses it, so no code path can delete it.
  #[test]
  fn remove_file_refuses_a_user_file_named_like_a_temp() {
    let d = tempfile::tempdir().unwrap();
    for name in [
      ".soundhood-tmp-My Favourite Song.m4a",
      ".soundhood-tmp-job7.m4a",
      ".soundhood-tmp-0123456789ABCDEF0123456789ABCDEF.m4a",
    ] {
      let user = d.path().join(name);
      fs::write(&user, b"mine").unwrap();
      assert!(matches!(remove_file(&user), Err(Error::Refused(_))), "{name}");
      assert_eq!(fs::read(&user).unwrap(), b"mine", "{name}");
    }
  }

  #[test]
  fn temp_entry_ids_are_read_only_from_core_minted_names() {
    let n = |s: &str| format!("{TMP_PREFIX}{s}");
    assert_eq!(temp_entry_id(&n(&format!("{ID}.m4a"))), Some(ID));
    assert_eq!(temp_entry_id(&n(&format!("{ID}.M4A"))), Some(ID));
    assert_eq!(temp_entry_id(&n(ID)), Some(ID));
    assert_eq!(temp_entry_id(&n(&format!("{ID}-p0.m3u8"))), Some(ID));
    assert_eq!(temp_entry_id(&n(&format!("{ID}-r12.m3u8"))), Some(ID));
    assert_eq!(temp_entry_id(&n(&format!("{ID}-c3.m3u8"))), Some(ID));
    for bad in [
      n("My Favourite Song.m4a"),
      n("abc123.m4a"),
      n(".m4a"),
      n(""),
      n(&format!("{ID}.")),
      n(&format!("{ID}.tar.gz")),
      n(&format!("{ID}x.m4a")),
      n(&format!("{ID}-p.m3u8")),
      n(&format!("{ID}-q1.m3u8")),
      n(&format!("{ID}-p1x.m3u8")),
      n(&ID.to_uppercase()),
      format!("{ID}.m4a"),
      "song.m4a".to_string(),
    ] {
      assert_eq!(temp_entry_id(&bad), None, "{bad}");
    }
  }

  /// The no-replace rename refuses an existing destination at the moment of the rename, without
  /// the earlier folder check: both files stay as they were.
  #[test]
  fn rename_no_replace_never_replaces() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a.mp3");
    let b = d.path().join("b.mp3");
    fs::write(&a, b"a").unwrap();
    fs::write(&b, b"b").unwrap();
    let err = rename_no_replace(&a, &b).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists, "{err}");
    assert_eq!(fs::read(&a).unwrap(), b"a");
    assert_eq!(fs::read(&b).unwrap(), b"b");
    // A free name works, and the old name is gone (no second link left behind).
    let c = d.path().join("Sub").join("c.mp3");
    fs::create_dir_all(c.parent().unwrap()).unwrap();
    rename_no_replace(&a, &c).unwrap();
    assert!(!a.exists());
    assert_eq!(fs::read(&c).unwrap(), b"a");
  }

  /// A long absolute path (past MAX_PATH) still renames, and still never replaces.
  #[cfg(windows)]
  #[test]
  fn rename_no_replace_handles_long_paths() {
    let d = tempfile::tempdir().unwrap();
    let mut dir = d.path().to_path_buf();
    while dir.as_os_str().len() < 300 {
      dir.push("a-rather-long-folder-name-for-the-test");
    }
    fs::create_dir_all(&dir).unwrap();
    let a = dir.join("a.mp3");
    let b = dir.join("b.mp3");
    fs::write(&a, b"a").unwrap();
    rename_no_replace(&a, &b).unwrap();
    fs::write(&a, b"again").unwrap();
    assert_eq!(
      rename_no_replace(&a, &b).unwrap_err().kind(),
      io::ErrorKind::AlreadyExists
    );
    assert_eq!(fs::read(&b).unwrap(), b"a");
  }

  #[test]
  fn a_locked_read_is_told_apart_from_access_denied() {
    #[cfg(windows)]
    {
      assert!(is_locked(&io::Error::from_raw_os_error(32)));
      assert!(is_locked(&io::Error::from_raw_os_error(33)));
      assert!(!is_locked(&io::Error::from_raw_os_error(5)));
    }
    #[cfg(unix)]
    {
      assert!(is_locked(&io::Error::from_raw_os_error(16)));
      assert!(!is_locked(&io::Error::from_raw_os_error(13)));
    }
    assert!(!is_locked(&io::Error::from(io::ErrorKind::NotFound)));
  }
}
