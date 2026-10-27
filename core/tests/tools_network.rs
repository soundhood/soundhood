//! The sidecar manager against hostile servers on loopback: size limits, compressed "bombs",
//! redirects, user names in the address, odd zips. 127.0.0.1 plays the release server and
//! 127.0.0.2 plays "somewhere else". Adapted from the Phase 0 network review's adversarial tests;
//! each one asserts the safe behaviour.
#![cfg(all(feature = "sidecars", not(target_os = "android")))]

use sha2::{Digest, Sha256};
use soundhood_core::sidecars::{self, Asset, Tool, MAX_YTDLP_BYTES};
use soundhood_core::Error;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

enum Reply {
  Body(Vec<u8>),
  /// `n` bytes of b'a' with a matching Content-Length.
  Big(u64),
  /// Pre-compressed bytes sent with Content-Encoding: gzip.
  Gzip(Vec<u8>),
  Redirect(String),
  NotFound,
}

type Handler = Arc<dyn Fn(&str) -> Reply + Send + Sync>;

/// A one-request-per-connection HTTP server on `addr`; returns its base URL and the paths asked for.
fn serve(addr: &str, h: Handler) -> (String, Arc<Mutex<Vec<String>>>) {
  let listener = TcpListener::bind(addr).unwrap();
  let base = format!("http://{}", listener.local_addr().unwrap());
  let seen = Arc::new(Mutex::new(Vec::new()));
  let log = seen.clone();
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      let mut reader = BufReader::new(stream.try_clone().unwrap());
      let mut request_line = String::new();
      let _ = reader.read_line(&mut request_line);
      loop {
        let mut header = String::new();
        if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" {
          break;
        }
      }
      let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();
      log.lock().unwrap().push(path.clone());
      let head =
        |extra: &str, len: u64| format!("HTTP/1.1 200 OK\r\n{extra}Content-Length: {len}\r\nConnection: close\r\n\r\n");
      let _ = match h(&path) {
        Reply::Body(b) => stream
          .write_all(head("", b.len() as u64).as_bytes())
          .and_then(|_| stream.write_all(&b)),
        Reply::Gzip(b) => stream
          .write_all(head("Content-Encoding: gzip\r\n", b.len() as u64).as_bytes())
          .and_then(|_| stream.write_all(&b)),
        Reply::Big(n) => {
          let mut r = stream.write_all(head("", n).as_bytes());
          let chunk = vec![b'a'; 1 << 20];
          let mut left = n;
          while r.is_ok() && left > 0 {
            let k = left.min(chunk.len() as u64) as usize;
            r = stream.write_all(&chunk[..k]);
            left -= k as u64;
          }
          r
        }
        Reply::Redirect(to) => stream.write_all(
          format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
        ),
        Reply::NotFound => {
          stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        }
      };
    }
  });
  (base, seen)
}

