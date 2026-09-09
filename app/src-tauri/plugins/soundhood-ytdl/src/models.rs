use serde::{Deserialize, Serialize};

/// What the UI asks for: one link, the folder the file(s) land in, whether a playlist link
/// should download all of its entries, and an id the UI can use to cancel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArgs {
  pub url: String,
  pub out_dir: String,
  #[serde(default)]
  pub playlist: bool,
  #[serde(default = "default_id")]
  pub id: String,
}

fn default_id() -> String {
  "dl".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
  pub exit_code: i32,
  /// Audio files written into `out_dir` by this download, oldest first.
  pub files: Vec<String>,
  /// Tail of yt-dlp's output.
  pub log: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelArgs {
  pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionResult {
  pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
  pub status: String,
  pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcheckResult {
  pub output: String,
}
