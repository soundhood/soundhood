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
pub(crate) fn rename_no_clobber(from: &Path, to: &Path) -> Result<()> {
  let dir = to
    .parent()
    .ok_or_else(|| Error::InvalidPath(to.display().to_string()))?;
  std::fs::create_dir_all(dir)?;
  check_free(from, to)?;
  std::fs::rename(from, to).map_err(|e| in_use_or_io(e, from))?;
  sync_parent(to);
  Ok(())
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

/// Cross-volume landing: copy to <dest dir>/.soundhood-tmp-<job>, fsync, rename to dest, then remove src.
///
/// The staged copy is hidden and named `.soundhood-tmp-<job>.<ext of dest>`. The final rename
/// never overwrites (Error::Exists). `src` lives in app data (the download staging area), so
/// failing to remove it after a successful landing is not an error.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn stage_move(src: &Path, dest: &Path, job: &str) -> Result<()> {
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
  let landed = (|| {
    io::copy(&mut input, &mut out)?;
    out.sync_all()?;
    drop(out);
    #[cfg(windows)]
    super::win::set_hidden(&tmp, false)?;
    rename_no_clobber(&tmp, dest)
  })();
  if let Err(e) = landed {
    let _ = std::fs::remove_file(&tmp);
    return Err(e);
  }
  drop(input);
  let _ = std::fs::remove_file(src);
  Ok(())
}

/// Removes one of the core's own temp files. Refuses any other name, so this can never delete a
/// user file. A file that is already gone is not an error.
#[allow(dead_code)] // reached from ingest::tagwrite (zone core-writepath)
pub(crate) fn remove_file(abs: &Path) -> Result<()> {
  let is_tmp = abs
    .file_name()
    .is_some_and(|n| n.to_string_lossy().starts_with(TMP_PREFIX));
  if !is_tmp {
    return Err(Error::Refused(format!("not a temp file: {}", abs.display())));
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

  #[test]
  fn remove_file_only_removes_temps() {
    let d = tempfile::tempdir().unwrap();
    let user = d.path().join("a.mp3");
    fs::write(&user, b"a").unwrap();
    assert!(matches!(remove_file(&user), Err(Error::Refused(_))));
    assert!(user.exists());
    let tmp = tmp_path(d.path(), "j", "mp3");
    fs::write(&tmp, b"t").unwrap();
    remove_file(&tmp).unwrap();
    assert!(!tmp.exists());
    remove_file(&tmp).unwrap(); // already gone: fine
  }
}
