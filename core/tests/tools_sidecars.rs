//! Sidecar manager against fake releases (`core/fixtures/http`) served from 127.0.0.1.
#![cfg(all(feature = "sidecars", not(target_os = "android")))]

use soundhood_core::sidecars::{self, Asset, Tool};
use soundhood_core::Error;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const YTDLP_OK: &str = "2099.12.31";

fn fixture_root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("http")
}

/// A minimal HTTP/1.1 file server over `root`: GET only, 404 for anything missing, one request
/// per connection. Returns the base URL and a request counter.
fn serve(root: PathBuf) -> (String, Arc<AtomicUsize>) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let base = format!("http://{}", listener.local_addr().unwrap());
  let hits = Arc::new(AtomicUsize::new(0));
  let counter = hits.clone();
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      counter.fetch_add(1, Ordering::SeqCst);
      let mut reader = BufReader::new(stream.try_clone().unwrap());
      let mut request_line = String::new();
      let _ = reader.read_line(&mut request_line);
      loop {
        let mut header = String::new();
        if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" {
          break;
        }
      }
      let path = request_line.split_whitespace().nth(1).unwrap_or("/");
      let file = (!path.contains("..")).then(|| root.join(path.trim_start_matches('/')));
      let body = file.filter(|f| f.is_file()).and_then(|f| std::fs::read(f).ok());
      let (status, body) = match body {
        Some(b) => ("200 OK", b),
        None => ("404 Not Found", b"not found".to_vec()),
      };
      let head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
      );
      let _ = stream.write_all(head.as_bytes());
      let _ = stream.write_all(&body);
    }
  });
  (base, hits)
}

fn copy_tree(from: &Path, to: &Path) {
  for entry in std::fs::read_dir(from).unwrap() {
    let entry = entry.unwrap();
    let dest = to.join(entry.file_name());
    if entry.file_type().unwrap().is_dir() {
      std::fs::create_dir_all(&dest).unwrap();
      copy_tree(&entry.path(), &dest);
    } else {
      std::fs::copy(entry.path(), &dest).unwrap();
    }
  }
}

fn ytdlp(version: &str) -> Asset {
  Asset {
    tool: Tool::YtDlp,
    version: version.into(),
    name: "yt-dlp.exe".into(),
    install_name: "yt-dlp-x86_64-pc-windows-msvc.exe".into(),
    pinned_sha256: None,
  }
}

fn release_file(version: &str, name: &str) -> PathBuf {
  fixture_root()
    .join("yt-dlp/yt-dlp/releases/download")
    .join(version)
    .join(name)
}

fn dir_names(dir: &Path) -> Vec<String> {
  let mut names: Vec<String> = std::fs::read_dir(dir)
    .unwrap()
    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
    .collect();
  names.sort();
  names
}

#[test]
fn good_ytdlp_file_verifies_and_installs() {
  let (base, _) = serve(fixture_root());
  let dest = tempfile::tempdir().unwrap();
  let report = sidecars::fetch(&ytdlp(YTDLP_OK), dest.path(), Some(&base)).unwrap();
  assert_eq!(report.expected_sha256, report.actual_sha256);
  assert_eq!(
    report.expected_sha256,
    "b95026a93c5988bb4f5fd059010e38880355264f73b42c153a3e9b870444b3cf"
  );
  assert_eq!(report.path, dest.path().join("yt-dlp-x86_64-pc-windows-msvc.exe"));
  assert_eq!(
    std::fs::read(&report.path).unwrap(),
    std::fs::read(release_file(YTDLP_OK, "yt-dlp.exe")).unwrap()
  );
  assert!(report.log.iter().any(|l| l.starts_with("expected sha256 b95026a9")));
  assert!(report.log.iter().any(|l| l.starts_with("actual   sha256 b95026a9")));
  // Only the installed file remains: the temp download was renamed, not copied.
  assert_eq!(dir_names(dest.path()), ["yt-dlp-x86_64-pc-windows-msvc.exe"]);
}

#[test]
fn deno_zip_with_powershell_checksum_is_verified_and_extracted() {
  let (base, _) = serve(fixture_root());
  let dest = tempfile::tempdir().unwrap();
  let asset = Asset {
    tool: Tool::Deno,
    version: "9.9.9".into(),
    name: "deno-x86_64-pc-windows-msvc.zip".into(),
    install_name: "deno-x86_64-pc-windows-msvc.exe".into(),
    pinned_sha256: None,
  };
  let report = sidecars::fetch(&asset, dest.path(), Some(&base)).unwrap();
  assert_eq!(report.expected_sha256, report.actual_sha256);
  let body = std::fs::read_to_string(&report.path).unwrap();
  assert!(body.starts_with("Not a real deno.exe 9.9.9"), "{body}");
  assert_eq!(dir_names(dest.path()), ["deno-x86_64-pc-windows-msvc.exe"]);
}

