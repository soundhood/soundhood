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

/// Largest yt-dlp download accepted. The real executables are about 20 to 40 MB; a bigger answer
/// is a broken or hostile server, and the fetch stops before it fills the disk.
pub const MAX_YTDLP_BYTES: u64 = 100 << 20;
/// Largest deno zip accepted (the real ones are about 45 MB).
pub const MAX_DENO_ZIP_BYTES: u64 = 200 << 20;
/// Largest deno binary extracted from a zip (the real one is about 130 MB).
pub const MAX_DENO_BYTES: u64 = 400 << 20;
/// Largest checksum file read; a real one is a few kB.
const MAX_CHECKSUM_BYTES: u64 = 1 << 20;
/// Whole-request limit on top of the per-read timeout, so a server that trickles bytes cannot
/// hold a fetch open forever.
const TIMEOUT_GLOBAL: Duration = Duration::from_secs(30 * 60);
/// Redirects followed for an https base (GitHub sends release assets on to its download host);
/// every hop must be https too.
const MAX_REDIRECTS: u32 = 5;

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

  /// The download size limit for this asset.
  fn max_bytes(&self) -> u64 {
    match self.tool {
      Tool::YtDlp => MAX_YTDLP_BYTES,
      Tool::Deno => MAX_DENO_ZIP_BYTES,
    }
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
/// a missing or unusable checksum, any hash mismatch, a download above the tool's size limit, an
/// address with a user name or password in it, and plain HTTP to anything but loopback (which
/// also never follows a redirect).
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
  let (actual, bytes) = download_hashed(&agent, &url, &download.0, asset.max_bytes())?;
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
      extract_one(&download.0, inner, &out.0, MAX_DENO_BYTES)?;
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
/// Plain HTTP never follows a redirect: from a test server on this computer, a redirect can only
/// lead somewhere else, in the clear.
fn agent_for(base: &str) -> Result<ureq::Agent> {
  let https = check_base(base)?;
  let mut cfg = ureq::Agent::config_builder()
    .https_only(https)
    .max_redirects(if https { MAX_REDIRECTS } else { 0 })
    // The hash is of the bytes as published: ask for them as they are, never compressed.
    .accept_encoding("identity")
    .timeout_connect(Some(Duration::from_secs(30)))
    .timeout_per_read(Some(Duration::from_secs(60)))
    .timeout_global(Some(TIMEOUT_GLOBAL))
    .user_agent(format!("Soundhood/{} (sidecar manager)", env!("CARGO_PKG_VERSION")));
  if !https {
    cfg = cfg.proxy(None);
  }
  Ok(cfg.build().new_agent())
}

/// Hosts plain HTTP may reach: a test server on this computer.
const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/// Checks `scheme://host[:port][/path]` and says whether it is https (`false`: plain HTTP to a
/// loopback host). The host is taken the way an HTTP client reads it, and anything two parsers
/// could read differently is refused rather than guessed: a user name or password (`user@`), a
/// percent sign in the host, a backslash, `?`, `#`, spaces and control characters.
fn check_base(base: &str) -> Result<bool> {
  let refuse = |why: &str| Error::Refused(format!("{base} is not a usable address for the helpers: {why}"));
  if base
    .chars()
    .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\\' | '?' | '#'))
  {
    return Err(refuse("only a scheme, a host, a port and a path are allowed"));
  }
  let (scheme, rest) = base.split_once("://").ok_or_else(|| refuse("it has no https://"))?;
  let https = match scheme.to_ascii_lowercase().as_str() {
    "https" => true,
    "http" => false,
    _ => return Err(refuse("only https is allowed")),
  };
  let authority = rest.split('/').next().unwrap_or_default();
  if authority.contains('@') {
    return Err(refuse("a user name or password is not allowed"));
  }
  if authority.contains('%') {
    return Err(refuse("a percent sign is not allowed in the host"));
  }
  let (host, port) = match authority.strip_prefix('[') {
    Some(v6) => {
      let end = v6.find(']').ok_or_else(|| refuse("the [ of the host is not closed"))?;
      (format!("[{}]", &v6[..end]), &v6[end + 1..])
    }
    None => {
      let end = authority.find(':').unwrap_or(authority.len());
      (authority[..end].to_string(), &authority[end..])
    }
  };
  if host.is_empty() || host == "[]" {
    return Err(refuse("it has no host"));
  }
  if !port.is_empty() {
    let digits = port.strip_prefix(':').unwrap_or_default();
    let valid = (1..=5).contains(&digits.len())
      && digits.bytes().all(|b| b.is_ascii_digit())
      && digits.parse::<u16>().is_ok_and(|p| p != 0);
    if !valid {
      return Err(refuse("the port is not a number from 1 to 65535"));
    }
  }
  if !https && !LOOPBACK_HOSTS.contains(&host.to_ascii_lowercase().as_str()) {
    return Err(Error::Refused(format!(
      "sidecars are only fetched over https, not {base}"
    )));
  }
  Ok(https)
}

fn http_error(url: &str, e: ureq::Error) -> Error {
  match e {
    ureq::Error::StatusCode(404) => Error::NotFound(url.to_string()),
    e => Error::Other(format!("GET {url}: {e}")),
  }
}

/// GET `url`; anything but `200 OK` is an error. With redirects off (plain HTTP), a redirect
/// arrives here as a 3xx and is refused.
fn get(agent: &ureq::Agent, url: &str) -> Result<ureq::http::Response<ureq::Body>> {
  let resp = agent.get(url).call().map_err(|e| http_error(url, e))?;
  match resp.status().as_u16() {
    200 => Ok(resp),
    s @ 300..=399 => Err(Error::Refused(format!(
      "GET {url}: the server redirected ({s}); a test server on this computer is never followed elsewhere"
    ))),
    s => Err(Error::Other(format!("GET {url}: unexpected answer {s}"))),
  }
}

/// The checksum file as text, refused past `MAX_CHECKSUM_BYTES` (counted after any decoding the
/// HTTP client does, so a compressed answer cannot expand without bound).
fn get_text(agent: &ureq::Agent, url: &str) -> Result<String> {
  let resp = get(agent, url).map_err(|e| match e {
    Error::NotFound(u) => Error::Refused(format!("no published checksum at {u}")),
    other => other,
  })?;
  let mut bytes = Vec::new();
  resp
    .into_body()
    .into_reader()
    .take(MAX_CHECKSUM_BYTES + 1)
    .read_to_end(&mut bytes)
    .map_err(|e| Error::Other(format!("GET {url}: {e}")))?;
  if bytes.len() as u64 > MAX_CHECKSUM_BYTES {
    return Err(Error::Refused(format!(
      "the checksum file at {url} is larger than {} bytes",
      MAX_CHECKSUM_BYTES
    )));
  }
  String::from_utf8(bytes).map_err(|_| Error::Refused(format!("the checksum file at {url} is not text")))
}

/// Streams `url` into `path` (fsync'd), returning the SHA-256 hex and the byte count. Refuses a
/// body larger than `max` bytes: up front from `Content-Length`, otherwise as soon as the running
/// count passes it, so at most `max` bytes ever reach the disk. The count is of the bytes the
/// reader yields, after any transparent decompression, which is what a compressed "bomb" inflates.
fn download_hashed(agent: &ureq::Agent, url: &str, path: &Path, max: u64) -> Result<(String, u64)> {
  let too_big = || {
    Error::Refused(format!(
      "{url} is larger than the {max} byte limit for this helper; nothing installed"
    ))
  };
  let resp = get(agent, url)?;
  if resp.body().content_length().is_some_and(|len| len > max) {
    return Err(too_big());
  }
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
    total += n as u64;
    if total > max {
      return Err(too_big());
    }
    hasher.update(&buf[..n]);
    file.write_all(&buf[..n])?;
  }
  file.sync_all()?;
  Ok((hex(&hasher.finalize()), total))
}

