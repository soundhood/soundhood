//! soundhood-tools: manifest, fixture library, sidecar fetch, self-test. Zone: tools.
//!
//! Exit codes: 0 ok, 1 differences or failures, 2 usage error. Output is plain lines meant to be
//! pasted back as-is (the owner's PowerShell wrappers print it verbatim).

use soundhood_core::{fixtures, manifest};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "usage:
  soundhood-tools manifest <root> <out.json>
  soundhood-tools diff <a.json> <b.json>
  soundhood-tools fixture-lib <dir> [--json <out.json>]
  soundhood-tools fetch-sidecars <dir> [--triple <target-triple>] [--base <url>]
  soundhood-tools self-test";

enum Failure {
  Usage(String),
  Error(String),
}

impl From<soundhood_core::Error> for Failure {
  fn from(e: soundhood_core::Error) -> Self {
    Failure::Error(e.to_string())
  }
}

fn main() -> ExitCode {
  let args: Vec<OsString> = std::env::args_os().skip(1).collect();
  match run(&args) {
    Ok(code) => code,
    Err(Failure::Usage(msg)) => {
      eprintln!("{msg}\n{USAGE}");
      ExitCode::from(2)
    }
    Err(Failure::Error(msg)) => {
      eprintln!("error: {msg}");
      ExitCode::from(1)
    }
  }
}

fn run(args: &[OsString]) -> Result<ExitCode, Failure> {
  let Some(cmd) = args.first().and_then(|a| a.to_str()) else {
    return Err(Failure::Usage("missing command".into()));
  };
  let (positional, options) = split_options(&args[1..])?;
  let allow = |known: &[&str]| -> Result<(), Failure> {
    match options.iter().find(|(k, _)| !known.contains(&k.as_str())) {
      Some((k, _)) => Err(Failure::Usage(format!("unknown option --{k} for {cmd}"))),
      None => Ok(()),
    }
  };
  let option = |name: &str| options.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
  let want = |n: usize| -> Result<(), Failure> {
    if positional.len() == n {
      Ok(())
    } else {
      Err(Failure::Usage(format!(
        "{cmd} takes {n} argument(s), got {}",
        positional.len()
      )))
    }
  };
  match cmd {
    "manifest" => {
      want(2)?;
      allow(&[])?;
      let (root, out) = (PathBuf::from(&positional[0]), PathBuf::from(&positional[1]));
      let m = manifest::build(&root)?;
      manifest::write(&out, &m)?;
      println!("Manifest of {} files written to {}", m.files.len(), out.display());
      Ok(ExitCode::SUCCESS)
    }
    "diff" => {
      want(2)?;
      allow(&[])?;
      let a = manifest::read(&PathBuf::from(&positional[0]))?;
      let b = manifest::read(&PathBuf::from(&positional[1]))?;
      let lines = manifest::diff(&a, &b);
      if lines.is_empty() {
        println!("Identical");
        return Ok(ExitCode::SUCCESS);
      }
      println!("{} files changed:", lines.len());
      for line in &lines {
        println!("{line}");
      }
      Ok(ExitCode::from(1))
    }
    "fixture-lib" => {
      want(1)?;
      allow(&["json"])?;
      let dir = PathBuf::from(&positional[0]);
      let report = fixtures::generate(&dir, &fixtures::FixtureSpec::default())?;
      println!(
        "Fixture library: {} tracks, {} playlists in {}",
        report.tracks.len(),
        report.playlists.len(),
        dir.display()
      );
      if let Some(out) = option("json") {
        let out = PathBuf::from(out);
        std::fs::write(&out, fixtures::export_json(&report))
          .map_err(|e| Failure::Error(format!("{}: {e}", out.display())))?;
        println!("UI fixture JSON written to {}", out.display());
      }
      Ok(ExitCode::SUCCESS)
    }
    "fetch-sidecars" => {
      want(1)?;
      allow(&["triple", "base"])?;
      fetch_sidecars(PathBuf::from(&positional[0]), option("triple"), option("base"))
    }
    "self-test" => {
      want(0)?;
      allow(&[])?;
      let lines = fixtures::self_test_lines();
      let failed = lines.iter().filter(|(ok, _)| !ok).count();
      for (ok, line) in &lines {
        println!("{} {line}", if *ok { "PASS" } else { "FAIL" });
      }
      println!("{} passed, {failed} failed", lines.len() - failed);
      Ok(if failed == 0 {
        ExitCode::SUCCESS
      } else {
        ExitCode::from(1)
      })
    }
    other => Err(Failure::Usage(format!("unknown command {other}"))),
  }
}

/// `--name value` pairs, in command-line order.
type Options = Vec<(String, OsString)>;

/// Separates `--name value` pairs from positional arguments.
fn split_options(args: &[OsString]) -> Result<(Vec<OsString>, Options), Failure> {
  let (mut positional, mut options) = (Vec::new(), Vec::new());
  let mut it = args.iter();
  while let Some(a) = it.next() {
    match a.to_str().and_then(|s| s.strip_prefix("--")) {
      Some(name) => {
        let value = it
          .next()
          .ok_or_else(|| Failure::Usage(format!("--{name} needs a value")))?;
        options.push((name.to_string(), value.clone()));
      }
      None => positional.push(a.clone()),
    }
  }
  Ok((positional, options))
}

/// Fills `dir` with `yt-dlp-<triple>[.exe]` and `deno-<triple>[.exe]`, the names Tauri's
/// `externalBin` expects, verified against the pins and the published checksums.
#[cfg(not(target_os = "android"))]
fn fetch_sidecars(dir: PathBuf, triple: Option<OsString>, base: Option<OsString>) -> Result<ExitCode, Failure> {
  use soundhood_core::sidecars::{self, Asset};
  let triple = match triple {
    Some(t) => t
      .to_str()
      .map(str::to_string)
      .ok_or_else(|| Failure::Usage("--triple is not text".into()))?,
    None => sidecars::host_triple()
      .map(str::to_string)
      .ok_or_else(|| Failure::Usage("no sidecars for this platform; pass --triple".into()))?,
  };
  let base = match base {
    Some(b) => Some(
      b.to_str()
        .map(str::to_string)
        .ok_or_else(|| Failure::Usage("--base is not text".into()))?,
    ),
    None => None,
  };
  let assets = [
    Asset::ytdlp_bootstrap(&triple)?.installed_as(sidecars::exe_name(&format!("yt-dlp-{triple}"), &triple)),
    Asset::deno_pinned(&triple)?.installed_as(sidecars::exe_name(&format!("deno-{triple}"), &triple)),
  ];
  for asset in &assets {
    let report = sidecars::fetch(asset, &dir, base.as_deref())?;
    for line in &report.log {
      println!("{line}");
    }
  }
  Ok(ExitCode::SUCCESS)
}

#[cfg(target_os = "android")]
fn fetch_sidecars(_: PathBuf, _: Option<OsString>, _: Option<OsString>) -> Result<ExitCode, Failure> {
  Err(Failure::Error("sidecars are desktop-only".into()))
}
