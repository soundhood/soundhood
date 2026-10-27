use tauri::{command, AppHandle, Runtime};

use crate::{models::*, Result, YtdlExt};

/// Refuses what must never reach yt-dlp: anything but an http(s) link (an option such as
/// `--exec`, a local file, another scheme), and an output folder with a `..` segment (the UI
/// builds it from a validated folder name; a `..` would land files outside the library).
fn check_download(args: &DownloadArgs) -> Result<()> {
  let scheme = args.url.get(..8).unwrap_or(&args.url).to_ascii_lowercase();
  if !(scheme.starts_with("http://") || scheme.starts_with("https://")) {
    return Err(crate::Error::Message(format!("Not a web link: {}", args.url)));
  }
  if args.out_dir.split(['/', '\\']).any(|seg| seg == "..") {
    return Err(crate::Error::Message(format!("Refusing a download folder with '..': {}", args.out_dir)));
  }
  Ok(())
}

/// Long-running: the Kotlin side blocks until yt-dlp exits, so keep it off the async workers.
#[command]
pub(crate) async fn download<R: Runtime>(app: AppHandle<R>, args: DownloadArgs) -> Result<DownloadResult> {
  check_download(&args)?;
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
pub(crate) async fn cancel<R: Runtime>(app: AppHandle<R>, args: CancelArgs) -> Result<CancelResult> {
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

macro_rules! mobile_passthrough {
  ($name:ident, $method:literal, $args:ty, $ret:ty) => {
    #[command]
    pub(crate) async fn $name<R: Runtime>(app: AppHandle<R>, args: $args) -> Result<$ret> {
      #[cfg(mobile)]
      {
        let handle = app.ytdl().handle();
        tauri::async_runtime::spawn_blocking(move || {
          handle.run_mobile_plugin::<$ret>($method, args).map_err(crate::Error::from)
        })
        .await
        .map_err(|e| crate::Error::Message(e.to_string()))?
      }
      #[cfg(desktop)]
      {
        let _ = (app, args);
        Err(crate::Error::Message("not on desktop".into()))
      }
    }
  };
}

mobile_passthrough!(proton_login, "protonLogin", ProtonLoginArgs, ProtonLoginResult);
mobile_passthrough!(proton_sync, "protonSync", ProtonSyncArgs, ProtonSyncResult);

#[command]
pub(crate) async fn proton_status<R: Runtime>(app: AppHandle<R>) -> Result<ProtonStatus> {
  #[cfg(mobile)]
  {
    let handle = app.ytdl().handle();
    tauri::async_runtime::spawn_blocking(move || handle.run_mobile_plugin::<ProtonStatus>("protonStatus", ()).map_err(crate::Error::from))
      .await
      .map_err(|e| crate::Error::Message(e.to_string()))?
  }
  #[cfg(desktop)]
  {
    let _ = app;
    Ok(ProtonStatus { bundled: false, connected: false, username: String::new() })
  }
}

#[command]
pub(crate) async fn proton_logout<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  #[cfg(mobile)]
  {
    let handle = app.ytdl().handle();
    tauri::async_runtime::spawn_blocking(move || handle.run_mobile_plugin::<serde_json::Value>("protonLogout", ()).map(|_| ()).map_err(crate::Error::from))
      .await
      .map_err(|e| crate::Error::Message(e.to_string()))?
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
    assert!(check_download(&args("https://www.youtube.com/watch?v=x", "/storage/emulated/0/Music/Chill")).is_ok());
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
}
