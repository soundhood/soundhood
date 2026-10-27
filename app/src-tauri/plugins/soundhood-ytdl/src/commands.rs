use tauri::{command, AppHandle, Runtime};

use crate::rules::{is_channel_link, is_fixture_library, CHANNEL_REFUSED, SYNC_OFF_FOR_FIXTURE};
#[cfg(desktop)]
use crate::YtdlExt;
use crate::{models::*, Result};

/// Refuses what must never reach yt-dlp: anything but an http(s) link (an option such as
/// `--exec`, a local file, another scheme), a whole channel (a playlist link is the ceiling), and
/// an output folder with a `..` segment (the UI builds it from a validated folder name; a `..`
/// would land files outside the library).
fn check_download(args: &DownloadArgs) -> Result<()> {
  let scheme = args.url.get(..8).unwrap_or(&args.url).to_ascii_lowercase();
  if !(scheme.starts_with("http://") || scheme.starts_with("https://")) {
    return Err(crate::Error::Message(format!("Not a web link: {}", args.url)));
  }
  if is_channel_link(&args.url) {
    return Err(crate::Error::Message(CHANNEL_REFUSED.into()));
  }
  if args.out_dir.split(['/', '\\']).any(|seg| seg == "..") {
    return Err(crate::Error::Message(format!(
      "Refusing a download folder with '..': {}",
      args.out_dir
    )));
  }
  Ok(())
}

/// Refuses to sync the generated fixture library with the real Proton Drive library.
fn check_sync(args: &ProtonSyncArgs) -> Result<()> {
  if is_fixture_library(std::path::Path::new(&args.library_dir)) {
    return Err(crate::Error::Message(SYNC_OFF_FOR_FIXTURE.into()));
  }
  Ok(())
}

/// Calls the Kotlin method on a blocking worker. Kotlin may block (yt-dlp running, Python being
/// unpacked on first use), and a plugin call made directly inside an async command would hold a
/// runtime worker for that long.
#[cfg(mobile)]
async fn run_kotlin<R, A, T>(app: &AppHandle<R>, method: &'static str, args: A) -> Result<T>
where
  R: Runtime,
  A: serde::Serialize + Send + 'static,
  T: serde::de::DeserializeOwned + Send + 'static,
{
  use crate::YtdlExt;
  let handle = app.ytdl().handle();
  tauri::async_runtime::spawn_blocking(move || handle.run_mobile_plugin::<T>(method, args).map_err(crate::Error::from))
    .await
    .map_err(|e| crate::Error::Message(e.to_string()))?
}

/// Long-running: the Kotlin side blocks until yt-dlp exits.
#[command]
pub(crate) async fn download<R: Runtime>(app: AppHandle<R>, args: DownloadArgs) -> Result<DownloadResult> {
  check_download(&args)?;
  #[cfg(mobile)]
  {
    run_kotlin(&app, "download", args).await
  }
  #[cfg(desktop)]
  {
    app.ytdl().download(args)
  }
}

#[command]
pub(crate) async fn cancel<R: Runtime>(app: AppHandle<R>, args: CancelArgs) -> Result<CancelResult> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "cancel", args).await
  }
  #[cfg(desktop)]
  {
    app.ytdl().cancel(args)
  }
}

/// The first call after launch waits for Kotlin to unpack Python, which takes seconds.
#[command]
pub(crate) async fn ytdlp_version<R: Runtime>(app: AppHandle<R>) -> Result<VersionResult> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "ytdlpVersion", ()).await
  }
  #[cfg(desktop)]
  {
    app.ytdl().version()
  }
}

#[command]
pub(crate) async fn ytdlp_update<R: Runtime>(app: AppHandle<R>) -> Result<UpdateResult> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "ytdlpUpdate", ()).await
  }
  #[cfg(desktop)]
  {
    app.ytdl().update()
  }
}

