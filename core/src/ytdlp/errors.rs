//! Classifies yt-dlp console lines into the outcomes the download fallback ladder acts on
//! (build brief 5.6). Phase 0 seeds the classifier; Phase 2 builds the ladder on top of it.
//! Matching is on lower-cased substrings of yt-dlp's own wording, so a reworded message degrades
//! to `Other` instead of being misread.
//!
//! Only lines that carry yt-dlp's own messages are read: `ERROR:` and `WARNING:` lines, its
//! `[download] Got error:` retry lines, and two `[download]` status lines (the archive skip and
//! the site-mandated wait). Every other line can hold a title or a path ("Destination: Too Many
//! Requests - X.m4a"), so it is `Other` whatever words it contains.

use serde::Serialize;

/// What a line (or a whole transcript) means for the next step.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Kind {
  /// "Sign in to confirm you're not a bot" / the IP is being blocked: stop, never loop.
  BotWall,
  /// HTTP 429 or YouTube's session rate limit: hard stop and cool down.
  #[serde(rename = "rate_limited_429")]
  RateLimited429,
  /// No JavaScript runtime, or the n/signature challenge failed: repair the runtime.
  MissingJsRuntime,
  /// The per-device download archive already has this item: not an error.
  AlreadyInArchive,
  /// The site-mandated pre-roll wait: a status, not a hang.
  SiteWait { seconds: u32 },
  /// Timeouts, resets, 5xx, fragment errors, "try again later": back off and retry.
  Transient,
  /// DRM-protected media: never retried, never worked around.
  Drm,
  /// Private, removed, age- or members-restricted, geo-blocked.
  Unavailable,
  /// Anything else (including ordinary progress lines).
  Other,
}

/// One classification. `error` is true when yt-dlp reported a fatal `ERROR:` line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Classified {
  pub kind: Kind,
  pub error: bool,
}

/// Classifies one stdout/stderr line.
pub fn classify(line: &str) -> Classified {
  let trimmed = line.trim();
  let error = trimmed.starts_with("ERROR:");
  // yt-dlp prints YouTube's typographic apostrophe ("you’re") in some messages.
  let l = trimmed.to_lowercase().replace('\u{2019}', "'");
  let kind = if error || trimmed.starts_with("WARNING:") || trimmed.starts_with("[download] Got error:") {
    message_kind(&l)
  } else if let Some(status) = l.strip_prefix("[download] ") {
    // "[download] <id>: <title> has already been recorded in the archive": the title sits in
    // the middle, so only the fixed ending decides.
    if status.ends_with("has already been recorded in the archive") {
      Kind::AlreadyInArchive
    } else if let Some(seconds) = site_wait_seconds(status) {
      Kind::SiteWait { seconds }
    } else {
      Kind::Other
    }
  } else {
    Kind::Other
  };
  Classified { kind, error }
}

/// The kind of one of yt-dlp's own messages (lower-cased, straight apostrophes).
fn message_kind(l: &str) -> Kind {
  let has = |needles: &[&str]| needles.iter().any(|n| l.contains(n));
  if has(&["drm protected", "drm-protected"]) {
    Kind::Drm
  } else if has(&[
    "http error 429",
    "too many requests",
    "rate-limited",
    "rate limited",
    // YouTube's session rate limit, also without yt-dlp's explanation after it. Checked before
    // the generic "try again later" (transient) and "video unavailable" needles below.
    "content isn't available, try again later",
    "content is not available, try again later",
  ]) {
    Kind::RateLimited429
  } else if has(&[
    "confirm you're not a bot",
    "ip is likely being blocked",
    "all player responses are invalid",
  ]) {
    Kind::BotWall
  } else if has(&[
    "no supported javascript runtime",
    "n challenge solving failed",
    "signature solving failed",
    "nsig extraction failed",
    "challenge solver",
  ]) {
    Kind::MissingJsRuntime
  } else if has(&[
    "video unavailable",
    "private video",
    "this video is private",
    "members-only",
    "members only",
    "join this channel",
    "confirm your age",
    "age-restricted",
    "age restricted",
    "has been removed",
    "not available in your country",
    "available in your country",
    "account associated with this video has been terminated",
    "this video is not available",
    "premieres in",
    "this live event will begin",
  ]) {
    Kind::Unavailable
  } else if has_http_5xx(l)
    || has(&[
      "try again later",
      "timed out",
      "connection reset",
      "connection aborted",
      "connection refused",
      "remote end closed connection",
      "incompleteread",
      "incomplete read",
      "temporary failure in name resolution",
      "getaddrinfo failed",
      "eof occurred in violation of protocol",
      "[errno 104]",
    ])
    || (l.contains("fragment") && has(&["not found", "unable to continue", "retrying fragment"]))
  {
    Kind::Transient
  } else {
    Kind::Other
  }
}

