//! The one Windows call std does not expose: changing a file's attribute bits. Temp files are
//! created hidden (so Explorer and the Proton client leave them alone); a rename carries the
//! attributes along, so the hidden bit must come off before a temp becomes a user file.

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
  let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
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