/// Diagnostic: run a tiny python script through the bundled interpreter (DNS / TCP / HTTPS to YouTube).
#[command]
pub(crate) async fn netcheck<R: Runtime>(app: AppHandle<R>) -> Result<NetcheckResult> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "netcheck", ()).await
  }
  #[cfg(desktop)]
  {
    let _ = app;
    Err(crate::Error::Message("not on desktop".into()))
  }
}

#[command]
pub(crate) async fn proton_login<R: Runtime>(app: AppHandle<R>, args: ProtonLoginArgs) -> Result<ProtonLoginResult> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "protonLogin", args).await
  }
  #[cfg(desktop)]
  {
    let _ = (app, args);
    Err(crate::Error::Message("not on desktop".into()))
  }
}

#[command]
pub(crate) async fn proton_sync<R: Runtime>(app: AppHandle<R>, args: ProtonSyncArgs) -> Result<ProtonSyncResult> {
  check_sync(&args)?;
  #[cfg(mobile)]
  {
    run_kotlin(&app, "protonSync", args).await
  }
  #[cfg(desktop)]
  {
    let _ = (app, args);
    Err(crate::Error::Message("not on desktop".into()))
  }
}

#[command]
pub(crate) async fn proton_status<R: Runtime>(app: AppHandle<R>) -> Result<ProtonStatus> {
  #[cfg(mobile)]
  {
    run_kotlin(&app, "protonStatus", ()).await
  }
  #[cfg(desktop)]
  {
    let _ = app;
    Ok(ProtonStatus {
      bundled: false,
      connected: false,
      username: String::new(),
    })
  }
}

#[command]
pub(crate) async fn proton_logout<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  #[cfg(mobile)]
  {
    run_kotlin::<R, (), serde_json::Value>(&app, "protonLogout", ())
      .await
      .map(|_| ())
  }
  #[cfg(desktop)]
  {
    let _ = app;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(url: &str, out_dir: &str) -> DownloadArgs {
    DownloadArgs {
      url: url.into(),
      out_dir: out_dir.into(),
      playlist: false,
      id: "dl".into(),
    }
  }

  #[test]
  fn only_web_links_into_a_plain_folder_pass() {
    assert!(check_download(&args(
      "https://www.youtube.com/watch?v=x",
      "/storage/emulated/0/Music/Chill"
    ))
    .is_ok());
    assert!(check_download(&args("HTTP://example.com/a", "/storage/emulated/0/Music/Chill")).is_ok());
    for url in ["--exec=x", "file:///sdcard/x", "ftp://x", "", " https://x"] {
      assert!(check_download(&args(url, "/m/Chill")).is_err(), "{url:?}");
    }
    for dir in ["/m/../etc", "/m/Chill/..", "..\\x", "/m/Chill/../../y"] {
      assert!(check_download(&args("https://x.y/z", dir)).is_err(), "{dir:?}");
    }
    // ".." inside a name is not a parent-folder segment.
    assert!(check_download(&args("https://x.y/z", "/m/Live..2024")).is_ok());
  }

  #[test]
  fn a_channel_link_is_refused_in_plain_words() {
    let err = check_download(&args("https://www.youtube.com/@artist/videos", "/m/Chill")).unwrap_err();
    assert_eq!(err.to_string(), CHANNEL_REFUSED);
    assert!(check_download(&args("https://www.youtube.com/playlist?list=PL1", "/m/Chill")).is_ok());
  }

  #[test]
  fn the_fixture_library_is_never_synced() {
    let tmp = std::env::temp_dir().join(format!("soundhood-ytdl-sync-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let sync = ProtonSyncArgs {
      library_dir: tmp.to_string_lossy().into_owned(),
      remote_dir: "Music".into(),
      direction: "up".into(),
    };
    assert!(check_sync(&sync).is_ok());
    std::fs::write(tmp.join(crate::FIXTURE_MARKER), b"").unwrap();
    assert_eq!(check_sync(&sync).unwrap_err().to_string(), SYNC_OFF_FOR_FIXTURE);
    std::fs::remove_dir_all(&tmp).unwrap();
  }
}
