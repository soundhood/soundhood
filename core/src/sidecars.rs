//! Desktop sidecar manager: fetch + verify yt-dlp and deno from upstream releases.
//! Zone: tools. Contract: core/CONTRACT.md. Verification model: build brief 1.5 and `ytdlp::pins`.
//!
//! A fetch downloads the release's published checksum file first, then the asset, hashing it while
//! it streams to a hidden temp file next to the destination. Nothing is installed unless the hash
//! matches the published checksum (and the pin, where one exists) and the yt-dlp release is not
//! below `MIN_YTDLP_VERSION`. Deno arrives zipped and is extracted from the verified zip. The
//! installed file appears only through a rename, so a failed fetch never leaves a half-written
//! sidecar in place of a working one.

use crate::error::{Error, Result};
use crate::ytdlp::pins;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Where releases are fetched from unless a test or mirror overrides it.
pub const RELEASES_BASE: &str = "https://github.com";

/// Which sidecar an asset belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Tool {
  YtDlp,
  Deno,
}

/// One release asset to fetch and the file name it is installed under.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
  pub tool: Tool,
  /// Release version: "2026.10.26" (yt-dlp tag) or "2.9.8" (deno tag without the "v").
  pub version: String,
  /// Release asset file name, e.g. `yt-dlp.exe` or `deno-x86_64-pc-windows-msvc.zip`.
  pub name: String,
  /// File name written into the destination folder (the extracted binary for deno).
  pub install_name: String,
  /// Lower-case hex SHA-256 the asset must also match, for pinned releases.
  pub pinned_sha256: Option<String>,
}

impl Asset {
  /// The pinned bootstrap yt-dlp for `triple`, installed as `yt-dlp[.exe]`.
  pub fn ytdlp_bootstrap(triple: &str) -> Result<Asset> {
    Asset::ytdlp_release(pins::YTDLP_BOOTSTRAP_VERSION, triple)
  }

  /// Any yt-dlp release for `triple` ("Update helper"); carries the pin when `version` is the
  /// bootstrap release.
  pub fn ytdlp_release(version: &str, triple: &str) -> Result<Asset> {
    let pin = pins::ytdlp_bootstrap(triple).ok_or_else(|| no_build("yt-dlp", triple))?;
    Ok(Asset {
      tool: Tool::YtDlp,
      version: version.to_string(),
      name: pin.name.to_string(),
      install_name: exe_name("yt-dlp", triple),
      pinned_sha256: (version == pins::YTDLP_BOOTSTRAP_VERSION).then(|| pin.sha256.to_string()),
    })
  }

  /// The pinned deno release for `triple`, installed as `deno[.exe]`.
  pub fn deno_pinned(triple: &str) -> Result<Asset> {
    let pin = pins::deno(triple).ok_or_else(|| no_build("deno", triple))?;
    Ok(Asset {
      tool: Tool::Deno,
      version: pins::DENO_VERSION.to_string(),
      name: pin.name.to_string(),
      install_name: exe_name("deno", triple),
      pinned_sha256: Some(pin.sha256.to_string()),
    })
  }

  /// Same asset, installed under another file name (e.g. Tauri's `yt-dlp-<triple>.exe`).
  pub fn installed_as(mut self, install_name: impl Into<String>) -> Asset {
    self.install_name = install_name.into();
    self
  }

  fn release_dir(&self, base: &str) -> String {
    let base = base.trim_end_matches('/');
    match self.tool {
      Tool::YtDlp => format!("{base}/yt-dlp/yt-dlp/releases/download/{}/", self.version),
      Tool::Deno => format!("{base}/denoland/deno/releases/download/v{}/", self.version),
    }
  }

  /// Download URL of the asset under `base`.
  pub fn asset_url(&self, base: &str) -> String {
    format!("{}{}", self.release_dir(base), self.name)
  }

  /// URL of the checksum file the release publishes for this asset.
  pub fn checksum_url(&self, base: &str) -> String {
    match self.tool {
      Tool::YtDlp => format!("{}SHA2-256SUMS", self.release_dir(base)),
      Tool::Deno => format!("{}{}.sha256sum", self.release_dir(base), self.name),
    }
  }
}

fn no_build(tool: &str, triple: &str) -> Error {
  Error::NotFound(format!("no {tool} build is published for {triple}"))
}