/// Extracts `inner` (`deno` or `deno.exe`) from the verified zip into `out`. The archive must hold
/// exactly one entry with that file name, and it must sit at the top: a second one anywhere
/// (`decoy/deno.exe`, `DENO.EXE`), or a single one inside a folder, is refused rather than picked
/// between. More than `max` extracted bytes is refused too.
fn extract_one(zip_path: &Path, inner: &str, out: &Path, max: u64) -> Result<()> {
  let bad = |e: zip::result::ZipError| Error::Other(format!("{}: {e}", zip_path.display()));
  let refuse = |why: String| Error::Refused(format!("the deno archive {why}; nothing installed"));
  let mut archive = zip::ZipArchive::new(File::open(zip_path)?).map_err(bad)?;
  // The reader keeps one entry per name, so a repeated name would be picked silently.
  if archive.has_duplicate_names() {
    return Err(refuse("holds two entries with the same name".into()));
  }
  let mut named = Vec::new();
  for i in 0..archive.len() {
    let entry = archive.by_index_raw(i).map_err(bad)?;
    let name = entry.name().map_err(bad)?.to_string();
    let file_name = name
      .trim_end_matches(['/', '\\'])
      .rsplit(['/', '\\'])
      .next()
      .unwrap_or_default();
    if file_name.eq_ignore_ascii_case(inner) {
      named.push((i, name, entry.is_file()));
    }
  }
  let index = match named.as_slice() {
    [] => return Err(Error::NotFound(format!("{inner} inside {}", zip_path.display()))),
    [(i, name, true)] if name == inner => *i,
    [(_, name, _)] => return Err(refuse(format!("holds {name:?}, not {inner} at its top"))),
    many => return Err(refuse(format!("holds {} entries named {inner}", many.len()))),
  };
  let entry = archive.by_index(index).map_err(bad)?;
  if entry.size() > max {
    return Err(refuse(format!("says {inner} is larger than {max} bytes")));
  }
  let mut file = File::create(out)?;
  let copied = std::io::copy(&mut entry.take(max + 1), &mut file)?;
  if copied > max {
    return Err(refuse(format!("holds a {inner} larger than {max} bytes")));
  }
  file.sync_all()?;
  Ok(())
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

  /// Answers every connection on 127.0.0.1 with the raw bytes `reply`, then closes it. Returns the
  /// base URL and the request heads seen.
  fn serve_raw(reply: Vec<u8>) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
    use std::io::{BufRead, BufReader};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
      for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut head = String::new();
        loop {
          let mut line = String::new();
          if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
          }
          head.push_str(&line);
        }
        log.lock().unwrap().push(head);
        let _ = stream.write_all(&reply);
      }
    });
    (base, seen)
  }

  /// A gzip member whose one fixed-Huffman deflate block expands to `n` zero bytes: a literal,
  /// then length-258 / distance-1 copies, about 13 bits on the wire per 258 bytes out. The CRC
  /// trailer is left zero; a client has to stop long before it gets there.
  fn gzip_bomb(n: u64) -> Vec<u8> {
    struct Bits {
      out: Vec<u8>,
      acc: u8,
      len: u32,
    }
    impl Bits {
      fn bit(&mut self, b: u32) {
        self.acc |= ((b & 1) as u8) << self.len;
        self.len += 1;
        if self.len == 8 {
          self.out.push(self.acc);
          (self.acc, self.len) = (0, 0);
        }
      }
      /// Header fields go least significant bit first.
      fn raw(&mut self, v: u32, width: u32) {
        (0..width).for_each(|i| self.bit(v >> i));
      }
      /// Huffman codes go most significant bit first.
      fn code(&mut self, c: u32, width: u32) {
        (0..width).rev().for_each(|i| self.bit(c >> i));
      }
    }
    let mut b = Bits {
      out: vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff],
      acc: 0,
      len: 0,
    };
    b.raw(1, 1); // last block
    b.raw(1, 2); // fixed Huffman codes
    b.code(0x30, 8); // literal 0
    let mut left = n - 1;
    while left >= 258 {
      b.code(0xc5, 8); // length code 285: 258 bytes
      b.code(0, 5); // distance code 0: 1 byte back
      left -= 258;
    }
    (0..left).for_each(|_| b.code(0x30, 8));
    b.code(0, 7); // end of block
    if b.len > 0 {
      b.out.push(b.acc);
    }
    b.out.extend_from_slice(&[0; 4]);
    b.out.extend_from_slice(&(n as u32).to_le_bytes());
    b.out
  }

  #[test]
  fn assets_are_asked_for_uncompressed() {
    let (base, seen) = serve_raw(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_vec());
    let dir = tempfile::tempdir().unwrap();
    let agent = agent_for(&base).unwrap();
    download_hashed(&agent, &format!("{base}/a"), &dir.path().join("a"), 10).unwrap();
    let head = seen.lock().unwrap()[0].to_ascii_lowercase();
    assert!(head.contains("\r\naccept-encoding: identity\r\n"), "{head}");
  }

  #[test]
  fn a_content_length_above_the_limit_refuses_before_writing() {
    let (base, _) =
      serve_raw(b"HTTP/1.1 200 OK\r\nContent-Length: 10000000000\r\nConnection: close\r\n\r\naaaa".to_vec());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a");
    let err = download_hashed(&agent_for(&base).unwrap(), &format!("{base}/a"), &path, 1024).unwrap_err();
    assert!(
      matches!(&err, Error::Refused(m) if m.contains("1024 byte limit")),
      "{err}"
    );
    assert!(!path.exists(), "nothing written");
  }

  #[test]
  fn a_body_without_a_length_stops_at_the_limit() {
    let mut reply = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    reply.extend(std::iter::repeat_n(b'a', 1 << 20));
    let (base, _) = serve_raw(reply);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a");
    let err = download_hashed(&agent_for(&base).unwrap(), &format!("{base}/a"), &path, 64 << 10).unwrap_err();
    assert!(matches!(err, Error::Refused(_)), "{err}");
    assert!(fs::metadata(&path).unwrap().len() <= 64 << 10);
  }

  #[test]
  fn a_gzip_bomb_is_counted_after_decoding() {
    let bomb = gzip_bomb(8 << 20);
    assert!(bomb.len() < 64 << 10, "{} bytes on the wire", bomb.len());
    let mut reply = format!(
      "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
      bomb.len()
    )
    .into_bytes();
    reply.extend(bomb);
    let (base, _) = serve_raw(reply);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a");
    let err = download_hashed(&agent_for(&base).unwrap(), &format!("{base}/a"), &path, 1 << 20).unwrap_err();
    assert!(matches!(err, Error::Refused(_)), "{err}");
    assert!(fs::metadata(&path).unwrap().len() <= 1 << 20);
  }

  #[test]
  fn a_checksum_file_past_its_limit_refuses() {
    let mut reply = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    reply.extend(std::iter::repeat_n(b'a', (MAX_CHECKSUM_BYTES + 10) as usize));
    let (base, _) = serve_raw(reply);
    let err = get_text(&agent_for(&base).unwrap(), &format!("{base}/SHA2-256SUMS")).unwrap_err();
    assert!(matches!(&err, Error::Refused(m) if m.contains("larger than")), "{err}");
  }

  #[test]
  fn extraction_stops_at_the_size_limit() {
    let dir = tempfile::tempdir().unwrap();
    let zip_path = dir.path().join("deno.zip");
    let mut w = zip::ZipWriter::new(File::create(&zip_path).unwrap());
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    w.start_file("deno", opts).unwrap();
    w.write_all(&[0u8; 4096]).unwrap();
    w.finish().unwrap();
    let out = dir.path().join("deno.out");
    let err = extract_one(&zip_path, "deno", &out, 1024).unwrap_err();
    assert!(
      matches!(&err, Error::Refused(m) if m.contains("larger than 1024 bytes")),
      "{err}"
    );
    extract_one(&zip_path, "deno", &out, 4096).unwrap();
    assert_eq!(fs::read(&out).unwrap(), [0u8; 4096]);
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

  #[test]
  fn base_addresses_are_parsed_not_prefix_matched() {
    for (base, https) in [
      ("https://github.com", true),
      ("HTTPS://github.com/", true),
      ("https://mirror.example:8443/releases", true),
      ("http://127.0.0.1", false),
      ("http://127.0.0.1:9/", false),
      ("http://LOCALHOST:65535/x/y", false),
      ("http://[::1]:8080", false),
      ("http://[::1]", false),
    ] {
      assert_eq!(check_base(base).ok(), Some(https), "{base}");
    }
    for base in [
      // A user name (or password) in front of another host.
      "http://localhost:1@127.0.0.2:8080",
      "http://127.0.0.1:80@mirror.example",
      "http://127.0.0.1@mirror.example/",
      "https://user:pass@github.com",
      "https://github.com@mirror.example",
      // Lookalikes and other loopback spellings that are not in the list.
      "http://127.0.0.2",
      "http://127.1",
      "http://localhost.",
      "http://localhost.example.com",
      "http://[::1].example.com",
      "http://[::2]",
      "http://0x7f000001",
      // Things another parser could read differently.
      "http://127.0.0.1%2f@mirror.example",
      "http://127.0.0.1\\@mirror.example",
      "http://127.0.0.1#@mirror.example",
      "http://127.0.0.1?@mirror.example",
      "http://127.0.0.1 /",
      "http://127.0.0.1:/",
      "http://127.0.0.1:0",
      "http://127.0.0.1:65536",
      "http://127.0.0.1:80:90",
      "http://[::1",
      "http://",
      "https://",
      "https:///path",
      "ftp://127.0.0.1",
      "127.0.0.1:8080",
      "file:///C:/x",
    ] {
      assert!(
        matches!(check_base(base), Err(Error::Refused(_))),
        "{base:?} must be refused"
      );
    }
  }
}
