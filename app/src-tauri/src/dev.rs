//! Developer and support commands: the fixture-library switch, "Run self-test" and diagnostics.
//! Nothing here writes into a user's library.

use crate::paths::tilde;
use crate::state::{app_cache_dir, app_data_dir, home_dir, reason, Cores};
use serde::Serialize;
use soundhood_core::api::{Core, SelfTestReport};
use soundhood_core::fixtures::{generate, FixtureSpec, MARKER};
use soundhood_core::Platform;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Folder under the app data dir that holds the generated fixture library.
const FIXTURE_DIR: &str = "fixture-library";

/// The answer of `dev_fixture_root`.
#[derive(Serialize, Clone, Debug)]
pub struct FixtureRoot {
  /// Absolute path of the fixture library, or "" when the switch is off.
  pub root: String,
}

/// "Use fixture root": generates the fixture library under `<app data>/fixture-library` when it is
/// not there yet and returns its path; `enable: false` returns "". The UI switches its library root
/// to the answer, so screenshots and device tests never show a real library.
#[tauri::command]
pub async fn dev_fixture_root(app: AppHandle, enable: bool) -> Result<FixtureRoot, String> {
  if !enable {
    return Ok(FixtureRoot { root: String::new() });
  }
  let dest = app_data_dir(&app)?.join(FIXTURE_DIR);
  tauri::async_runtime::spawn_blocking(move || {
    // The marker is written first by `generate`, so a folder with it is a fixture library, even
    // when the app has since added its own `_Soundhood/` bookkeeping to it.
    if !dest.join(MARKER).is_file() {
      generate(&dest, &FixtureSpec::default()).map_err(reason)?;
    }
    Ok(FixtureRoot {
      root: dest.to_string_lossy().into_owned(),
    })
  })
  .await
  .map_err(|e| format!("internal error: {e}"))?
}

/// "Run self-test": the bundled fixture checks, run in a scratch folder under the app cache dir.
#[tauri::command]
pub async fn self_test(app: AppHandle) -> Result<SelfTestReport, String> {
  let scratch = app_cache_dir(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    std::fs::create_dir_all(&scratch).map_err(|e| format!("Cannot create the cache folder: {e}"))?;
    Ok(Core::self_test(&scratch))
  })
  .await
  .map_err(|e| format!("internal error: {e}"))?
}

/// The answer of `diagnostics`. Every path has the user's home folder replaced by `~`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
  pub app_version: String,
  /// "desktop" | "android".
  pub platform: Platform,
  /// Operating system and CPU, e.g. "windows x86_64".
  pub os: String,
  pub device_id: String,
  /// This device's index for `libraryDir`, or "" when no library was named.
  pub index_path: String,
  /// Orphaned temp files the core removed when it opened `libraryDir` in this session.
  pub orphans_removed: Vec<String>,
  /// The yt-dlp / deno / ffmpeg a download would run, and where each came from.
  pub sidecars: String,
}

/// What support needs to know about this install, safe to paste anywhere: no account name, no
/// absolute user-profile path.
#[tauri::command]
pub async fn diagnostics(app: AppHandle, library_dir: Option<String>) -> Result<Diagnostics, String> {
  let data_dir = app_data_dir(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    let home = home_dir(&app);
    let device_id = soundhood_core::fs::device_id(&data_dir).map_err(reason)?.0;
    let library_dir = library_dir.filter(|d| !d.trim().is_empty());
    let (index_path, orphans_removed) = match &library_dir {
      Some(dir) => {
        let core = app.state::<Cores>().get(&app, dir)?;
        let orphans = app
          .state::<Cores>()
          .open_report(dir)
          .map(|r| r.orphans_removed)
          .unwrap_or_default();
        let orphans = orphans
          .iter()
          .map(|o| tilde(&PathBuf::from(o), home.as_deref()))
          .collect();
        (tilde(&core.index_path(), home.as_deref()), orphans)
      }
      None => (String::new(), Vec::new()),
    };
    Ok(Diagnostics {
      app_version: app.package_info().version.to_string(),
      platform: Platform::current(),
      os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
      device_id,
      index_path,
      orphans_removed,
      sidecars: sidecars_in_use(&data_dir, home.as_deref()),
    })
  })
  .await
  .map_err(|e| format!("internal error: {e}"))?
}

#[cfg(desktop)]
fn sidecars_in_use(data_dir: &std::path::Path, home: Option<&std::path::Path>) -> String {
  use crate::sidecar::{resolve, Origin, Resolved};
  let describe = |name: &str, r: &Resolved| {
    let origin = match r.origin {
      Origin::Verified => "verified copy",
      Origin::Bundled => "bundled",
    };
    format!("{name}: {} ({origin})", tilde(&r.path, home))
  };
  match resolve(Some(data_dir), home) {
    Ok(s) => {
      let ffmpeg = match &s.ffmpeg {
        Some(f) => describe("ffmpeg", f),
        None => "ffmpeg: from PATH".to_string(),
      };
      [describe("yt-dlp", &s.ytdlp), describe("deno", &s.deno), ffmpeg].join("; ")
    }
    Err(e) => e,
  }
}

#[cfg(mobile)]
fn sidecars_in_use(_data_dir: &std::path::Path, _home: Option<&std::path::Path>) -> String {
  "none: the phone downloads through the soundhood-ytdl plugin (youtubedl-android)".to_string()
}