/// `stem` plus `.exe` for Windows triples (the names Tauri's `externalBin` expects).
pub fn exe_name(stem: &str, triple: &str) -> String {
  if triple.contains("-windows") {
    format!("{stem}.exe")
  } else {
    stem.to_string()
  }
}

/// The target triple this binary was built for, when it is a desktop triple with sidecars.
pub fn host_triple() -> Option<&'static str> {
  let triple = match (std::env::consts::ARCH, std::env::consts::OS) {
    ("x86_64", "windows") => "x86_64-pc-windows-msvc",
    ("aarch64", "windows") => "aarch64-pc-windows-msvc",
    ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
    ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
    ("x86_64", "macos") => "x86_64-apple-darwin",
    ("aarch64", "macos") => "aarch64-apple-darwin",
    _ => return None,
  };
  Some(triple)
}

/// The receipt of one verified install. `log` holds the lines a host shows behind "Copy log".
#[derive(Serialize, Clone, Debug)]
pub struct FetchReport {
  pub tool: Tool,
  pub version: String,
  pub asset: String,
  pub url: String,
  pub checksum_url: String,
  /// From the release's published checksum file.
  pub expected_sha256: String,
  /// Of the bytes actually downloaded.
  pub actual_sha256: String,
  pub pinned_sha256: Option<String>,
  /// The installed file.
  pub path: PathBuf,
  /// Size of the downloaded asset.
  pub bytes: u64,
  pub log: Vec<String>,
}

/// Fetches `asset` into `dest_dir/<install_name>` and verifies it; `http_base` overrides
/// `RELEASES_BASE` (tests, mirrors). Refuses (`Error::Refused`) a yt-dlp below the pinned minimum,
/// a missing or unusable checksum, any hash mismatch, and plain HTTP to anything but loopback.
pub fn fetch(asset: &Asset, dest_dir: &Path, http_base: Option<&str>) -> Result<FetchReport> {
  if asset.tool == Tool::YtDlp && !pins::ytdlp_version_allowed(&asset.version) {
    return Err(Error::Refused(format!(
      "yt-dlp {} is older than the minimum {}",
      asset.version,
      pins::MIN_YTDLP_VERSION
    )));
  }
  let base = http_base.unwrap_or(RELEASES_BASE);
  let agent = agent_for(base)?;
  let url = asset.asset_url(base);
  let checksum_url = asset.checksum_url(base);
  let mut log = vec![format!(
    "{} {}: {} from {url}",
    tool_name(asset.tool),
    asset.version,
    asset.name
  )];

  // The checksum first: no point downloading 40 MB that cannot be verified.
  let sums = get_text(&agent, &checksum_url)?;
  let expected = expected_sha256(&sums, &asset.name)
    .ok_or_else(|| Error::Refused(format!("{checksum_url} lists no SHA-256 for {}", asset.name)))?;
  log.push(format!("expected sha256 {expected} (published checksum)"));
  if let Some(pin) = &asset.pinned_sha256 {
    log.push(format!("pinned   sha256 {pin}"));
    if !pin.eq_ignore_ascii_case(&expected) {
      return Err(Error::Refused(format!(
        "published checksum for {} ({expected}) differs from the pinned {pin}",
        asset.name
      )));
    }
  }

  fs::create_dir_all(dest_dir)?;
  let download = TempFile(dest_dir.join(format!(".{}.part", asset.install_name)));
  let (actual, bytes) = download_hashed(&agent, &url, &download.0)?;
  log.push(format!("actual   sha256 {actual} ({bytes} bytes)"));
  if actual != expected {
    return Err(Error::Refused(format!(
      "checksum mismatch for {}: expected {expected}, got {actual}; nothing installed",
      asset.name
    )));
  }

  let staged = match asset.tool {
    Tool::YtDlp => download,
    Tool::Deno => {
      let inner = if asset.name.contains("-windows") {
        "deno.exe"
      } else {
        "deno"
      };
      let out = TempFile(dest_dir.join(format!(".{}.unzip", asset.install_name)));
      extract_one(&download.0, inner, &out.0)?;
      log.push(format!("extracted {inner} from {}", asset.name));
      out
    }
  };
  make_executable(&staged.0)?;
  let dest = dest_dir.join(&asset.install_name);
  fs::rename(&staged.0, &dest)?;
  staged.disarm();
  log.push(format!("verified; installed {}", dest.display()));

  Ok(FetchReport {
    tool: asset.tool,
    version: asset.version.clone(),
    asset: asset.name.clone(),
    url,
    checksum_url,
    expected_sha256: expected,
    actual_sha256: actual,
    pinned_sha256: asset.pinned_sha256.clone(),
    path: dest,
    bytes,
    log,
  })
}

