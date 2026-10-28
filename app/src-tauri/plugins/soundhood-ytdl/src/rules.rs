//! What the phone refuses before Kotlin is asked to do anything. The Kotlin plugin checks the same
//! rules again (`YtdlPlugin.isChannelLink`, the fixture marker in `protonSync`), so a call that
//! reaches it some other way is refused too.

use std::path::Path;

/// The file that marks a generated fixture library; the same name as
/// `soundhood_core::fixtures::MARKER` (the host's tests check that the two stay equal).
pub const FIXTURE_MARKER: &str = ".soundhood-fixture";

/// What the UI shows when a channel link is refused.
pub const CHANNEL_REFUSED: &str = "Channel links are not downloaded: paste a video or a playlist link";

/// What the UI shows when sync is asked for while the fixture library is the library.
pub const SYNC_OFF_FOR_FIXTURE: &str = "Sync is off while the test library is shown";

/// True for a link to a whole YouTube channel or one of its tabs: `/@name`, `/channel/<id>`,
/// `/c/<name>`, `/user/<name>`, with or without `/videos`, `/streams`, `/shorts`, `/releases`,
/// `/playlists`. Soundhood never downloads a whole channel; a playlist link is the ceiling. A single
/// video (`/watch`, `/shorts/<id>`, `youtu.be`) and a playlist (`/playlist?list=`) pass.
//
// TODO: call soundhood_core::ytdlp::args::is_channel_link (being added to the core) once this plugin
// depends on the core, and drop this copy; until then keep the two and the Kotlin twin on one rule.
pub fn is_channel_link(url: &str) -> bool {
  let lower = url.trim().to_ascii_lowercase();
  let Some(rest) = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://")) else {
    return false;
  };
  let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
  let (authority, tail) = rest.split_at(end);
  // Drop user info and port (`<userinfo>@host:443`).
  let host = authority.rsplit('@').next().unwrap_or(authority);
  let host = host.split(':').next().unwrap_or(host);
  if host != "youtube.com" && !host.ends_with(".youtube.com") {
    return false;
  }
  let path = tail.split(['?', '#']).next().unwrap_or("");
  let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
  first.starts_with('@') || matches!(first, "channel" | "c" | "user")
}

/// True when `library_dir` is a generated fixture library (it holds the marker file). Syncing it
/// would upload test tracks and playlists into the real Proton Drive library.
pub fn is_fixture_library(library_dir: &Path) -> bool {
  library_dir.join(FIXTURE_MARKER).is_file()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn channel_links_and_their_tabs_are_refused() {
    for url in [
      "https://www.youtube.com/@artist",
      "https://www.youtube.com/@artist/videos",
      "https://youtube.com/@artist/streams?view=0",
      "https://m.youtube.com/@artist/shorts",
      "https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv",
      "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/releases",
      "https://www.youtube.com/c/SomeName/videos",
      "https://www.youtube.com/user/SomeName",
      "HTTPS://WWW.YOUTUBE.COM/@Artist/playlists",
      "http://www.youtube.com:443/@artist",
      "  https://www.youtube.com/@artist  ",
    ] {
      assert!(is_channel_link(url), "{url}");
    }
  }

  #[test]
  fn videos_playlists_and_other_sites_pass() {
    for url in [
      "https://www.youtube.com/watch?v=AbCdEfGhIjK",
      "https://www.youtube.com/watch?v=AbCdEfGhIjK&list=PL123",
      "https://www.youtube.com/playlist?list=PL123",
      "https://music.youtube.com/watch?v=AbCdEfGhIjK",
      "https://www.youtube.com/shorts/AbCdEfGhIjK",
      "https://youtu.be/AbCdEfGhIjK",
      "https://www.youtube.com/watch?v=x#@artist",
      "https://example.com/@artist",
      "https://youtube.com.example.org/@artist",
      "https://soundcloud.com/user/track",
      "not a link",
      "",
    ] {
      assert!(!is_channel_link(url), "{url}");
    }
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
