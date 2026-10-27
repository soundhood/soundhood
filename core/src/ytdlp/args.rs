//! The desktop yt-dlp argument list, ported verbatim from the pre-rebuild host
//! (`ytdlp_download_audio`). Phase 2 replaces the arg set (build brief 5.6); until then this
//! reproduces the old argv exactly, plus one safety change (`--` before the URL, and only http(s)
//! links accepted), and the tests below pin it.

use crate::error::{Error, Result};
use std::path::PathBuf;

/// Drops bracketed junk groups ("(Official Video)", "[Lyrics]", "(4K)", ...) from the title before
/// the file name is assembled.
pub const TITLE_JUNK: &str = r"(?i)\s*[\(\[][^\)\]]*\b(official|lyrics?|audio|visuali[sz]er|4k|hd|hq|music video|video|clip|full album|full)\b[^\)\]]*[\)\]]";

/// Sets `mh_name` to "Track - Artist" only when YouTube knows both fields: a missing field renders
/// as "NA", which the lookaheads reject, so the output template falls back to the cleaned title.
pub const MH_NAME_PARSE: &str = r"%(track)s - %(artist)s:(?P<mh_name>(?!NA - ).+ - (?!NA$).+)";

/// File name template, joined onto the output folder.
pub const OUTPUT_TEMPLATE: &str = "%(mh_name,title)s.%(ext)s";

/// The variable parts of one desktop download. The host resolves every path; this module only
/// assembles the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadArgs {
  /// The link exactly as the user gave it.
  pub url: String,
  /// `--yes-playlist` when true, `--no-playlist` otherwise.
  pub playlist: bool,
  /// The deno executable handed to yt-dlp as its JavaScript runtime.
  pub deno: PathBuf,
  /// A bundled ffmpeg; `None` = yt-dlp finds one on PATH.
  pub ffmpeg: Option<PathBuf>,
  /// `<app config>/cookies.txt`, only when that file exists.
  pub cookies: Option<PathBuf>,
  /// Absolute output folder (`<root>/<target folder>`).
  pub out_dir: PathBuf,
}

/// The argv (without the program name) the pre-rebuild desktop host passed to the yt-dlp sidecar,
/// with `--` before the URL. Refuses anything but an `http://` or `https://` link: the URL may come
/// from a paste, a share or the synced queue file, and must never reach yt-dlp as an option
/// (`--exec ...`) or as a local file / other scheme.
pub fn build(a: &DownloadArgs) -> Result<Vec<String>> {
  if !is_web_link(&a.url) {
    return Err(Error::Refused(format!("not a web link: {}", a.url)));
  }
  let mut argv: Vec<String> = vec![
    (if a.playlist { "--yes-playlist" } else { "--no-playlist" }).into(),
    "--js-runtimes".into(),
    format!("deno:{}", a.deno.to_string_lossy()),
  ];
  if let Some(ffmpeg) = &a.ffmpeg {
    argv.push("--ffmpeg-location".into());
    argv.push(ffmpeg.to_string_lossy().to_string());
  }
  if let Some(cookies) = &a.cookies {
    argv.push("--cookies".into());
    argv.push(cookies.to_string_lossy().to_string());
  }
  let output_template = a.out_dir.join(OUTPUT_TEMPLATE).to_string_lossy().to_string();
  // Order matters: clean the title first, then parse it into `mh_name`.
  argv.extend(
    [
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--replace-in-metadata",
      "title",
      TITLE_JUNK,
      "",
      "--replace-in-metadata",
      "title",
      r"\s{2,}",
      " ",
      "--parse-metadata",
      MH_NAME_PARSE,
      "-o",
      output_template.as_str(),
      "--windows-filenames",
      "--trim-filenames",
      "200",
      "--embed-metadata",
      "--embed-thumbnail",
      "--extract-audio",
      "--audio-format",
      "m4a",
      "--no-progress",
      "--console-title",
      // End of options: whatever follows is a URL, never a flag.
      "--",
      a.url.as_str(),
    ]
    .iter()
    .map(|s| s.to_string()),
  );
  Ok(argv)
}