fn tool_name(t: Tool) -> &'static str {
  match t {
    Tool::YtDlp => "yt-dlp",
    Tool::Deno => "deno",
  }
}

/// Finds the SHA-256 for `asset_name` in a checksum file. Understands coreutils lines
/// (`<hex>  <name>` / `<hex> *<name>`, as in yt-dlp's SHA2-256SUMS and deno's Linux/macOS files)
/// and PowerShell `Get-FileHash` lists (`Hash : <HEX>` + `Path : ...\<name>`, as deno publishes
/// for Windows). A hash is only taken when the file names the asset.
pub fn expected_sha256(text: &str, asset_name: &str) -> Option<String> {
  for line in text.lines() {
    let mut parts = line.split_whitespace();
    if let (Some(hash), Some(name)) = (parts.next(), parts.next()) {
      if is_sha256_hex(hash) && name.trim_start_matches('*') == asset_name {
        return Some(hash.to_ascii_lowercase());
      }
    }
  }
  let (mut hash, mut names_asset, mut sha256) = (None, false, true);
  for line in text.lines() {
    let Some((key, value)) = line.split_once(':') else {
      continue;
    };
    let value = value.trim();
    match key.trim() {
      "Algorithm" => sha256 = value.eq_ignore_ascii_case("SHA256"),
      "Hash" if is_sha256_hex(value) => hash = Some(value.to_ascii_lowercase()),
      "Path" => names_asset = value.rsplit(['\\', '/']).next() == Some(asset_name),
      _ => {}
    }
  }
  if names_asset && sha256 {
    hash
  } else {
    None
  }
}

fn is_sha256_hex(s: &str) -> bool {
  s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// TLS only, except plain HTTP to a loopback test server.
fn agent_for(base: &str) -> Result<ureq::Agent> {
  let https = base.starts_with("https://");
  let loopback = ["http://127.0.0.1", "http://localhost", "http://[::1]"]
    .iter()
    .any(|p| {
      base
        .strip_prefix(p)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with([':', '/']))
    });
  if !https && !loopback {
    return Err(Error::Refused(format!(
      "sidecars are only fetched over https, not {base}"
    )));
  }
  let mut cfg = ureq::Agent::config_builder()
    .https_only(https)
    .timeout_connect(Some(Duration::from_secs(30)))
    .timeout_per_read(Some(Duration::from_secs(60)))
    .user_agent(format!("Soundhood/{} (sidecar manager)", env!("CARGO_PKG_VERSION")));
  if loopback {
    cfg = cfg.proxy(None);
  }
  Ok(cfg.build().new_agent())
}

fn http_error(url: &str, e: ureq::Error) -> Error {
  match e {
    ureq::Error::StatusCode(404) => Error::NotFound(url.to_string()),
    e => Error::Other(format!("GET {url}: {e}")),
  }
}

fn get_text(agent: &ureq::Agent, url: &str) -> Result<String> {
  let mut resp = agent.get(url).call().map_err(|e| match http_error(url, e) {
    Error::NotFound(u) => Error::Refused(format!("no published checksum at {u}")),
    other => other,
  })?;
  resp
    .body_mut()
    .read_to_string()
    .map_err(|e| Error::Other(format!("GET {url}: {e}")))
}

/// Streams `url` into `path` (fsync'd), returning the SHA-256 hex and the byte count.
fn download_hashed(agent: &ureq::Agent, url: &str, path: &Path) -> Result<(String, u64)> {
  let resp = agent.get(url).call().map_err(|e| http_error(url, e))?;
  let mut body = resp.into_body().into_reader();
  let mut file = File::create(path)?;
  let mut hasher = Sha256::new();
  let mut buf = vec![0u8; 64 * 1024];
  let mut total = 0u64;
  loop {
    let n = body
      .read(&mut buf)
      .map_err(|e| Error::Other(format!("GET {url}: {e}")))?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
    file.write_all(&buf[..n])?;
    total += n as u64;
  }
  file.sync_all()?;
  Ok((hex(&hasher.finalize()), total))
}

