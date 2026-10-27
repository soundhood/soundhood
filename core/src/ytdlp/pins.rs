//! Pinned sidecar releases for the desktop sidecar manager (build brief 1.5).
//!
//! The pin table is a floor, not a ceiling: `MIN_YTDLP_VERSION` is the oldest yt-dlp the manager
//! accepts, the bootstrap hashes cover the first fetch, and "Update helper" may fetch any newer
//! yt-dlp release as long as that release's own `SHA2-256SUMS` verifies. Deno is pinned to one
//! release (its hash rarely changes) and verified against both the pin and its `.sha256sum` file.
//!
//! Sources (read 2026-10-27):
//! - https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest (tag 2026.10.26)
//! - https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS
//! - https://api.github.com/repos/denoland/deno/releases/latest (tag v2.9.8)
//! - https://github.com/denoland/deno/releases/download/v2.9.8/deno-<triple>.zip.sha256sum

/// Oldest yt-dlp the sidecar manager installs. Older executables are MITM-vulnerable (the
/// 2026.10.21 advisory) and miss current YouTube fixes; the manager refuses them.
pub const MIN_YTDLP_VERSION: &str = "2026.10.26";

/// The yt-dlp release fetched on first enable.
pub const YTDLP_BOOTSTRAP_VERSION: &str = "2026.10.26";

/// The deno release used as yt-dlp's JavaScript runtime on desktop.
pub const DENO_VERSION: &str = "2.9.8";

/// One pinned release asset for one target triple.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PinnedAsset {
  pub triple: &'static str,
  /// Release asset file name.
  pub name: &'static str,
  /// Lower-case hex SHA-256 of the asset as published.
  pub sha256: &'static str,
}

/// Standalone yt-dlp executables of `YTDLP_BOOTSTRAP_VERSION` (no Python needed).
/// `yt-dlp_macos` is a universal binary, so both macOS triples use it.
pub const YTDLP_BOOTSTRAP: &[PinnedAsset] = &[
  PinnedAsset {
    triple: "x86_64-pc-windows-msvc",
    name: "yt-dlp.exe",
    sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
  },
  PinnedAsset {
    triple: "aarch64-pc-windows-msvc",
    name: "yt-dlp_arm64.exe",
    sha256: "0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98",
  },
  PinnedAsset {
    triple: "x86_64-unknown-linux-gnu",
    name: "yt-dlp_linux",
    sha256: "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795",
  },
  PinnedAsset {
    triple: "aarch64-unknown-linux-gnu",
    name: "yt-dlp_linux_aarch64",
    sha256: "e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483",
  },
  PinnedAsset {
    triple: "x86_64-apple-darwin",
    name: "yt-dlp_macos",
    sha256: "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa",
  },
  PinnedAsset {
    triple: "aarch64-apple-darwin",
    name: "yt-dlp_macos",
    sha256: "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa",
  },
];

/// Deno `DENO_VERSION` release zips (each holds a single `deno` / `deno.exe`).
pub const DENO: &[PinnedAsset] = &[
  PinnedAsset {
    triple: "x86_64-pc-windows-msvc",
    name: "deno-x86_64-pc-windows-msvc.zip",
    sha256: "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
  },
  PinnedAsset {
    triple: "aarch64-pc-windows-msvc",
    name: "deno-aarch64-pc-windows-msvc.zip",
    sha256: "b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef",
  },
  PinnedAsset {
    triple: "x86_64-unknown-linux-gnu",
    name: "deno-x86_64-unknown-linux-gnu.zip",
    sha256: "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609",
  },
  PinnedAsset {
    triple: "aarch64-unknown-linux-gnu",
    name: "deno-aarch64-unknown-linux-gnu.zip",
    sha256: "d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905",
  },
  PinnedAsset {
    triple: "x86_64-apple-darwin",
    name: "deno-x86_64-apple-darwin.zip",
    sha256: "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
  },
  PinnedAsset {
    triple: "aarch64-apple-darwin",
    name: "deno-aarch64-apple-darwin.zip",
    sha256: "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
  },
];