fn sha(b: &[u8]) -> String {
  Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

const V: &str = "2099.12.31";
const YT: &[u8] = b"pretend yt-dlp\n";

fn ytdlp() -> Asset {
  Asset {
    tool: Tool::YtDlp,
    version: V.into(),
    name: "yt-dlp.exe".into(),
    install_name: "yt-dlp.exe".into(),
    pinned_sha256: None,
  }
}

fn names(dir: &Path) -> Vec<String> {
  let mut v: Vec<String> = std::fs::read_dir(dir)
    .unwrap()
    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
    .collect();
  v.sort();
  v
}

/// Serves yt-dlp `V` with the given SUMS text.
fn ytdlp_release(sums: String) -> Handler {
  Arc::new(move |p: &str| {
    if p.ends_with("/SHA2-256SUMS") {
      Reply::Body(sums.clone().into_bytes())
    } else if p.ends_with("/yt-dlp.exe") {
      Reply::Body(YT.to_vec())
    } else {
      Reply::NotFound
    }
  })
}

/// A gzip member whose fixed-Huffman deflate block expands to `n` zero bytes (a literal, then
/// length-258 / distance-1 copies). The CRC trailer is left zero: the client must stop long
/// before it gets there.
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
fn a_gzip_bomb_asset_never_writes_more_than_the_limit() {
  let bomb = gzip_bomb(2 * MAX_YTDLP_BYTES);
  let wire = bomb.len();
  let sums = format!("{}  yt-dlp.exe\n", sha(YT));
  let (base, _) = serve(
    "127.0.0.1:0",
    Arc::new(move |p: &str| {
      if p.ends_with("/SHA2-256SUMS") {
        Reply::Body(sums.clone().into_bytes())
      } else {
        Reply::Gzip(bomb.clone())
      }
    }),
  );
  let dest = tempfile::tempdir().unwrap();
  // Watch the temp file grow while the fetch runs.
  let part = dest.path().join(".yt-dlp.exe.part");
  let peak = Arc::new(Mutex::new(0u64));
  let done = Arc::new(AtomicBool::new(false));
  let (p2, pk, d2) = (part.clone(), peak.clone(), done.clone());
  let watcher = std::thread::spawn(move || {
    while !d2.load(Ordering::SeqCst) {
      if let Ok(m) = std::fs::metadata(&p2) {
        let mut g = pk.lock().unwrap();
        *g = (*g).max(m.len());
      }
      std::thread::sleep(std::time::Duration::from_millis(5));
    }
  });
  let r = sidecars::fetch(&ytdlp(), dest.path(), Some(&base));
  done.store(true, Ordering::SeqCst);
  watcher.join().unwrap();
  let peak = *peak.lock().unwrap();
  eprintln!(
    "gzip bomb ({wire} bytes on the wire): {:?}; temp peaked at {peak} bytes",
    r.as_ref().map(|x| x.bytes)
  );
  let err = r.unwrap_err();
  assert!(matches!(&err, Error::Refused(m) if m.contains("byte limit")), "{err}");
  assert!(names(dest.path()).is_empty(), "temp file left behind");
  assert!(
    peak <= MAX_YTDLP_BYTES,
    "wrote {peak} bytes for an asset that cannot verify"
  );
}

#[test]
fn a_content_length_past_the_limit_refuses_without_reading_the_body() {
  let sums = format!("{}  yt-dlp.exe\n", sha(YT));
  let (base, _) = serve(
    "127.0.0.1:0",
    Arc::new(move |p: &str| {
      if p.ends_with("/SHA2-256SUMS") {
        Reply::Body(sums.clone().into_bytes())
      } else {
        Reply::Big(MAX_YTDLP_BYTES + 1)
      }
    }),
  );
  let dest = tempfile::tempdir().unwrap();
  let t = std::time::Instant::now();
  let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
  assert!(matches!(&err, Error::Refused(m) if m.contains("byte limit")), "{err}");
  assert!(t.elapsed() < std::time::Duration::from_secs(10), "{:?}", t.elapsed());
  assert!(names(dest.path()).is_empty());
}

#[test]
fn a_huge_checksum_file_is_refused_without_reading_it_all() {
  let (base, _) = serve(
    "127.0.0.1:0",
    Arc::new(|p: &str| {
      if p.ends_with("/SHA2-256SUMS") {
        Reply::Big(64 << 20)
      } else {
        Reply::Body(YT.to_vec())
      }
    }),
  );
  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
  assert!(matches!(&err, Error::Refused(m) if m.contains("larger than")), "{err}");
  assert!(names(dest.path()).is_empty());
}

#[test]
fn a_gzipped_checksum_file_cannot_expand_without_bound() {
  let bomb = gzip_bomb(64 << 20);
  let (base, _) = serve(
    "127.0.0.1:0",
    Arc::new(move |p: &str| {
      if p.ends_with("/SHA2-256SUMS") {
        Reply::Gzip(bomb.clone())
      } else {
        Reply::Body(YT.to_vec())
      }
    }),
  );
  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
  assert!(matches!(&err, Error::Refused(m) if m.contains("larger than")), "{err}");
}

#[test]
fn a_tampered_sums_hash_refuses() {
  let (base, _) = serve(
    "127.0.0.1:0",
    ytdlp_release(format!("{}  yt-dlp.exe\n", "e".repeat(64))),
  );
  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
  assert!(err.to_string().contains("checksum mismatch"), "{err}");
  assert!(names(dest.path()).is_empty());
}

#[test]
fn sums_naming_another_file_refuses() {
  let h = sha(YT);
  for line in [
    format!("{h}  yt-dlp_x86.exe"),
    format!("{h}  ./yt-dlp.exe"),
    format!("{h}  sub/yt-dlp.exe"),
    format!("{h}  YT-DLP.EXE"),
    format!("{h}  yt-dlp.exe.sig"),
    format!("{h}yt-dlp.exe"),
    format!("Hash : {h}\nPath : C:\\x\\yt-dlp_x86.exe"),
  ] {
    let (base, _) = serve("127.0.0.1:0", ytdlp_release(format!("{line}\n")));
    let dest = tempfile::tempdir().unwrap();
    let r = sidecars::fetch(&ytdlp(), dest.path(), Some(&base));
    assert!(r.is_err(), "accepted a SUMS line that names another file: {line:?}");
    assert!(names(dest.path()).is_empty(), "{line:?}");
  }
}

#[test]
fn a_loopback_base_never_follows_a_redirect() {
  let (other, other_seen) = serve("127.0.0.2:0", ytdlp_release(format!("{}  yt-dlp.exe\n", sha(YT))));
  for target in [other.clone(), "http://127.0.0.1:1".to_string()] {
    let (base, seen) = serve(
      "127.0.0.1:0",
      Arc::new(move |p: &str| Reply::Redirect(format!("{target}{p}"))),
    );
    let dest = tempfile::tempdir().unwrap();
    let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
    assert!(err.to_string().contains("redirected (302)"), "{err}");
    assert_eq!(seen.lock().unwrap().len(), 1, "stopped at the checksum request");
    assert!(names(dest.path()).is_empty());
  }
  assert!(other_seen.lock().unwrap().is_empty(), "the other host was reached");
}

#[test]
fn a_user_name_cannot_smuggle_another_host_past_the_loopback_check() {
  let (other, other_seen) = serve("127.0.0.2:0", ytdlp_release(format!("{}  yt-dlp.exe\n", sha(YT))));
  let host_port = other.trim_start_matches("http://").to_string();
  for base in [
    format!("http://localhost:1@{host_port}"),
    format!("http://127.0.0.1:80@{host_port}"),
    format!("http://127.0.0.1@{host_port}"),
    format!("http://u:p@{host_port}"),
  ] {
    let dest = tempfile::tempdir().unwrap();
    let err = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap_err();
    assert!(
      matches!(&err, Error::Refused(m) if m.contains("user name or password")),
      "{base}: {err}"
    );
    assert!(names(dest.path()).is_empty());
  }
  assert!(other_seen.lock().unwrap().is_empty(), "the other host was reached");
}

fn deno() -> Asset {
  Asset {
    tool: Tool::Deno,
    version: "9.9.9".into(),
    name: "deno-x86_64-pc-windows-msvc.zip".into(),
    install_name: "deno.exe".into(),
    pinned_sha256: None,
  }
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
  let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
  let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
  for (name, body) in entries {
    if let Some(dir) = name.strip_suffix('/') {
      w.add_directory(dir, opts).unwrap();
    } else {
      w.start_file(*name, opts).unwrap();
      w.write_all(body).unwrap();
    }
  }
  w.finish().unwrap().into_inner()
}

/// Serves `zip` as deno 9.9.9 for Windows, with a matching coreutils checksum file.
fn deno_release(zip: Vec<u8>) -> Handler {
  let sums = format!("{}  deno-x86_64-pc-windows-msvc.zip\n", sha(&zip));
  Arc::new(move |p: &str| {
    if p.ends_with(".zip.sha256sum") {
      Reply::Body(sums.clone().into_bytes())
    } else if p.ends_with(".zip") {
      Reply::Body(zip.clone())
    } else {
      Reply::NotFound
    }
  })
}

fn fetch_deno_zip(entries: &[(&str, &[u8])]) -> (Result<Vec<u8>, Error>, Vec<String>) {
  let (base, _) = serve("127.0.0.1:0", deno_release(zip_of(entries)));
  let dest = tempfile::tempdir().unwrap();
  let r = sidecars::fetch(&deno(), dest.path(), Some(&base)).map(|rep| std::fs::read(rep.path).unwrap());
  (r, names(dest.path()))
}

#[test]
fn the_deno_binary_must_be_the_only_one_and_at_the_top_of_the_zip() {
  // Accepted: deno.exe at the top, whatever else is beside it.
  let (r, left) = fetch_deno_zip(&[("LICENSE.md", b"text"), ("deno.exe", b"REAL")]);
  assert_eq!(r.unwrap(), b"REAL");
  assert_eq!(left, ["deno.exe"]);

  for entries in [
    // Two candidates: never pick one of them.
    &[("decoy/deno.exe", &b"DECOY"[..]), ("deno.exe", b"REAL")][..],
    &[("deno.exe", b"REAL"), ("decoy/deno.exe", b"DECOY")],
    &[("deno.exe", b"REAL"), ("DENO.EXE", b"DECOY")],
    &[("deno.exe", b"REAL"), ("x\\deno.exe", b"DECOY")],
    // One candidate, but not at the top.
    &[("decoy/deno.exe", b"DECOY")],
    &[("./deno.exe", b"DECOY")],
    &[("Deno.exe", b"DECOY")],
    // A folder by that name.
    &[("deno.exe/", b"")],
  ] {
    let (r, left) = fetch_deno_zip(entries);
    let names: Vec<&str> = entries.iter().map(|(n, _)| *n).collect();
    let err = r.expect_err(&format!("{names:?} was installed"));
    assert!(matches!(err, Error::Refused(_)), "{names:?}: {err}");
    assert!(left.is_empty(), "{names:?} left {left:?}");
  }

  let (r, left) = fetch_deno_zip(&[("README.md", b"no binary here")]);
  assert!(matches!(r, Err(Error::NotFound(_))), "{r:?}");
  assert!(left.is_empty());
}

#[test]
fn a_zip_naming_deno_twice_at_the_top_is_refused() {
  // The zip writer refuses duplicate names, so write a placeholder of the same length and patch
  // it in the local and central headers.
  let mut zip = zip_of(&[("deno.exe", b"REAL"), ("deno.ex_", b"DECOY")]);
  let mut patched = 0;
  for i in 0..zip.len() - 8 {
    if &zip[i..i + 8] == b"deno.ex_" {
      zip[i + 7] = b'e';
      patched += 1;
    }
  }
  assert_eq!(patched, 2);
  let (base, _) = serve("127.0.0.1:0", deno_release(zip));
  let dest = tempfile::tempdir().unwrap();
  let err = sidecars::fetch(&deno(), dest.path(), Some(&base)).expect_err("an archive with two deno.exe was installed");
  assert!(matches!(&err, Error::Refused(m) if m.contains("same name")), "{err}");
  assert!(names(dest.path()).is_empty());
}

#[test]
fn zip_traversal_entries_never_write_outside_the_destination() {
  let outer = tempfile::tempdir().unwrap();
  let dest = outer.path().join("a").join("b");
  for entry in [
    "../../escape/deno.exe",
    "..\\..\\escape\\deno.exe",
    "/abs/deno.exe",
    "C:/abs/deno.exe",
  ] {
    let (base, _) = serve("127.0.0.1:0", deno_release(zip_of(&[(entry, b"EVIL")])));
    let r = sidecars::fetch(&deno(), &dest, Some(&base));
    assert!(
      matches!(r, Err(Error::Refused(_))),
      "{entry:?}: {:?}",
      r.map(|x| x.path)
    );
    assert!(
      !outer.path().join("escape").exists(),
      "{entry:?} escaped the destination"
    );
    assert!(names(&dest).is_empty(), "{entry:?}");
  }
}

#[test]
fn the_good_path_still_installs_from_a_loopback_base() {
  let (base, _) = serve("127.0.0.1:0", ytdlp_release(format!("{}  yt-dlp.exe\n", sha(YT))));
  let dest = tempfile::tempdir().unwrap();
  let report = sidecars::fetch(&ytdlp(), dest.path(), Some(&base)).unwrap();
  assert_eq!(std::fs::read(&report.path).unwrap(), YT);
  assert_eq!(names(dest.path()), ["yt-dlp.exe"]);
}
