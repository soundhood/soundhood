use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.mgmat.soundhood.ytdl";

pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<Ytdl<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "YtdlPlugin")?;
  #[cfg(target_os = "ios")]
  let handle: PluginHandle<R> = unimplemented!("Soundhood has no iOS downloader");
  Ok(Ytdl(handle))
}

/// Access to the on-device yt-dlp.
pub struct Ytdl<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Ytdl<R> {
  pub fn handle(&self) -> PluginHandle<R> {
    self.0.clone()
  }
  pub fn download(&self, args: DownloadArgs) -> crate::Result<DownloadResult> {
    self.0.run_mobile_plugin("download", args).map_err(Into::into)
  }
  pub fn cancel(&self, args: CancelArgs) -> crate::Result<()> {
    self.0.run_mobile_plugin("cancel", args).map_err(Into::into)
  }
  pub fn version(&self) -> crate::Result<VersionResult> {
    self.0.run_mobile_plugin("ytdlpVersion", ()).map_err(Into::into)
  }
  pub fn update(&self) -> crate::Result<UpdateResult> {
    self.0.run_mobile_plugin("ytdlpUpdate", ()).map_err(Into::into)
  }
}
