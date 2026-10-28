//! The two Windows calls std does not expose. Changing a file's attribute bits: temp files are
//! created hidden (so Explorer and the Proton client leave them alone); a rename carries the
//! attributes along, so the hidden bit must come off before a temp becomes a user file. And a
//! rename that never replaces: `std::fs::rename` always passes `MOVEFILE_REPLACE_EXISTING`.

use std::ffi::OsString;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

/// `FILE_ATTRIBUTE_HIDDEN`.
pub(super) const HIDDEN: u32 = 0x2;
const NORMAL: u32 = 0x80;

#[link(name = "kernel32")]
extern "system" {
  fn SetFileAttributesW(file_name: *const u16, attributes: u32) -> i32;
  fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
}

/// Longest path the plain (non-`\\?\`) form takes for a file: MAX_PATH minus room for an 8.3 name.
const PLAIN_PATH_MAX: usize = 247;

/// `path` as a NUL-terminated wide string; a long absolute path gets the `\\?\` prefix (as std does
/// for its own calls), with `/` turned into `\` since the prefixed form takes paths literally.
fn wide(path: &Path) -> Vec<u16> {
  let os = path.as_os_str();
  let s = os.to_string_lossy();
  let long = os.len() > PLAIN_PATH_MAX && path.is_absolute() && !s.starts_with(r"\\?\");
  let full: OsString = if !long {
    os.to_os_string()
  } else if let Some(unc) = s.strip_prefix(r"\\") {
    format!(r"\\?\UNC\{}", unc.replace('/', "\\")).into()
  } else {
    format!(r"\\?\{}", s.replace('/', "\\")).into()
  };
  full.encode_wide().chain(Some(0)).collect()
}

/// Renames `from` to `to` on the same volume, failing (`AlreadyExists`, from ERROR_ALREADY_EXISTS or
/// ERROR_FILE_EXISTS) when `to` exists at that moment. A case-only change of a file's own name is
/// allowed: it is the same file.
pub(super) fn move_no_replace(from: &Path, to: &Path) -> io::Result<()> {
  let (a, b) = (wide(from), wide(to));
  // SAFETY: both are NUL-terminated UTF-16 strings that outlive the call, which only reads them.
  // Flags 0: no MOVEFILE_REPLACE_EXISTING, no MOVEFILE_COPY_ALLOWED (a same-volume rename only).
  let ok = unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) };
  if ok == 0 {
    return Err(io::Error::last_os_error());
  }
  Ok(())
}

/// Sets or clears the hidden bit of `path`, leaving its other attribute bits as they are.
pub(super) fn set_hidden(path: &Path, hidden: bool) -> io::Result<()> {
  let attrs = std::fs::metadata(path)?.file_attributes();
  let wanted = if hidden { attrs | HIDDEN } else { attrs & !HIDDEN };
  if wanted == attrs {
    return Ok(());
  }
  // FILE_ATTRIBUTE_NORMAL is only valid on its own.
  let wanted = if wanted == 0 { NORMAL } else { wanted };
  let wide = wide(path);
  // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call; the function only
  // reads it.
  let ok = unsafe { SetFileAttributesW(wide.as_ptr(), wanted) };
  if ok == 0 {
    return Err(io::Error::last_os_error());
  }
  Ok(())
}

/// True when `path` exists and carries the hidden bit.
pub(super) fn is_hidden(path: &Path) -> bool {
  std::fs::metadata(path)
    .map(|m| m.file_attributes() & HIDDEN != 0)
    .unwrap_or(false)
}
