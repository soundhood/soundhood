// Pure rules for links and download output, shared by the paste box, the share sheet and the queue
// runner. Unit tests: tools/screenshot/ui-logic.test.mjs.

/** The one line the UI shows when a channel link is pasted, shared or queued. */
export const CHANNEL_REFUSAL = "Whole channels are not downloaded. Share a single video or a playlist link.";

// YouTube's own hosts: youtube.com and its subdomains (www., m., music.).
const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;

// A channel's pages: /@name, /channel/<id>, /c/<name>, /user/<name>, and every tab under them
// (/videos, /streams, /shorts, /releases, /playlists, ...). The same shapes as core
// ytdlp::args::is_channel_link. Only YouTube hosts: elsewhere "/@name/..." is often one post or
// one video (a TikTok link, say), which is not a channel.
const CHANNEL_SEGMENTS = new Set(["channel", "c", "user"]);

/** True when `url` points at a whole YouTube channel or one of its tabs, not a video or a playlist. */
export function isChannelLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    return false;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !YOUTUBE_HOST.test(u.hostname)) return false;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  let first = parts[0];
  try {
    first = decodeURIComponent(first);
  } catch {
    /* a malformed escape: compare the raw segment */
  }
  if (first.startsWith("@")) return first.length > 1;
  return CHANNEL_SEGMENTS.has(first.toLowerCase()) && parts.length >= 2;
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
