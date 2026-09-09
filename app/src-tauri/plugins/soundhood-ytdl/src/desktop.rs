use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<Ytdl<R>> {
  Ok(Ytdl(std::marker::PhantomData))
}

/// Desktop has its own yt-dlp sidecar; this plugin is a no-op there.
pub struct Ytdl<R: Runtime>(std::marker::PhantomData<R>);

impl<R: Runtime> Ytdl<R> {
  pub fn download(&self, _args: DownloadArgs) -> crate::Result<DownloadResult> {
    Err(crate::Error::Message("On the desktop, downloads use the bundled yt-dlp sidecar".into()))
  }
  pub fn cancel(&self, _args: CancelArgs) -> crate::Result<()> {
    Ok(())
  }
  pub fn version(&self) -> crate::Result<VersionResult> {
    Err(crate::Error::Message("not on desktop".into()))
  }
  pub fn update(&self) -> crate::Result<UpdateResult> {
    Err(crate::Error::Message("not on desktop".into()))
  }
}
