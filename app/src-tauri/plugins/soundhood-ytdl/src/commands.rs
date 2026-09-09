use tauri::{command, AppHandle, Runtime};

use crate::{models::*, Result, YtdlExt};

/// Long-running: the Kotlin side blocks until yt-dlp exits, so keep it off the async workers.
#[command]
pub(crate) async fn download<R: Runtime>(app: AppHandle<R>, args: DownloadArgs) -> Result<DownloadResult> {
  #[cfg(mobile)]
  {
    let handle = app.ytdl().handle();
    tauri::async_runtime::spawn_blocking(move || {
      handle
        .run_mobile_plugin::<DownloadResult>("download", args)
        .map_err(crate::Error::from)
    })
    .await
    .map_err(|e| crate::Error::Message(e.to_string()))?
  }
  #[cfg(desktop)]
  {
    app.ytdl().download(args)
  }
}

#[command]
pub(crate) async fn cancel<R: Runtime>(app: AppHandle<R>, args: CancelArgs) -> Result<()> {
  app.ytdl().cancel(args)
}

#[command]
pub(crate) async fn ytdlp_version<R: Runtime>(app: AppHandle<R>) -> Result<VersionResult> {
  app.ytdl().version()
}

#[command]
pub(crate) async fn ytdlp_update<R: Runtime>(app: AppHandle<R>) -> Result<UpdateResult> {
  #[cfg(mobile)]
  {
    let handle = app.ytdl().handle();
    tauri::async_runtime::spawn_blocking(move || {
      handle
        .run_mobile_plugin::<UpdateResult>("ytdlpUpdate", ())
        .map_err(crate::Error::from)
    })
    .await
    .map_err(|e| crate::Error::Message(e.to_string()))?
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
    let handle = app.ytdl().handle();
    tauri::async_runtime::spawn_blocking(move || {
      handle
        .run_mobile_plugin::<NetcheckResult>("netcheck", ())
        .map_err(crate::Error::from)
    })
    .await
    .map_err(|e| crate::Error::Message(e.to_string()))?
  }
  #[cfg(desktop)]
  {
    let _ = app;
    Err(crate::Error::Message("not on desktop".into()))
  }
}
