//! Soundhood's on-device downloader: yt-dlp (python) + ffmpeg bundled by youtubedl-android,
//! driven from the Kotlin plugin class `YtdlPlugin`. Desktop keeps its sidecar; this is a no-op there.

use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
pub use desktop::Ytdl;
#[cfg(mobile)]
pub use mobile::Ytdl;

pub trait YtdlExt<R: Runtime> {
  fn ytdl(&self) -> &Ytdl<R>;
}

impl<R: Runtime, T: Manager<R>> crate::YtdlExt<R> for T {
  fn ytdl(&self) -> &Ytdl<R> {
    self.state::<Ytdl<R>>().inner()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("soundhood-ytdl")
    .invoke_handler(tauri::generate_handler![
      commands::download,
      commands::cancel,
      commands::ytdlp_version,
      commands::ytdlp_update,
      commands::netcheck
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let ytdl = mobile::init(app, api)?;
      #[cfg(desktop)]
      let ytdl = desktop::init(app, api)?;
      app.manage(ytdl);
      Ok(())
    })
    .build()
}
