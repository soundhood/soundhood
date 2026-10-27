//! The desktop yt-dlp download: argv from `soundhood_core::ytdlp::args`, the sidecar spawned by the
//! host, output streamed to the UI as `ytdlp:stdout|stderr|files|done`. The phone downloads through
//! the soundhood-ytdl plugin instead.

use serde::Deserialize;
use tauri::AppHandle;

// The phone's stub only accepts the shape; the plugin does the work there.
#[cfg_attr(mobile, allow(dead_code))]
#[derive(Debug, Clone, Deserialize)]
pub struct YtDlpArgs {
  url: String,
  #[serde(alias = "libraryDir")]
  library_dir: Option<String>,
  /// First-level folder under the library root (= a playlist) the file lands in.
  #[serde(default, alias = "targetFolder")]
  target_folder: Option<String>,
  /// A playlist link downloads every entry (the UI sets this for pure playlist URLs).
  #[serde(default)]
  playlist: bool,
}

/// The phone's download is the soundhood-ytdl plugin's `download`; this command is desktop-only.
#[cfg(mobile)]
#[tauri::command]
pub async fn ytdlp_download_audio(_app: AppHandle, _args: YtDlpArgs) -> Result<(), String> {
  Err("Downloading is not available on the phone yet — it lands with the on-device downloader.".into())
}

/// Starts one download and returns once yt-dlp is running; progress, the files it wrote and the exit
/// code arrive as events.
#[cfg(desktop)]
#[tauri::command]
pub async fn ytdlp_download_audio(app: AppHandle, args: YtDlpArgs) -> Result<(), String> {
  desktop::start(app, args)
}

/// A target folder is a single folder NAME under the library root — never a path.
#[cfg_attr(mobile, allow(dead_code))]
fn sanitize_folder_name(raw: &str) -> Result<String, String> {
  let name = raw.trim().trim_matches('.').trim();
  if name.is_empty() {
    return Err("Download folder name is empty".into());
  }
  if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    return Err(format!(
      "Download folder name contains a character Windows rejects: {name}"
    ));
  }
  Ok(name.to_string())
}

#[cfg(desktop)]
mod desktop {
  use super::{sanitize_folder_name, YtDlpArgs};
  use crate::paths::tilde;
  use crate::sidecar;
  use crate::state::home_dir;
  use soundhood_core::ytdlp::args::{build, is_web_link, DownloadArgs};
  use std::path::{Path, PathBuf};
  use tauri::{AppHandle, Emitter, Manager};
  use tauri_plugin_shell::process::CommandEvent;
  use tauri_plugin_shell::ShellExt;

  pub fn start(app: AppHandle, args: YtDlpArgs) -> Result<(), String> {
    // The library root is REQUIRED. No silent fallback to the OS Music folder —
    // that is how downloads used to vanish into a folder the app never scans.
    let base_dir: PathBuf = match args.library_dir.as_deref().map(str::trim) {
      Some(ld) if !ld.is_empty() => PathBuf::from(ld),
      _ => return Err("No Music folder selected — click Import first.".into()),
    };
    if !base_dir.is_dir() {
      return Err(format!("Music folder does not exist: {}", base_dir.display()));
    }
    // `build` refuses it too; checking first means a bad link creates no folder.
    let url = args.url.trim().to_string();
    if !is_web_link(&url) {
      return Err(format!("Not a web link: {url}"));
    }

    let target = sanitize_folder_name(args.target_folder.as_deref().unwrap_or("Downloads"))?;
    let out_dir = base_dir.join(&target);
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create folder {}: {e}", out_dir.display()))?;

    let home = home_dir(&app);
    let sidecars = sidecar::resolve(app.path().app_data_dir().ok().as_deref(), home.as_deref())?;

    // YouTube's "Sign in to confirm you're not a bot" wall: if the user has exported their browser
    // cookies to <app config dir>/cookies.txt (Netscape format), hand them to yt-dlp. Never synced,
    // never inside the library. Migration rule 5.10: an existing install's file keeps being used.
    let cookies = app
      .path()
      .app_config_dir()
      .ok()
      .map(|d| d.join("cookies.txt"))
      .filter(|f| f.is_file());
    if cookies.is_some() {
      // Never the absolute path: it carries the account name.
      let _ = app.emit("ytdlp:stdout", "[soundhood] using cookies: <app config>/cookies.txt");
    }

    let argv = build(&DownloadArgs {
      url,
      playlist: args.playlist,
      deno: sidecars.deno.path.clone(),
      ffmpeg: sidecars.ffmpeg.as_ref().map(|f| f.path.clone()),
      cookies,
      out_dir: out_dir.clone(),
    })
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
      "ytdlp:stdout",
      format!("[soundhood] saving into: {}", tilde(&out_dir, home.as_deref())),
    );

    let cmd = app
      .shell()
      .command(&sidecars.ytdlp.path)
      .args(argv)
      .current_dir(out_dir.clone());

    let started = std::time::SystemTime::now();
    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {e}"))?;

    tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Stdout(line) => {
            let _ = app.emit("ytdlp:stdout", String::from_utf8_lossy(&line).to_string());
          }
          CommandEvent::Stderr(line) => {
            let _ = app.emit("ytdlp:stderr", String::from_utf8_lossy(&line).to_string());
          }
          CommandEvent::Terminated(payload) => {
            let code = payload.code.unwrap_or(1);
            // Tell the UI which files this download produced: the audio files in the target folder
            // written since we started (no log parsing). Always before `ytdlp:done`.
            if code == 0 {
              let files: Vec<String> = audio_files_since(&out_dir, started)
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
              let _ = app.emit("ytdlp:files", files);
            }
            let _ = app.emit("ytdlp:done", code);
          }
          _ => {}
        }
      }
    });

    Ok(())
  }

  /// Every audio file in `dir` written since `since` (a playlist link yields several), oldest first.
  fn audio_files_since(dir: &Path, since: std::time::SystemTime) -> Vec<PathBuf> {
    // A little slack for file-time granularity.
    let floor = since.checked_sub(std::time::Duration::from_secs(5)).unwrap_or(since);
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
      return Vec::new();
    };
    for e in rd.flatten() {
      let p = e.path();
      let is_audio = p
        .file_name()
        .map(|n| soundhood_core::fs::is_audio_file(&n.to_string_lossy()))
        .unwrap_or(false);
      if !p.is_file() || !is_audio {
        continue;
      }
      let Ok(m) = e.metadata().and_then(|m| m.modified()) else {
        continue;
      };
      if m < floor {
        continue;
      }
      found.push((m, p));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found.into_iter().map(|(_, p)| p).collect()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn folder_name_is_one_segment() {
    assert_eq!(sanitize_folder_name("  Chill. "), Ok("Chill".to_string()));
    assert!(sanitize_folder_name("..").is_err());
    assert!(sanitize_folder_name("a/b").is_err());
    assert!(sanitize_folder_name("..\\x").is_err());
  }
}
