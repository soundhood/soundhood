// The one check for a folder name the user types or picks as a destination (download target,
// "Move file to…", a queued link's target read from the synced queue file). The name becomes a
// first-level folder under the library root, so it must be a single, portable path segment that
// cannot climb out of the root or land in the app's own folders.

/** Folders the app owns at the library root; nothing the user downloads or moves goes there. */
const RESERVED_APP_FOLDERS = ["_playlists", "_soundhood"];

// Device names Windows refuses as a file or folder name, with or without an extension.
const DOS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

// Characters Windows rejects in a name, plus the control characters (0x00-0x1F).
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/;
const hasControlChar = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20);

/** The cleaned name, or why it was refused (plain words for the status pill). */
export type FolderNameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Trims `raw` and accepts it only as one safe folder name directly under the library root. */
export function checkFolderName(raw: string): FolderNameCheck {
  const name = String(raw ?? "").trim();
  if (!name) return { ok: false, reason: "empty" };
  if (name === "." || name === "..") return { ok: false, reason: "not a folder name" };
  if (name.includes("/") || name.includes("\\")) return { ok: false, reason: "no slashes" };
  if (WINDOWS_FORBIDDEN.test(name) || hasControlChar(name)) return { ok: false, reason: 'no < > : " | ? * or invisible characters' };
  if (DOS_DEVICE.test(name)) return { ok: false, reason: "reserved by Windows" };
  if (/[. ]$/.test(name)) return { ok: false, reason: "cannot end with a dot or a space" };
  if (RESERVED_APP_FOLDERS.includes(name.toLowerCase())) return { ok: false, reason: "used by the app" };
  return { ok: true, name };
}

/** The status-pill line for a refused name. */
export function folderNameRefusal(raw: string, reason: string): string {
  return `Folder name not allowed: "${String(raw ?? "").trim()}" (${reason})`;
}