/// Extracts the single entry named `inner` (at any depth) from the verified zip into `out`.
fn extract_one(zip_path: &Path, inner: &str, out: &Path) -> Result<()> {
  let bad = |e: zip::result::ZipError| Error::Other(format!("{}: {e}", zip_path.display()));
  let mut archive = zip::ZipArchive::new(File::open(zip_path)?).map_err(bad)?;
  for i in 0..archive.len() {
    let mut entry = archive.by_index(i).map_err(bad)?;
    let name = entry.name().map_err(bad)?.replace('\\', "/");
    if entry.is_file() && name.rsplit('/').next() == Some(inner) {
      let mut file = File::create(out)?;
      std::io::copy(&mut entry, &mut file)?;
      file.sync_all()?;
      return Ok(());
    }
  }
  Err(Error::NotFound(format!("{inner} inside {}", zip_path.display())))
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<()> {
  use std::os::unix::fs::PermissionsExt;
  fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
  Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<()> {
  Ok(())
}

/// A temp file that is removed unless it was renamed into place.
struct TempFile(PathBuf);

impl TempFile {
  fn disarm(self) {
    std::mem::forget(self);
  }
}

impl Drop for TempFile {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.0);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const H: &str = "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d";

  #[test]
  fn reads_coreutils_sums() {
    let sums = format!(
      "{}  yt-dlp\n{H}  yt-dlp.exe\n{}  yt-dlp_x86.exe\n",
      "a".repeat(64),
      "b".repeat(64)
    );
    assert_eq!(expected_sha256(&sums, "yt-dlp.exe").as_deref(), Some(H));
    assert_eq!(
      expected_sha256(&format!("{H} *yt-dlp.exe\n"), "yt-dlp.exe").as_deref(),
      Some(H)
    );
    assert_eq!(expected_sha256(&sums, "yt-dlp_arm64.exe"), None);
  }

  #[test]
  fn reads_powershell_get_filehash_lists() {
    let text = format!(
      "\r\nAlgorithm : SHA256\r\nHash      : {}\r\nPath      : C:\\a\\deno\\target\\release\\deno-x86_64-pc-windows-msvc.zip\r\n\r\n",
      H.to_uppercase()
    );
    assert_eq!(
      expected_sha256(&text, "deno-x86_64-pc-windows-msvc.zip").as_deref(),
      Some(H)
    );
    assert_eq!(expected_sha256(&text, "deno-aarch64-pc-windows-msvc.zip"), None);
    assert_eq!(
      expected_sha256(&text.replace("SHA256", "SHA512"), "deno-x86_64-pc-windows-msvc.zip"),
      None
    );
  }

  #[test]
  fn release_urls() {
    let y = Asset::ytdlp_bootstrap("x86_64-pc-windows-msvc").unwrap();
    assert_eq!(
      y.asset_url(RELEASES_BASE),
      "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe"
    );
    assert_eq!(
      y.checksum_url("http://127.0.0.1:9/"),
      "http://127.0.0.1:9/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS"
    );
    assert_eq!(y.install_name, "yt-dlp.exe");
    assert!(y.pinned_sha256.is_some());
    let d = Asset::deno_pinned("x86_64-unknown-linux-gnu").unwrap();
    assert_eq!(
      d.checksum_url(RELEASES_BASE),
      "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip.sha256sum"
    );
    assert_eq!(d.install_name, "deno");
    assert!(Asset::ytdlp_release("2027.01.01", "x86_64-pc-windows-msvc")
      .unwrap()
      .pinned_sha256
      .is_none());
    assert!(Asset::deno_pinned("aarch64-linux-android").is_err());
  }

  #[test]
  fn plain_http_only_to_loopback() {
    assert!(agent_for("http://127.0.0.1:8080").is_ok());
    assert!(agent_for("http://localhost").is_ok());
    assert!(matches!(agent_for("http://example.com"), Err(Error::Refused(_))));
    assert!(matches!(
      agent_for("http://127.0.0.1.example.com"),
      Err(Error::Refused(_))
    ));
  }
}