/// The bootstrap yt-dlp asset for `triple`, if one is published.
pub fn ytdlp_bootstrap(triple: &str) -> Option<&'static PinnedAsset> {
  YTDLP_BOOTSTRAP.iter().find(|p| p.triple == triple)
}

/// The yt-dlp release asset name for `triple` in any release (same naming every release).
pub fn ytdlp_asset_name(triple: &str) -> Option<&'static str> {
  ytdlp_bootstrap(triple).map(|p| p.name)
}

/// The pinned deno zip for `triple`, if one is published.
pub fn deno(triple: &str) -> Option<&'static PinnedAsset> {
  DENO.iter().find(|p| p.triple == triple)
}

/// Compares dotted numeric versions ("2026.10.26", "2026.10.26.232405", "2.9.8"); a missing
/// component counts as 0. `None` when either side has a non-numeric component.
pub fn compare_versions(a: &str, b: &str) -> Option<std::cmp::Ordering> {
  let parse = |v: &str| -> Option<Vec<u64>> {
    v.trim()
      .trim_start_matches('v')
      .split('.')
      .map(|p| p.parse::<u64>().ok())
      .collect()
  };
  let (a, b) = (parse(a)?, parse(b)?);
  for i in 0..a.len().max(b.len()) {
    let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
    if x != y {
      return Some(x.cmp(&y));
    }
  }
  Some(std::cmp::Ordering::Equal)
}

/// True when `version` is at or above `MIN_YTDLP_VERSION`. Unparseable versions are refused.
pub fn ytdlp_version_allowed(version: &str) -> bool {
  matches!(
    compare_versions(version, MIN_YTDLP_VERSION),
    Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cmp::Ordering;

  #[test]
  fn hashes_are_lowercase_sha256_hex() {
    for p in YTDLP_BOOTSTRAP.iter().chain(DENO) {
      assert_eq!(p.sha256.len(), 64, "{}", p.name);
      assert!(
        p.sha256
          .bytes()
          .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "{}",
        p.name
      );
    }
  }

  #[test]
  fn every_desktop_triple_has_both_sidecars() {
    for t in [
      "x86_64-pc-windows-msvc",
      "aarch64-pc-windows-msvc",
      "x86_64-unknown-linux-gnu",
      "aarch64-unknown-linux-gnu",
      "x86_64-apple-darwin",
      "aarch64-apple-darwin",
    ] {
      assert!(ytdlp_bootstrap(t).is_some(), "yt-dlp {t}");
      assert_eq!(deno(t).map(|d| d.name.to_string()), Some(format!("deno-{t}.zip")));
    }
    assert_eq!(ytdlp_asset_name("x86_64-pc-windows-msvc"), Some("yt-dlp.exe"));
    assert!(ytdlp_bootstrap("aarch64-linux-android").is_none());
  }

  #[test]
  fn bootstrap_is_not_below_the_floor() {
    assert!(ytdlp_version_allowed(YTDLP_BOOTSTRAP_VERSION));
  }

  #[test]
  fn version_ordering() {
    assert_eq!(compare_versions("2026.10.26", "2026.10.26"), Some(Ordering::Equal));
    assert_eq!(
      compare_versions("2026.10.26.232405", "2026.10.26"),
      Some(Ordering::Greater)
    );
    assert_eq!(compare_versions("2026.9.30", "2026.10.26"), Some(Ordering::Less));
    assert_eq!(compare_versions("v2.9.8", "2.10.0"), Some(Ordering::Less));
    assert_eq!(compare_versions("2026.10.x", "2026.10.26"), None);
    assert!(ytdlp_version_allowed("2027.01.01"));
    assert!(!ytdlp_version_allowed("2026.10.21"));
    assert!(!ytdlp_version_allowed("latest"));
  }
}
