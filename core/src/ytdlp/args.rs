//! The desktop yt-dlp argument list, ported verbatim from the pre-rebuild host
//! (`ytdlp_download_audio`). Phase 2 replaces the arg set (build brief 5.6); until then this
//! reproduces the old argv exactly, plus two safety changes (`--` before the URL with only http(s)
//! links accepted, and channel links refused), and the tests below pin it.

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

/// Why a channel link is refused, in the words every platform shows: the desktop UI, the desktop
/// host and the phone plugin all use this exact sentence ("use" fits a paste and a share alike).
pub const CHANNEL_REFUSED: &str = "Whole channels are not downloaded. Use a single video or a playlist link.";

/// The argv (without the program name) the pre-rebuild desktop host passed to the yt-dlp sidecar,
/// with `--` before the URL. Refuses anything but an `http://` or `https://` link: the URL may come
/// from a paste, a share or the synced queue file, and must never reach yt-dlp as an option
/// (`--exec ...`) or as a local file / other scheme. Refuses a channel link too
/// ([`is_channel_link`]): a playlist link is the most one download may ask for, and
/// `--no-playlist` does not stop a channel.
pub fn build(a: &DownloadArgs) -> Result<Vec<String>> {
  if !is_web_link(&a.url) {
    return Err(Error::Refused(format!("not a web link: {}", a.url)));
  }
  if is_channel_link(&a.url) {
    return Err(Error::Refused(CHANNEL_REFUSED.into()));
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

/// First path segments yt-dlp does not read as a channel name (its reserved names, plus the other
/// single-video forms). On a YouTube host, a first segment that is not here is a legacy channel
/// name (`youtube.com/<name>`), which yt-dlp downloads as the whole channel.
const NOT_CHANNEL: &[&str] = &[
  "watch",
  "watch_popup",
  "watch_videos",
  "movie",
  "movie_popup",
  "playlist",
  "w",
  "v",
  "e",
  "embed",
  "live",
  "clip",
  "shorts",
  "attribution_link",
  "redirect",
  "results",
  "search",
  "shared",
  "hashtag",
  "trending",
  "explore",
  "feed",
  "feeds",
  "movies",
  "storefront",
  "oembed",
  "get_video_info",
  "iframe_api",
  "s",
  "source",
  "oops",
  "index",
  "account",
  "t",
  "about",
  "upload",
  "signin",
  "logout",
];

/// True for a YouTube link that names a whole channel or one of its tabs, on any YouTube host
/// (`www.`, `m.`, `music.`, YouTube Kids): `/@name`, `/channel/<id>`, `/c/<name>`, `/user/<name>`
/// or a bare legacy name (`/<name>`), each with or without a tab (`/videos`, `/streams`,
/// `/shorts`, `/releases`, `/playlists`, `/featured`, ...); YouTube Music's `/browse/UC<id>` artist
/// page; and a channel's uploads list (`list=UU...`), which is the whole channel under a playlist
/// id. `youtu.be` links, videos, Shorts, albums and playlists are not channel links. `build`
/// refuses these; the hosts call it to explain the refusal before anything starts.
pub fn is_channel_link(url: &str) -> bool {
  if !is_web_link(url) {
    return false;
  }
  let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
  let end = rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len());
  let authority = &rest[..end];
  let host_port = authority.rsplit('@').next().unwrap_or(authority);
  let host = host_port
    .split(':')
    .next()
    .unwrap_or_default()
    .trim_end_matches('.')
    .to_ascii_lowercase();
  let youtube = ["youtube.com", "youtubekids.com"]
    .iter()
    .any(|d| host == *d || host.strip_suffix(d).is_some_and(|sub| sub.ends_with('.')));
  if !youtube {
    return false;
  }
  let tail = rest[end..].split('#').next().unwrap_or_default();
  let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
  let uploads = query
    .split('&')
    .filter_map(|kv| kv.split_once('='))
    .any(|(k, v)| k == "list" && percent_decode(v).starts_with("UU"));
  if uploads {
    return true;
  }
  let segments: Vec<String> = path
    .split(['/', '\\'])
    .filter(|s| !s.is_empty())
    .map(percent_decode)
    .collect();
  let Some(first) = segments.first() else {
    return false;
  };
  if first.starts_with('@') {
    return true;
  }
  let lower = first.to_ascii_lowercase();
  match lower.strip_suffix(".php").unwrap_or(&lower) {
    "channel" | "c" | "user" => true,
    // YouTube Music: `browse/UC...` is an artist's channel; `MPREb...` (album) and `VL...`
    // (playlist) are not.
    "browse" => segments.get(1).is_some_and(|id| id.starts_with("UC")),
    name => !NOT_CHANNEL.contains(&name),
  }
}

/// `%XX` escapes decoded (so `%40name` reads as `@name`); anything malformed is kept as is.
fn percent_decode(s: &str) -> String {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    let hex = b
      .get(i + 1..i + 3)
      .filter(|h| h.iter().all(u8::is_ascii_hexdigit))
      .and_then(|h| std::str::from_utf8(h).ok())
      .and_then(|h| u8::from_str_radix(h, 16).ok());
    match (b[i], hex) {
      (b'%', Some(v)) => {
        out.push(v);
        i += 3;
      }
      (c, _) => {
        out.push(c);
        i += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).into_owned()
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

  const CHANNELS: &[&str] = &[
    "https://www.youtube.com/@SomeArtist",
    "https://www.youtube.com/@SomeArtist/",
    "https://youtube.com/@SomeArtist?si=AbCdEf",
    "https://www.youtube.com/@SomeArtist/videos",
    "https://www.youtube.com/@SomeArtist/streams",
    "https://www.youtube.com/@SomeArtist/shorts",
    "https://www.youtube.com/@SomeArtist/releases",
    "https://www.youtube.com/@SomeArtist/playlists",
    "https://www.youtube.com/@SomeArtist/featured",
    "https://www.youtube.com/@SomeArtist/live",
    "https://www.youtube.com/%40SomeArtist/videos",
    "https://m.youtube.com/@SomeArtist",
    "https://music.youtube.com/@SomeArtist",
    "HTTPS://WWW.YOUTUBE.COM/@SomeArtist/VIDEOS",
    "https://www.youtube.com:443/@SomeArtist",
    "https://www.youtube.com./@SomeArtist",
    "http://youtube.com/@SomeArtist",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/streams",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/shorts",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/releases",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/playlists",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/featured",
    "https://m.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://music.youtube.com/browse/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/c/SomeArtist",
    "https://www.youtube.com/c/SomeArtist/videos",
    "https://www.youtube.com/C/SomeArtist/featured",
    "https://www.youtube.com/user/SomeArtist",
    "https://www.youtube.com/user/SomeArtist/videos",
    "https://www.youtube.com/user/SomeArtist/playlists",
    "https://www.youtubekids.com/channel/UCabcdefghijklmnopqrstuv",
    // A legacy custom name straight after the host.
    "https://www.youtube.com/SomeArtist",
    "https://www.youtube.com/SomeArtist/videos",
    // A channel's uploads list is the whole channel under a playlist id.
    "https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv",
    "https://www.youtube.com/watch?v=AbCdEfGhIjK&list=UULFabcdefghijklmnopqrstuv",
    "https://music.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv",
  ];

  const NOT_CHANNELS: &[&str] = &[
    "https://www.youtube.com/watch?v=AbCdEfGhIjK",
    "https://youtube.com/watch?v=AbCdEfGhIjK&t=42s",
    "https://m.youtube.com/watch?v=AbCdEfGhIjK",
    "https://music.youtube.com/watch?v=AbCdEfGhIjK",
    "https://music.youtube.com/watch?v=AbCdEfGhIjK&list=RDAMVMAbCdEfGhIjK",
    "https://www.youtube.com/watch?v=AbCdEfGhIjK&list=PLabcdefghijklmnopqrstuvwxyz012345",
    "https://www.youtube.com/playlist?list=PLabcdefghijklmnopqrstuvwxyz012345",
    "https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnopqrstuvwxyz01234",
    "https://music.youtube.com/browse/MPREb_AbCdEfGhIjK",
    "https://music.youtube.com/browse/VLPLabcdefghijklmnopqrstuvwxyz012345",
    "https://www.youtube.com/shorts/AbCdEfGhIjK",
    "https://youtube.com/shorts/AbCdEfGhIjK?feature=share",
    "https://www.youtube.com/live/AbCdEfGhIjK",
    "https://www.youtube.com/embed/AbCdEfGhIjK",
    "https://www.youtube.com/v/AbCdEfGhIjK",
    "https://www.youtube.com/e/AbCdEfGhIjK",
    "https://www.youtube.com/watch.php?v=AbCdEfGhIjK",
    "https://www.youtube.com/?v=AbCdEfGhIjK",
    "https://www.youtube.com/#/watch?v=AbCdEfGhIjK",
    "https://www.youtube.com/clip/UgkxAbCdEfGhIjK",
    "https://www.youtube-nocookie.com/embed/AbCdEfGhIjK",
    // youtu.be is always one video, whatever the path looks like.
    "https://youtu.be/AbCdEfGhIjK",
    "https://youtu.be/AbCdEfGhIjK?si=x&list=PLabcdefghijklmnopqrstuvwxyz012345",
    "https://youtu.be/@SomeArtist",
    "https://youtu.be/channel/UCabcdefghijklmnopqrstuv",
    // Other sites, and look-alike hosts.
    "https://soundcloud.com/@someartist",
    "https://example.com/channel/UCabcdefghijklmnopqrstuv",
    "https://notyoutube.com/@SomeArtist",
    "https://youtube.com.example.com/@SomeArtist",
    "https://example.com/?u=https://www.youtube.com/@SomeArtist",
    // Not web links at all.
    "youtube.com/@SomeArtist",
    "",
  ];

  #[test]
  fn channel_links_are_recognised_on_every_youtube_host() {
    for url in CHANNELS {
      assert!(is_channel_link(url), "{url} is a channel link");
    }
    for url in NOT_CHANNELS {
      assert!(!is_channel_link(url), "{url} is not a channel link");
    }
  }

  #[test]
  fn build_refuses_a_channel_link_in_plain_words() {
    for url in CHANNELS {
      for playlist in [false, true] {
        let a = DownloadArgs {
          url: url.to_string(),
          playlist,
          ..base()
        };
        match build(&a) {
          Err(Error::Refused(m)) => assert_eq!(m, CHANNEL_REFUSED),
          other => panic!("{url}: {other:?}"),
        }
      }
    }
    assert_eq!(
      CHANNEL_REFUSED,
      "Whole channels are not downloaded. Use a single video or a playlist link."
    );
    for url in NOT_CHANNELS.iter().filter(|u| is_web_link(u)) {
      let a = DownloadArgs {
        url: url.to_string(),
        ..base()
      };
      assert!(build(&a).is_ok(), "{url}");
    }
  }

  #[test]
  fn percent_escapes_decode_only_when_well_formed() {
    assert_eq!(percent_decode("%40name"), "@name");
    assert_eq!(percent_decode("a%2"), "a%2");
    assert_eq!(percent_decode("%+1x"), "%+1x");
    assert_eq!(percent_decode("%zz%41"), "%zzA");
  }

  #[test]
  fn constants_are_the_old_host_strings() {
    assert_eq!(TITLE_JUNK, tail()[4]);
    assert_eq!(MH_NAME_PARSE, tail()[11]);
  }
}
