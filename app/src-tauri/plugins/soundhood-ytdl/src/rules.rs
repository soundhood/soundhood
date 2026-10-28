//! What the phone refuses before Kotlin is asked to do anything. The channel rule is the core's
//! (`soundhood_core::ytdlp::args::is_channel_link`), the same function the desktop host calls, so
//! the phone and the PC refuse the same links. Kotlin is reached only through these commands
//! (`run_kotlin` after the checks); it keeps its own web-link, `..` and fixture-marker checks.

use std::path::Path;

pub use soundhood_core::ytdlp::args::is_channel_link;

/// The file that marks a generated fixture library; the same name as
/// `soundhood_core::fixtures::MARKER` (the host's tests check that the two stay equal).
pub const FIXTURE_MARKER: &str = ".soundhood-fixture";

/// What the UI shows when a channel link is refused, on the phone and on the PC. The same sentence
/// as the UI's `CHANNEL_REFUSAL`; both are checked against `tools/screenshot/channel-links.json`.
//
// TODO(after the Phase 0 round-2 merge): use `soundhood_core::ytdlp::args::CHANNEL_REFUSED` here
// once the core carries this sentence, and drop the literal.
pub const CHANNEL_REFUSED: &str = "Whole channels are not downloaded. Use a single video or a playlist link.";

/// What the UI shows when sync is asked for while the fixture library is the library.
pub const SYNC_OFF_FOR_FIXTURE: &str = "Sync is off while the test library is shown";

/// True when `library_dir` is a generated fixture library (it holds the marker file). Syncing it
/// would upload test tracks and playlists into the real Proton Drive library.
pub fn is_fixture_library(library_dir: &Path) -> bool {
  library_dir.join(FIXTURE_MARKER).is_file()
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The shared test vectors: the UI's vitest suite reads the same file.
  const VECTORS: &str = include_str!("../../../../../tools/screenshot/channel-links.json");

  fn vectors() -> serde_json::Value {
    serde_json::from_str(VECTORS).expect("channel-links.json parses")
  }

  fn list(v: &serde_json::Value, key: &str) -> Vec<String> {
    v[key]
      .as_array()
      .unwrap_or_else(|| panic!("{key} is a list"))
      .iter()
      .map(|u| u.as_str().expect("a string").to_string())
      .collect()
  }

  #[test]
  fn the_shared_channel_vectors_hold_for_the_core_rule() {
    let v = vectors();
    let channels = list(&v, "channel");
    let others = list(&v, "notChannel");
    assert!(channels.len() >= 40 && others.len() >= 30, "the vector file lost entries");
    for url in &channels {
      assert!(is_channel_link(url), "{url:?} is a channel link");
    }
    for url in &others {
      assert!(!is_channel_link(url), "{url:?} is not a channel link");
    }
  }

  #[test]
  fn the_refusal_reads_the_same_everywhere() {
    assert_eq!(vectors()["refusal"].as_str(), Some(CHANNEL_REFUSED));
    assert!(!CHANNEL_REFUSED.contains(['\u{2013}', '\u{2014}']));
  }

  #[test]
  fn a_fixture_library_is_known_by_its_marker() {
    let tmp = std::env::temp_dir().join(format!("soundhood-ytdl-fixture-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    assert!(!is_fixture_library(&tmp));
    std::fs::write(tmp.join(FIXTURE_MARKER), b"").unwrap();
    assert!(is_fixture_library(&tmp));
    std::fs::remove_dir_all(&tmp).unwrap();
  }
}