/// Classifies a whole transcript: the most consequential kind found on any line (bot wall and
/// rate limit first, because they decide whether the ladder may continue at all), with `error`
/// set when any line is a fatal `ERROR:`.
pub fn classify_output(text: &str) -> Classified {
  let lines: Vec<Classified> = text.lines().map(classify).collect();
  let error = lines.iter().any(|c| c.error);
  let rank = |k: &Kind| match k {
    Kind::BotWall => 0,
    Kind::RateLimited429 => 1,
    Kind::Drm => 2,
    Kind::MissingJsRuntime => 3,
    Kind::Unavailable => 4,
    Kind::Transient => 5,
    Kind::AlreadyInArchive => 6,
    Kind::SiteWait { .. } => 7,
    Kind::Other => 8,
  };
  let kind = lines.iter().map(|c| c.kind).min_by_key(rank).unwrap_or(Kind::Other);
  Classified { kind, error }
}

/// "sleeping 5.25 seconds as required by the site..." (a lower-cased `[download]` status, the
/// prefix already removed) -> 6, rounded up. The status must start with it: a destination path
/// with those words in its name is not a wait.
fn site_wait_seconds(status: &str) -> Option<u32> {
  let rest = status.strip_prefix("sleeping ")?;
  let (num, after) = rest.split_once(' ')?;
  if !after.starts_with("seconds as required by the site") {
    return None;
  }
  let secs: f64 = num.parse().ok()?;
  (secs.is_finite() && secs >= 0.0).then(|| secs.ceil().min(u32::MAX as f64) as u32)
}

fn has_http_5xx(l: &str) -> bool {
  l.match_indices("http error 5").any(|(i, m)| {
    let tail = &l.as_bytes()[i + m.len()..];
    tail.len() >= 2 && tail[0].is_ascii_digit() && tail[1].is_ascii_digit()
  })
}