/// True for a link that starts with `http://` or `https://` (scheme case-insensitive).
pub fn is_web_link(url: &str) -> bool {
  let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
  lower.starts_with("http://") || lower.starts_with("https://")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[cfg(windows)]
  const DIR: &str = r"C:\Lib\Downloads";
  #[cfg(windows)]
  const OUT: &str = r"C:\Lib\Downloads\%(mh_name,title)s.%(ext)s";
  #[cfg(not(windows))]
  const DIR: &str = "/lib/Downloads";
  #[cfg(not(windows))]
  const OUT: &str = "/lib/Downloads/%(mh_name,title)s.%(ext)s";

  const URL: &str = "https://www.youtube.com/watch?v=AbCdEfGhIjK";

  fn base() -> DownloadArgs {
    DownloadArgs {
      url: URL.into(),
      playlist: false,
      deno: PathBuf::from("/b/deno.exe"),
      ffmpeg: None,
      cookies: None,
      out_dir: PathBuf::from(DIR),
    }
  }

  fn tail() -> Vec<&'static str> {
    vec![
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--replace-in-metadata",
      "title",
      r"(?i)\s*[\(\[][^\)\]]*\b(official|lyrics?|audio|visuali[sz]er|4k|hd|hq|music video|video|clip|full album|full)\b[^\)\]]*[\)\]]",
      "",
      "--replace-in-metadata",
      "title",
      r"\s{2,}",
      " ",
      "--parse-metadata",
      r"%(track)s - %(artist)s:(?P<mh_name>(?!NA - ).+ - (?!NA$).+)",
      "-o",
      OUT,
      "--windows-filenames",
      "--trim-filenames",
      "200",
      "--embed-metadata",
      "--embed-thumbnail",
      "--extract-audio",
      "--audio-format",
      "m4a",
      "--no-progress",
      "--console-title",
      "--",
      URL,
    ]
  }

  #[test]
  fn single_link_without_extras_is_the_old_argv() {
    let mut want = vec!["--no-playlist", "--js-runtimes", "deno:/b/deno.exe"];
    want.extend(tail());
    assert_eq!(build(&base()).unwrap(), want);
  }

  #[test]
  fn playlist_with_ffmpeg_and_cookies_inserts_them_after_the_runtime() {
    let a = DownloadArgs {
      playlist: true,
      ffmpeg: Some(PathBuf::from("/b/ffmpeg.exe")),
      cookies: Some(PathBuf::from("/cfg/cookies.txt")),
      ..base()
    };
    let mut want = vec![
      "--yes-playlist",
      "--js-runtimes",
      "deno:/b/deno.exe",
      "--ffmpeg-location",
      "/b/ffmpeg.exe",
      "--cookies",
      "/cfg/cookies.txt",
    ];
    want.extend(tail());
    assert_eq!(build(&a).unwrap(), want);
  }

  #[test]
  fn cookies_alone_follow_the_runtime() {
    let a = DownloadArgs {
      cookies: Some(PathBuf::from("/cfg/cookies.txt")),
      ..base()
    };
    let argv = build(&a).unwrap();
    assert_eq!(
      &argv[..5],
      [
        "--no-playlist",
        "--js-runtimes",
        "deno:/b/deno.exe",
        "--cookies",
        "/cfg/cookies.txt"
      ]
    );
    assert_eq!(argv.len(), 3 + 2 + tail().len());
  }

  #[test]
  fn link_starting_with_a_dash_is_refused() {
    let a = DownloadArgs {
      url: "--exec=calc".into(),
      ..base()
    };
    assert!(matches!(build(&a), Err(Error::Refused(_))));
  }

  #[test]
  fn only_http_and_https_links_are_accepted() {
    for bad in [
      "",
      "file:///etc/passwd",
      "ftp://x/y",
      "youtube.com/watch?v=x",
      " https://x",
      "-https://x",
    ] {
      let a = DownloadArgs {
        url: bad.into(),
        ..base()
      };
      assert!(matches!(build(&a), Err(Error::Refused(_))), "{bad:?} must be refused");
    }
    for good in ["http://example.com/a", "HTTPS://www.youtube.com/watch?v=AbCdEfGhIjK"] {
      let a = DownloadArgs {
        url: good.into(),
        ..base()
      };
      let argv = build(&a).expect("accepted");
      assert_eq!(&argv[argv.len() - 2..], ["--", good]);
    }
  }

  #[test]
  fn the_url_follows_an_end_of_options_marker() {
    let argv = build(&base()).unwrap();
    assert_eq!(argv[argv.len() - 2], "--");
    assert_eq!(argv.last().map(String::as_str), Some(URL));
  }

  #[test]
  fn constants_are_the_old_host_strings() {
    assert_eq!(TITLE_JUNK, tail()[4]);
    assert_eq!(MH_NAME_PARSE, tail()[11]);
  }
}
