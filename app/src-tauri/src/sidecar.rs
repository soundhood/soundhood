//! Which yt-dlp, deno and ffmpeg executables the desktop download runs (desktop only).
//!
//! Order, per tool: a verified copy in `<app data>/sidecars/` (the sidecar manager renames a file
//! into that folder only after its checksum verified), then the bundled copy: next to the app's
//! executable in a release build (Tauri strips the target triple), `src-tauri/bin` in a debug build
//! (the `<tool>-<target triple>` files `externalBin` names, or the copy tauri-build put next to the
//! debug executable).
//!
//! Migration rule (build brief 5.10), Phase 0: nothing changes for an existing install. Until the
//! sidecar manager has fetched and verified its own copies, the yt-dlp and deno bundled with the
//! installed app keep being used exactly as before, and `<app config>/cookies.txt` keeps being
//! passed when it exists (see `download.rs`).

use crate::paths::tilde;
use soundhood_core::sidecars::host_triple;
use std::path::{Path, PathBuf};

/// Folder under the app data dir that holds the sidecar manager's verified copies.
pub const MANAGED_DIR: &str = "sidecars";

/// Where a resolved executable came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
  /// Fetched and checksum-verified by the sidecar manager.
  Verified,
  /// Shipped with (or, in a debug build, vendored for) this build.
  Bundled,
}

/// One executable the download will run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
  pub path: PathBuf,
  pub origin: Origin,
}

/// The executables for one download.
#[derive(Clone, Debug)]
pub struct Sidecars {
  pub ytdlp: Resolved,
  pub deno: Resolved,
  /// `None`: yt-dlp finds ffmpeg on PATH, as before.
  pub ffmpeg: Option<Resolved>,
}

/// File names `stem` may carry: plain (`yt-dlp.exe`, as installed) and with the target triple
/// (`yt-dlp-x86_64-pc-windows-msvc.exe`, as `externalBin` and `soundhood-tools fetch-sidecars`
/// name them).
fn names(stem: &str) -> Vec<String> {
  let ext = std::env::consts::EXE_SUFFIX;
  let mut out = vec![format!("{stem}{ext}")];
  if let Some(triple) = host_triple() {
    out.push(format!("{stem}-{triple}{ext}"));
  }
  out
}

/// The first non-empty regular file named like `stem` in `dirs`, in order. Empty files are CI
/// build-health placeholders, never a real executable.
fn find(dirs: &[(PathBuf, Origin)], stem: &str) -> Option<Resolved> {
  let names = names(stem);
  for (dir, origin) in dirs {
    for name in &names {
      let path = dir.join(name);
      let usable = std::fs::metadata(&path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false);
      if usable {
        return Some(Resolved { path, origin: *origin });
      }
    }
  }
  None
}

/// The folders searched, in order. `app_data_dir` is `None` only when Tauri cannot name it.
pub fn search_dirs(app_data_dir: Option<&Path>) -> Result<Vec<(PathBuf, Origin)>, String> {
  let mut dirs = Vec::new();
  if let Some(data) = app_data_dir {
    dirs.push((data.join(MANAGED_DIR), Origin::Verified));
  }
  if cfg!(debug_assertions) {
    // Dev: the vendored binaries live in src-tauri/bin (with target-triple names).
    dirs.push((PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"), Origin::Bundled));
  }
  // Release / installed app: Tauri places sidecars NEXT TO the executable, triple stripped.
  let exe = std::env::current_exe().map_err(|e| format!("Cannot locate the app executable: {e}"))?;
  let exe_dir = exe
    .parent()
    .ok_or_else(|| "App executable has no parent folder".to_string())?;
  dirs.push((exe_dir.to_path_buf(), Origin::Bundled));
  Ok(dirs)
}

/// Resolves yt-dlp and deno (both required) and ffmpeg (optional). `home` only shortens the
/// folders named in the error to `~`.
pub fn resolve(app_data_dir: Option<&Path>, home: Option<&Path>) -> Result<Sidecars, String> {
  let dirs = search_dirs(app_data_dir)?;
  resolve_in(&dirs, home)
}

fn resolve_in(dirs: &[(PathBuf, Origin)], home: Option<&Path>) -> Result<Sidecars, String> {
  let missing = |tool: &str| {
    let looked: Vec<String> = dirs.iter().map(|(d, _)| tilde(d, home)).collect();
    format!("Could not find {tool} in: {}", looked.join(", "))
  };
  Ok(Sidecars {
    ytdlp: find(dirs, "yt-dlp").ok_or_else(|| missing("yt-dlp"))?,
    deno: find(dirs, "deno").ok_or_else(|| missing("deno"))?,
    ffmpeg: find(dirs, "ffmpeg"),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn touch(dir: &Path, name: &str, bytes: &[u8]) {
    std::fs::create_dir_all(dir).expect("create test dir");
    std::fs::write(dir.join(name), bytes).expect("write test file");
  }

  fn exe(stem: &str) -> String {
    format!("{stem}{}", std::env::consts::EXE_SUFFIX)
  }

  #[test]
  fn verified_copy_wins_over_the_bundled_one() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let managed = tmp.path().join("data").join(MANAGED_DIR);
    let bundled = tmp.path().join("exe");
    touch(&managed, &exe("yt-dlp"), b"new");
    touch(&bundled, &exe("yt-dlp"), b"old");
    touch(&bundled, &exe("deno"), b"old");
    let dirs = vec![(managed.clone(), Origin::Verified), (bundled.clone(), Origin::Bundled)];
    let s = resolve_in(&dirs, None).expect("resolves");
    assert_eq!(
      s.ytdlp,
      Resolved {
        path: managed.join(exe("yt-dlp")),
        origin: Origin::Verified
      }
    );
    assert_eq!(
      s.deno,
      Resolved {
        path: bundled.join(exe("deno")),
        origin: Origin::Bundled
      }
    );
    assert!(s.ffmpeg.is_none());
  }

  #[test]
  fn triple_named_dev_files_and_empty_placeholders() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let bin = tmp.path().join("bin");
    let Some(triple) = host_triple() else { return };
    let ext = std::env::consts::EXE_SUFFIX;
    touch(&bin, &format!("yt-dlp-{triple}{ext}"), b"x");
    // A CI placeholder is never run.
    touch(&bin, &format!("deno-{triple}{ext}"), b"");
    let dirs = vec![(bin.clone(), Origin::Bundled)];
    let err = resolve_in(&dirs, Some(tmp.path())).expect_err("deno is only a placeholder");
    // The folders it names are home-relative, never the user-profile path itself.
    let sep = std::path::MAIN_SEPARATOR;
    assert_eq!(err, format!("Could not find deno in: ~{sep}bin"));
    touch(&bin, &format!("deno-{triple}{ext}"), b"x");
    let s = resolve_in(&dirs, None).expect("resolves");
    assert_eq!(s.ytdlp.path, bin.join(format!("yt-dlp-{triple}{ext}")));
  }
}