/// The bundled transcript corpus (`core/fixtures/ytdlp`): name, text, expected classification.
/// Used by the tests and by the in-app self-test.
pub fn corpus() -> Vec<(&'static str, &'static str, Classified)> {
  let c = |kind, error| Classified { kind, error };
  vec![
    (
      "bot_wall",
      include_str!("../../fixtures/ytdlp/bot_wall.txt"),
      c(Kind::BotWall, true),
    ),
    (
      "bot_wall_ip_blocked",
      include_str!("../../fixtures/ytdlp/bot_wall_ip_blocked.txt"),
      c(Kind::BotWall, true),
    ),
    (
      "rate_limited_429",
      include_str!("../../fixtures/ytdlp/rate_limited_429.txt"),
      c(Kind::RateLimited429, true),
    ),
    (
      "rate_limited_session",
      include_str!("../../fixtures/ytdlp/rate_limited_session.txt"),
      c(Kind::RateLimited429, true),
    ),
    (
      "rate_limited_session_short",
      include_str!("../../fixtures/ytdlp/rate_limited_session_short.txt"),
      c(Kind::RateLimited429, true),
    ),
    (
      "missing_js_runtime",
      include_str!("../../fixtures/ytdlp/missing_js_runtime.txt"),
      c(Kind::MissingJsRuntime, true),
    ),
    (
      "already_in_archive",
      include_str!("../../fixtures/ytdlp/already_in_archive.txt"),
      c(Kind::AlreadyInArchive, false),
    ),
    (
      "already_in_archive_trigger_title",
      include_str!("../../fixtures/ytdlp/already_in_archive_trigger_title.txt"),
      c(Kind::AlreadyInArchive, false),
    ),
    (
      "site_wait",
      include_str!("../../fixtures/ytdlp/site_wait.txt"),
      c(Kind::SiteWait { seconds: 6 }, false),
    ),
    (
      "transient_503",
      include_str!("../../fixtures/ytdlp/transient_503.txt"),
      c(Kind::Transient, true),
    ),
    (
      "transient_fragment",
      include_str!("../../fixtures/ytdlp/transient_fragment.txt"),
      c(Kind::Transient, true),
    ),
    ("drm", include_str!("../../fixtures/ytdlp/drm.txt"), c(Kind::Drm, true)),
    (
      "unavailable_private",
      include_str!("../../fixtures/ytdlp/unavailable_private.txt"),
      c(Kind::Unavailable, true),
    ),
    (
      "unavailable_age",
      include_str!("../../fixtures/ytdlp/unavailable_age.txt"),
      c(Kind::Unavailable, true),
    ),
    (
      "unavailable_removed",
      include_str!("../../fixtures/ytdlp/unavailable_removed.txt"),
      c(Kind::Unavailable, true),
    ),
    ("ok", include_str!("../../fixtures/ytdlp/ok.txt"), c(Kind::Other, false)),
    (
      "ok_trigger_titles",
      include_str!("../../fixtures/ytdlp/ok_trigger_titles.txt"),
      c(Kind::Other, false),
    ),
  ]
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn corpus_transcripts_classify_as_named() {
    for (name, text, want) in corpus() {
      assert_eq!(classify_output(text), want, "{name}");
    }
  }

  #[test]
  fn fatal_line_of_each_failing_transcript_carries_the_kind_itself() {
    for (name, text, want) in corpus() {
      if !want.error {
        continue;
      }
      let last_error = text.lines().rfind(|l| l.starts_with("ERROR:")).unwrap();
      let got = classify(last_error);
      assert!(got.error, "{name}");
      // The missing-runtime transcript ends in a generic format error; the cause is a warning.
      if name != "missing_js_runtime" {
        assert_eq!(got.kind, want.kind, "{name}: {last_error}");
      }
    }
  }

  #[test]
  fn single_lines() {
    let k = |l: &str| classify(l).kind;
    assert_eq!(
      k("ERROR: [youtube] x: Sign in to confirm you're not a bot."),
      Kind::BotWall
    );
    assert_eq!(
      k("ERROR: [youtube] x: Sign in to confirm you\u{2019}re not a bot."),
      Kind::BotWall
    );
    assert_eq!(k("ERROR: [youtube] x: Sign in to confirm your age."), Kind::Unavailable);
    assert_eq!(
      k("WARNING: [youtube] HTTP Error 429: Too Many Requests"),
      Kind::RateLimited429
    );
    assert_eq!(
      k("[download] Sleeping 6.00 seconds as required by the site..."),
      Kind::SiteWait { seconds: 6 }
    );
    assert_eq!(
      k("[download] Sleeping 0 seconds as required by the site..."),
      Kind::SiteWait { seconds: 0 }
    );
    // The configured pause between items is not a site wait.
    assert_eq!(k("[download] Sleeping 5.00 seconds ..."), Kind::Other);
    assert_eq!(
      k("ERROR: unable to download video data: HTTP Error 502: Bad Gateway"),
      Kind::Transient
    );
    assert_eq!(
      k("ERROR: unable to download video data: HTTP Error 403: Forbidden"),
      Kind::Other
    );
    assert_eq!(k("ERROR: unable to download video data: HTTP Error 5"), Kind::Other);
    assert_eq!(
      k("[download] x: T has already been recorded in the archive"),
      Kind::AlreadyInArchive
    );
    assert_eq!(k("ERROR: [youtube] x: This video is DRM protected"), Kind::Drm);
    assert_eq!(
      k("[download]  42.0% of    3.21MiB at  1.00MiB/s ETA 00:02"),
      Kind::Other
    );
    assert_eq!(k(""), Kind::Other);
    assert!(!classify("WARNING: [youtube] No supported JavaScript runtime could be found.").error);
  }

  #[test]
  fn titles_never_decide_the_outcome() {
    for title in [
      "Too Many Requests - Paper Comets",
      "Members Only - Harbor Lights",
      "Try Again Later - Glass Tide",
      "Private Video - Northern Static",
      "Rate Limited - Neon Pines",
      "HTTP Error 503 - Static Bloom",
      "Sign in to confirm you're not a bot - Velvet Ferry",
      "This video is DRM protected - Amber Tapes",
      "Sleeping 5 seconds as required by the site - Lunar Garden",
    ] {
      let text = format!(
        "[youtube] Extracting URL: https://www.youtube.com/watch?v=Nm7qW3eRt5Y\n\
         [info] Nm7qW3eRt5Y: Downloading 1 format(s): 140\n\
         [download] Destination: incoming\\job-0004\\{title}.m4a\n\
         [download] 100% of    3.21MiB in 00:00:01 at 2.71MiB/s\n\
         [ExtractAudio] Not converting audio incoming\\job-0004\\{title}.m4a; file is already in target format m4a\n\
         [Metadata] Adding metadata to \"incoming\\job-0004\\{title}.m4a\"\n\
         [EmbedThumbnail] ffmpeg: Adding thumbnail to \"incoming\\job-0004\\{title}.m4a\"\n"
      );
      let got = classify_output(&text);
      assert_eq!(
        got,
        Classified {
          kind: Kind::Other,
          error: false
        },
        "{title}"
      );
    }
  }

  #[test]
  fn an_archive_skip_wins_over_trigger_words_in_its_title() {
    for line in [
      "[download] Rate Limited - Neon Pines has already been recorded in the archive",
      "[download] Xk3vQ9pLm2A: Too Many Requests - Paper Comets has already been recorded in the archive",
      "[download] Xk3vQ9pLm2A: Video Unavailable has already been recorded in the archive",
    ] {
      assert_eq!(classify(line).kind, Kind::AlreadyInArchive, "{line}");
    }
  }

  #[test]
  fn the_session_rate_limit_without_its_explanation_is_still_a_rate_limit() {
    for line in [
      "ERROR: [youtube] Bc5yU2kRn8F: This content isn't available, try again later.",
      "ERROR: [youtube] Bc5yU2kRn8F: Video unavailable. This content isn't available, try again later.",
      "ERROR: [youtube] Bc5yU2kRn8F: This content isn\u{2019}t available, try again later.",
      "WARNING: [youtube] Bc5yU2kRn8F: This content is not available, try again later.",
    ] {
      assert_eq!(classify(line).kind, Kind::RateLimited429, "{line}");
    }
    // Plain "try again later" without the session wording stays a retry.
    assert_eq!(
      classify("ERROR: [youtube] x: Something went wrong, try again later").kind,
      Kind::Transient
    );
  }

  #[test]
  fn odd_site_waits() {
    for (line, want) in [
      ("[download] Sleeping nan seconds as required by the site...", None),
      ("[download] Sleeping inf seconds as required by the site...", None),
      ("[download] Sleeping -3 seconds as required by the site...", None),
      (
        "[download] Sleeping 1e12 seconds as required by the site...",
        Some(u32::MAX),
      ),
      ("[download] Sleeping 59.01 seconds as required by the site...", Some(60)),
      ("[youtube] Sleeping 5 seconds as required by the site...", None),
      (
        "[download] Destination: Sleeping 5 seconds as required by the site.m4a",
        None,
      ),
    ] {
      let secs = match classify(line).kind {
        Kind::SiteWait { seconds } => Some(seconds),
        _ => None,
      };
      assert_eq!(secs, want, "{line}");
    }
  }

  #[test]
  fn only_ytdlp_messages_are_read() {
    let k = |l: &str| classify(l).kind;
    // yt-dlp's own retry lines are read like warnings.
    assert_eq!(
      k("[download] Got error: HTTP Error 429: Too Many Requests. Retrying (1/10)..."),
      Kind::RateLimited429
    );
    assert_eq!(
      k("[download] Got error: The read operation timed out. Retrying (1/10)..."),
      Kind::Transient
    );
    // Anything else with the same words is not.
    for line in [
      "[youtube] Bc5yU2kRn8F: HTTP Error 429: Too Many Requests",
      "[download] Downloading playlist: Too Many Requests",
      "[info] Members Only - Harbor Lights: Downloading 1 format(s): 140",
      "Too Many Requests",
      "error: too many requests",
    ] {
      assert_eq!(k(line), Kind::Other, "{line}");
    }
  }

  #[test]
  fn serialises_with_snake_case_tags() {
    let s = serde_json::to_string(&Kind::SiteWait { seconds: 6 }).unwrap();
    assert_eq!(s, r#"{"kind":"site_wait","seconds":6}"#);
    let s = serde_json::to_string(&Kind::RateLimited429).unwrap();
    assert_eq!(s, r#"{"kind":"rate_limited_429"}"#);
  }
}
