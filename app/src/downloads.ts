// Pure rules for links and download output, shared by the paste box, the share sheet and the queue
// runner. Unit tests: tools/screenshot/ui-logic.test.mjs.

/**
 * The one line the UI shows when a channel link is pasted, shared or queued. The phone plugin and
 * the desktop host refuse with the same sentence (plugin `rules::CHANNEL_REFUSED`); the shared test
 * vectors in tools/screenshot/channel-links.json hold all of them to it.
 */
export const CHANNEL_REFUSAL = "Whole channels are not downloaded. Use a single video or a playlist link.";

// First path segments yt-dlp does not read as a channel name: the list in core
// ytdlp::args::NOT_CHANNEL, kept in the same order. On a YouTube host any other first segment is a
// legacy channel name (youtube.com/<name>), which yt-dlp downloads as the whole channel.
const NOT_CHANNEL = new Set([
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
]);

/** ASCII-only lower case, as Rust's `to_ascii_lowercase`. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** `%XX` escapes decoded byte-wise (so `%40name` reads as `@name`); anything malformed is kept as is. */
function percentDecode(s: string): string {
  const b = new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < b.length; ) {
    const hex = b[i] === 0x25 && i + 2 < b.length ? String.fromCharCode(b[i + 1], b[i + 2]) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 3;
    } else {
      out.push(b[i]);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(out));
}

/**
 * True when `url` points at a whole YouTube channel or one of its tabs, not a video or a playlist.
 * A line-for-line port of core `ytdlp::args::is_channel_link`, which the desktop host and the phone
 * plugin call: on any YouTube host (www., m., music., YouTube Kids, a trailing dot) `/@name`,
 * `/channel/<id>`, `/c/<name>`, `/user/<name>` or a bare legacy name, each with or without a tab;
 * YouTube Music's `/browse/UC<id>` artist page; and a channel's uploads list (`list=UU...`).
 * The link is read exactly as given (no trimming): callers pass the link they will send.
 */
export function isChannelLink(url: string): boolean {
  const s = String(url ?? "");
  const scheme = asciiLower(s.slice(0, 8));
  if (!scheme.startsWith("http://") && !scheme.startsWith("https://")) return false;
  const rest = s.slice(s.indexOf("://") + 3);
  const cut = rest.search(/[/?#\\]/);
  const end = cut < 0 ? rest.length : cut;
  const authority = rest.slice(0, end);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const host = asciiLower(hostPort.split(":")[0].replace(/\.+$/, ""));
  const youtube = ["youtube.com", "youtubekids.com"].some((d) => host === d || host.endsWith(`.${d}`));
  if (!youtube) return false;
  const tail = rest.slice(end).split("#")[0];
  const q = tail.indexOf("?");
  const path = q < 0 ? tail : tail.slice(0, q);
  const query = q < 0 ? "" : tail.slice(q + 1);
  const uploads = query.split("&").some((kv) => {
    const eq = kv.indexOf("=");
    return eq >= 0 && kv.slice(0, eq) === "list" && percentDecode(kv.slice(eq + 1)).startsWith("UU");
  });
  if (uploads) return true;
  const segments = path
    .split(/[/\\]/)
    .filter((seg) => seg !== "")
    .map(percentDecode);
  const first = segments[0];
  if (first === undefined) return false;
  if (first.startsWith("@")) return true;
  const lower = asciiLower(first);
  const name = lower.endsWith(".php") ? lower.slice(0, -4) : lower;
  if (name === "channel" || name === "c" || name === "user") return true;
  // YouTube Music: browse/UC... is an artist's channel; MPREb... (album) and VL... (playlist) are not.
  if (name === "browse") return (segments[1] ?? "").startsWith("UC");
  return !NOT_CHANNEL.has(name);
}

/**
 * Why a download stopped, from its output: the last line that starts with "ERROR:" (yt-dlp) or
 * "[error]" (the app), without that prefix and cut to 160 characters; "" when there is none.
 */
export function lastErrorLine(output: string): string {
  const lines = String(output ?? "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^(?:ERROR:|\[error\])\s*(.+)$/i);
    if (m) return m[1].trim().slice(0, 160);
  }
  return "";
}

/** The status line when a queued download fails and the rest of the queue is not started. */
export function queueStopStatus(output: string, exitCode: number): string {
  return `Queue stopped: ${lastErrorLine(output) || `the download did not finish (code ${exitCode})`}`;
}

/**
 * What the toast says once a download's songs are filed: how many arrived and into how many
 * playlists, and, when a playlist refused them (a file in use), which one and why, in plain words:
 * "Downloaded 1 and added to 1 playlist. Not added to Late Night: file in use".
 */
export function filedStatus(songs: number, added: number, missed: readonly { name: string; reason: string }[]): string {
  const into = added > 0 ? ` and added to ${added} playlist${added === 1 ? "" : "s"}` : "";
  if (missed.length === 0) return `Downloaded ${songs}${into}`;
  const same = missed.every((m) => m.reason === missed[0].reason);
  const not = same
    ? `${missed.map((m) => m.name).join(", ")}: ${missed[0].reason}`
    : missed.map((m) => `${m.name}: ${m.reason}`).join("; ");
  return `Downloaded ${songs}${into}. Not added to ${not}`;
}

/**
 * What the toast says when the queue has nothing more to start: "Queue done" when a run went
 * through its links and none is left waiting; else how many links still wait (after a stopped run's
 * Retry, which downloads that one link and starts no other); null when there is nothing to say.
 */
export function queueEndStatus(ranRun: boolean, waiting: number): string | null {
  if (waiting > 0) return `${waiting} ${waiting === 1 ? "link" : "links"} still waiting in the queue`;
  return ranRun ? "Queue done" : null;
}