#[test]
fn deno_zip_with_coreutils_checksum_is_verified_and_extracted() {
  let (base, _) = serve(fixture_root());
  let dest = tempfile::tempdir().unwrap();
  let asset = Asset {
    tool: Tool::Deno,
    version: "9.9.9".into(),
    name: "deno-x86_64-unknown-linux-gnu.zip".into(),
    install_name: "deno".into(),
    pinned_sha256: None,
  };
  let report = sidecars::fetch(&asset, dest.path(), Some(&base)).unwrap();
  assert!(std::fs::read_to_string(&report.path)
    .unwrap()
    .starts_with("Not a real deno 9.9.9"));
}

#[test]
fn tampered_byte_refuses_and_keeps_the_installed_file() {
  let served = tempfile::tempdir().unwrap();
  copy_tree(&fixture_root(), served.path());
  let asset_file = served
    .path()
    .join("yt-dlp/yt-dlp/releases/download")
    .join(YTDLP_OK)
    .join("yt-dlp.exe");
  let mut bytes = std::fs::read(&asset_file).unwrap();
  bytes[0] ^= 0x01;
  std::fs::write(&asset_file, bytes).unwrap();
  let (base, _) = serve(served.path().to_path_buf());

  let dest = tempfile::tempdir().unwrap();
  let installed = dest.path().join("yt-dlp-x86_64-pc-windows-msvc.exe");
  std::fs::write(&installed, b"the working older copy").unwrap();
  let err = sidecars::fetch(&ytdlp(YTDLP_OK), dest.path(), Some(&base)).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("checksum mismatch")),
    "{err}"
  );
  assert_eq!(std::fs::read(&installed).unwrap(), b"the working older copy");
  assert_eq!(dir_names(dest.path()), ["yt-dlp-x86_64-pc-windows-msvc.exe"]);
}

#[test]
fn missing_checksum_file_refuses_before_downloading() {
  let served = tempfile::tempdir().unwrap();
  copy_tree(&fixture_root(), served.path());
  std::fs::remove_file(
    served
      .path()
      .join("yt-dlp/yt-dlp/releases/download")
      .join(YTDLP_OK)
      .join("SHA2-256SUMS"),
  )
  .unwrap();
  let (base, hits) = serve(served.path().to_path_buf());

  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp(YTDLP_OK), dest.path(), Some(&base)).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("no published checksum")),
    "{err}"
  );
  assert_eq!(hits.load(Ordering::SeqCst), 1, "only the checksum was requested");
  assert!(dir_names(dest.path()).is_empty());
}

#[test]
fn checksum_file_without_the_asset_refuses() {
  let served = tempfile::tempdir().unwrap();
  copy_tree(&fixture_root(), served.path());
  let sums = served
    .path()
    .join("yt-dlp/yt-dlp/releases/download")
    .join(YTDLP_OK)
    .join("SHA2-256SUMS");
  let text = std::fs::read_to_string(&sums).unwrap();
  let kept: String = text
    .lines()
    .filter(|l| !l.ends_with(" yt-dlp.exe"))
    .map(|l| format!("{l}\n"))
    .collect();
  std::fs::write(&sums, kept).unwrap();
  let (base, _) = serve(served.path().to_path_buf());

  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp(YTDLP_OK), dest.path(), Some(&base)).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("lists no SHA-256")),
    "{err}"
  );
  assert!(dir_names(dest.path()).is_empty());
}

#[test]
fn downgrade_below_the_pinned_minimum_refuses_without_network() {
  let (base, hits) = serve(fixture_root());
  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp("2020.01.01"), dest.path(), Some(&base)).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("older than the minimum")),
    "{err}"
  );
  assert_eq!(hits.load(Ordering::SeqCst), 0);
  assert!(dir_names(dest.path()).is_empty());
}

#[test]
fn published_checksum_that_disagrees_with_the_pin_refuses() {
  let (base, _) = serve(fixture_root());
  let dest = tempfile::tempdir().unwrap();
  let asset = Asset {
    pinned_sha256: Some("0".repeat(64)),
    ..ytdlp(YTDLP_OK)
  };
  let err = sidecars::fetch(&asset, dest.path(), Some(&base)).unwrap_err();
  assert!(
    matches!(&err, Error::Refused(m) if m.contains("differs from the pinned")),
    "{err}"
  );
  assert!(dir_names(dest.path()).is_empty());
}
