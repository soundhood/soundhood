import { Store } from "@tauri-apps/plugin-store";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, addPluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Track = {
  path: string;
  name: string;
  playlist: string;
  title: string;
  artist: string;
  duration_secs: number;
};

const UNTAGGED = "(untagged)";
const NEW_PLAYLIST_SENTINEL = "__newpl__";

type PlaylistFile = { name: string; entries: string[] };

// Absolute path → the key used inside playlist files: relative to the Music root, forward slashes.
function relKey(root: string, abs: string): string {
  const r = root.replace(/[\\/]+$/, "");
  let rel = abs.startsWith(r) ? abs.slice(r.length) : abs;
  rel = rel.replace(/^[\\/]+/, "");
  return rel.replace(/\\/g, "/");
}

// "Schrotthagen, Giovanni Berg" / "A feat. B" → the individual names. Mirrors the Rust side:
// no splitting on "&" or "x", so "Earth, Wind & Fire" survives as "Earth" + "Wind & Fire" at worst.
// A track with no artist at all lands in the "(untagged)" bucket so it stays reachable.
function splitArtists(artist: string): string[] {
  if (!artist) return [UNTAGGED];
  return artist
    .split(/\s*(?:,|\/|;|\bfeat\.?\s|\bft\.?\s)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// One settings store, one key per setting. (An earlier edit had two store
// instances writing two different keys to the same file — Import broke on it.)
const storePromise = Store.load("music-hood.json");
const KEY_LIBRARY_DIR = "library_dir";
const KEY_DOWNLOAD_TARGET = "download_target";
const DEFAULT_DOWNLOAD_TARGET = "Downloads";
const NEW_FOLDER_SENTINEL = "__new__";

const KEY_VOLUME = "volume";
const KEY_SORT = "sort";
const KEY_DOWNLOAD_PLAYLISTS = "download_playlists";
// Links shared into the app (phone share sheet) waiting to be downloaded — the phone has no downloader yet.
const KEY_SHARE_QUEUE = "share_queue";
type QueuedLink = { url: string; added: number; target?: string; playlists?: string[] };
/** A pure playlist link (list= without a specific video) downloads every entry. */
function isPlaylistLink(url: string): boolean {
  return /[?&]list=/.test(url) && !/[?&]v=/.test(url) && !/youtu\.be\//.test(url);
}
type PhoneDownloadResult = { exitCode: number; files: string[]; log: string };
function firstUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0] : "";
}

// Track-list sort orders. "natural" = playlist order inside a playlist, filename order elsewhere.
const SORT_MODES = ["Natural order", "Title A→Z", "Title Z→A", "Artist A→Z", "Longest first", "Shortest first"] as const;
type SortMode = (typeof SORT_MODES)[number];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function sortTracks(list: Track[], mode: SortMode): Track[] {
  if (mode === "Natural order") return list;
  const title = (t: Track) => t.title || displayName(t.name);
  const artist = (t: Track) => t.artist || "￿"; // untagged last
  const out = [...list];
  switch (mode) {
    case "Title A→Z": out.sort((a, b) => collator.compare(title(a), title(b))); break;
    case "Title Z→A": out.sort((a, b) => collator.compare(title(b), title(a))); break;
    case "Artist A→Z": out.sort((a, b) => collator.compare(artist(a), artist(b)) || collator.compare(title(a), title(b))); break;
    case "Longest first": out.sort((a, b) => b.duration_secs - a.duration_secs); break;
    case "Shortest first": out.sort((a, b) => a.duration_secs - b.duration_secs); break;
  }
  return out;
}

// Shuffle icon: two straight parallel arrows when off, crossing arrows when on.
function ShuffleIcon({ on }: { on: boolean }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return on ? (
    <svg width="20" height="20" viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M3 7h3.5c1.6 0 3 .8 3.9 2.1L14.6 15c.9 1.3 2.3 2.1 3.9 2.1H21" />
      <path d="M3 17h3.5c1.6 0 3-.8 3.9-2.1l4.2-5.9C15.5 7.8 16.9 7 18.5 7H21" />
      <path d="M18.5 4.5L21 7l-2.5 2.5" />
      <path d="M18.5 14.6L21 17.1l-2.5 2.5" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M3 8h18" />
      <path d="M3 16h18" />
      <path d="M18.5 5.5L21 8l-2.5 2.5" />
      <path d="M18.5 13.5L21 16l-2.5 2.5" />
    </svg>
  );
}

function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13c0 .8.9 1.3 1.6.9l10-6.5c.6-.4.6-1.3 0-1.7l-10-6.5C8.9 4.2 8 4.7 8 5.5z" />
    </svg>
  );
}
function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}
function PrevIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="2.6" height="14" rx="1" />
      <path d="M19 6.2v11.6c0 .8-.9 1.3-1.6.9L9.3 13c-.6-.4-.6-1.4 0-1.8l8.1-5.8c.7-.5 1.6 0 1.6.8z" />
    </svg>
  );
}
function NextIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 6.2v11.6c0 .8.9 1.3 1.6.9l8.1-5.7c.6-.4.6-1.4 0-1.8L6.6 5.4C5.9 4.9 5 5.4 5 6.2z" />
      <rect x="16.4" y="5" width="2.6" height="14" rx="1" />
    </svg>
  );
}
function ChevronIcon({ dir, size = 18 }: { dir: "left" | "down"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="M15 5l-7 7 7 7" /> : <path d="M5 9l7 7 7-7" />}
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

// Filename without extension — what the user should read as the title.
function displayName(fileName: string) {
  return fileName.replace(/\.[^./\\]+$/, "");
}

// In-app dropdown. The native <select> popup is drawn by Windows/WebView2 and
// ignores the app's dark theme (light grey on light grey — unreadable), so we draw our own.
type DropdownProps = {
  value: string;
  options: string[];
  onSelect: (v: string) => void;
  placeholder?: string;
  extra?: { label: string; value: string };
  up?: boolean;
  className?: string;
  title?: string;
};

function Dropdown({ value, options, onSelect, placeholder, extra, up, className, title }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(v: string) {
    setOpen(false);
    onSelect(v);
  }

  return (
    <div className={`dd ${className ?? ""}`} ref={ref}>
      <button type="button" className={`ddBtn ${open ? "open" : ""}`} title={title} onClick={() => setOpen((o) => !o)}>
        <span className="ddLabel">{value || placeholder || ""}</span>
        <span className="ddChevron">{up ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className={`ddMenu ${up ? "up" : ""}`}>
          {options.map((o) => (
            <div key={o} className={`ddItem ${o === value ? "active" : ""}`} onClick={() => pick(o)}>
              {o}
            </div>
          ))}
          {extra ? (
            <div className="ddItem ddExtra" onClick={() => pick(extra.value)}>
              {extra.label}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Multi-choice dropdown: stays open while ticking; the button shows a summary.
type MultiDropdownProps = {
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  title?: string;
  className?: string;
};

function MultiDropdown({ values, options, onChange, placeholder, title, className }: MultiDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  }

  const label =
    values.length === 0 ? placeholder : values.length === 1 ? values[0] : `${values.length} playlists`;

  return (
    <div className={`dd ${className ?? ""}`} ref={ref}>
      <button type="button" className={`ddBtn ${open ? "open" : ""} ${values.length ? "hasValues" : ""}`} title={title} onClick={() => setOpen((o) => !o)}>
        <span className="ddLabel">{label}</span>
        <span className="ddChevron">▾</span>
      </button>
      {open ? (
        <div className="ddMenu">
          {options.length === 0 ? <div className="ddItem dimText">No playlists yet</div> : null}
          {options.map((o) => {
            const on = values.includes(o);
            return (
              <div key={o} className={`ddItem ddCheck ${on ? "active" : ""}`} onClick={() => toggle(o)}>
                <span className="ddBox">{on ? "✓" : ""}</span>
                {o}
              </div>
            );
          })}
          {values.length ? (
            <div className="ddItem ddExtra" onClick={() => onChange([])}>Clear</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const COLORS = {
  bg0: "#0f0f0f",
  bg1: "#212121",
  accent: "#00ffbf",
  accent2: "#8c19ff",
  text: "rgba(255,255,255,0.92)",
  textDim: "rgba(255,255,255,0.65)",
  panel: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [folder, setFolder] = useState<string>("");
  // "windows" | "linux" | "macos" | "android" | "ios" (from Rust). Phones: no folder picker, no Recycle Bin.
  const [platform, setPlatform] = useState<string>("");
  const isMobile = platform === "android" || platform === "ios";
  const [pathInput, setPathInput] = useState<string>("");
  const [status, setStatus] = useState<string>("Idle");
  const [allTracks, setAllTracks] = useState<Track[]>([]);

  const [playlist, setPlaylist] = useState<string>("(all)");
  // Left panel: playlist FILES (membership, many-to-many) · Artists (from tags) · Folders (storage).
  const [sideTab, setSideTab] = useState<"playlists" | "artists" | "folders">("playlists");
  const [artistView, setArtistView] = useState<string>("");
  // The playlist file being viewed ("" = none). Exactly one of artistView / plView / folder is active.
  const [plView, setPlView] = useState<string>("");
  const [playlistFiles, setPlaylistFiles] = useState<PlaylistFile[]>([]);
  const [plQuery, setPlQuery] = useState<string>("");
  const [newPlaylistMode, setNewPlaylistMode] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>("");
  const [confirmDeletePlaylist, setConfirmDeletePlaylist] = useState<string>("");
  const [artistQuery, setArtistQuery] = useState<string>("");
  const [playlistQuery, setPlaylistQuery] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("Natural order");

  const [currentPath, setCurrentPath] = useState<string>("");
  // Single click selects (highlight only); double click plays. Selection is what "Move selected" acts on.
  // Multi-select: a set of paths. Click = single, Ctrl+click = toggle, Shift+click = range, Ctrl+A = all listed.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string>("");
  // Track awaiting delete confirmation (the in-app "are you sure" box).
  const [confirmDelete, setConfirmDelete] = useState<Track[] | null>(null);
  // Tag editor (single track) and the batch "tags from filenames" confirmation.
  const [editTags, setEditTags] = useState<{ track: Track; title: string; artist: string } | null>(null);
  const [confirmFix, setConfirmFix] = useState<boolean>(false);
  const [fixBusy, setFixBusy] = useState<boolean>(false);
  const [fixReport, setFixReport] = useState<{ updated: number; skipped: number; failed: string[] } | null>(null);
  const [currentName, setCurrentName] = useState<string>("");
  const [currentPlaylist, setCurrentPlaylist] = useState<string>("");

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [shuffle, setShuffle] = useState<boolean>(false);
  // Double-click on a playlist/artist/folder: open it, turn shuffle on, start on a random track.
  // The list is derived state, so the play happens once the new list has been computed.
  const autoplayRef = useRef<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const settingsLoadedRef = useRef<boolean>(false);
  // Phone layout: one screen at a time. browse = Playlists/Artists/Folders, tracks = the song list,
  // player = full-screen now playing. Desktop ignores all three.
  const [mScreen, setMScreen] = useState<"browse" | "tracks" | "player">("browse");
  // On a touchscreen a tap plays; "Select" switches taps to ticking rows for bulk playlist edits.
  const [mSelectMode, setMSelectMode] = useState<boolean>(false);
  const [mSettings, setMSettings] = useState<boolean>(false);
  // Height of the phone's bottom block (mini player + tabs + gesture bar) — the full-screen player
  // stops above it instead of guessing a fixed number.
  const [shareQueue, setShareQueue] = useState<QueuedLink[]>([]);
  const [sharedLink, setSharedLink] = useState<string>("");
  async function saveQueue(next: QueuedLink[]) {
    setShareQueue(next);
    try {
      const store = await storePromise;
      await store.set(KEY_SHARE_QUEUE, next);
      await store.save();
    } catch { /* non-fatal */ }
    // Also as a file inside the library, so it travels with the Music folder (phone ⇄ PC).
    const lib = folderRef.current;
    if (lib) {
      try { await invoke("queue_write", { libraryDir: lib, json: JSON.stringify({ version: 1, links: next }, null, 2) }); } catch { /* non-fatal */ }
    }
  }
  async function loadQueueFromLibrary(lib: string) {
    try {
      const text = await invoke<string>("queue_read", { libraryDir: lib });
      if (!text) return;
      const parsed = JSON.parse(text);
      const links: QueuedLink[] = Array.isArray(parsed?.links) ? parsed.links.filter((q: any) => q && typeof q.url === "string") : [];
      // Union with what this device already knows (a stale copy must not drop links added elsewhere).
      const known = new Set(links.map((q) => q.url));
      const merged = [...links, ...shareQueueRef.current.filter((q) => !known.has(q.url))].sort((a, b) => (b.added || 0) - (a.added || 0));
      setShareQueue(merged);
    } catch { /* no queue file yet */ }
  }
  const shareQueueRef = useRef<QueuedLink[]>([]);
  shareQueueRef.current = shareQueue;
  const [queueInput, setQueueInput] = useState<string>("");
  // A link arrives (share sheet / paste): ask where it should land, then queue it with that choice.
  const [queueDraft, setQueueDraft] = useState<{ url: string; target: string; playlists: string[] } | null>(null);
  function queueLink(text: string): boolean {
    const url = firstUrl(String(text || ""));
    if (!url) { setStatus("No link found in that text"); return false; }
    setQueueDraft({ url, target: dlTarget || DEFAULT_DOWNLOAD_TARGET, playlists: dlPlaylistsRef.current });
    return true;
  }
  function confirmQueueDraft(downloadNow: boolean) {
    const d = queueDraft;
    if (!d) return;
    const item: QueuedLink = { url: d.url, added: Date.now(), target: d.target, playlists: d.playlists };
    const cur = shareQueueRef.current.filter((q) => q.url !== d.url);
    saveQueue([item, ...cur]);
    setSharedLink(d.url);
    setQueueDraft(null);
    if (isMobile) setMSettings(true);
    if (downloadNow && !dlBusy) {
      queueRunRef.current = [];
      startDownload(item.url, item.target || DEFAULT_DOWNLOAD_TARGET, item.playlists || [], item);
    } else {
      setStatus("Link queued");
    }
  }
  const queueLinkRef = useRef(queueLink);
  queueLinkRef.current = queueLink;
  useEffect(() => {
    // Called by MainActivity.kt when another app shares text/a link into Soundhood.
    (window as any).__soundhoodShare = (text: string) => queueLinkRef.current(text);
    return () => { delete (window as any).__soundhoodShare; };
  }, []);
  async function pasteLink() {
    try {
      const t = await navigator.clipboard.readText();
      if (t && queueLink(t)) return;
    } catch { /* clipboard not readable here */ }
    setStatus("Paste the link into the box");
  }
  const mBottomRef = useRef<HTMLDivElement | null>(null);
  const [mBottomH, setMBottomH] = useState<number>(80);
  useEffect(() => {
    const el = mBottomRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setMBottomH(el.getBoundingClientRect().height));
    ro.observe(el);
    setMBottomH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [isMobile, currentPath, mScreen]);
  const goTracks = () => { if (isMobile) setMScreen("tracks"); };
  function toggleRow(t: Track) {
    setSelectedPaths((prev) => {
      const n = new Set(prev);
      if (n.has(t.path)) n.delete(t.path); else n.add(t.path);
      return n;
    });
  }

  // Volume: apply to the player immediately, persist a moment after the slider stops moving
  // (but never before the saved value has been read, or we'd overwrite it with the default).
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    if (!settingsLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const store = await storePromise;
        await store.set(KEY_VOLUME, volume);
        await store.save();
      } catch {
        /* non-fatal */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [volume]);

  // Manual download box
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [dlBusy, setDlBusy] = useState<boolean>(false);
  const [dlLogs, setDlLogs] = useState<string>("");

  // Where downloads land: a first-level folder under the Music root (= a playlist).
  const [dlTarget, setDlTarget] = useState<string>(DEFAULT_DOWNLOAD_TARGET);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [newFolderMode, setNewFolderMode] = useState<boolean>(false);
  // Playlists a finished download is added to (remembered between downloads).
  const [dlPlaylists, setDlPlaylists] = useState<string[]>([]);
  const dlPlaylistsRef = useRef<string[]>([]);
  useEffect(() => {
    dlPlaylistsRef.current = dlPlaylists;
  }, [dlPlaylists]);
  const lastDownloadRef = useRef<string[]>([]);
  // Destination of the download in flight: the bar's choices, or a queued link's own.
  const activeDlRef = useRef<{ target: string; playlists: string[]; queued: QueuedLink | null }>({ target: DEFAULT_DOWNLOAD_TARGET, playlists: [], queued: null });
  const queueRunRef = useRef<QueuedLink[]>([]);

  async function chooseDlPlaylists(next: string[]) {
    setDlPlaylists(next);
    try {
      const store = await storePromise;
      await store.set(KEY_DOWNLOAD_PLAYLISTS, next);
      await store.save();
    } catch {
      /* non-fatal */
    }
  }

  // IMPORTANT: avoid duplicate ytdlp listeners in dev/hmr by using a ref for latest folder
  const folderRef = useRef<string>("");
  useEffect(() => {
    folderRef.current = folder;
    if (folder) loadQueueFromLibrary(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // Folders offered as download targets: every existing playlist folder + the default.
  const targetOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_DOWNLOAD_TARGET]);
    for (const t of allTracks) {
      if (t.playlist && t.playlist !== "(root)") set.add(t.playlist);
    }
    if (dlTarget) set.add(dlTarget);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allTracks, dlTarget]);

  async function chooseTarget(name: string) {
    const clean = name.trim();
    if (!clean) return;
    setDlTarget(clean);
    setNewFolderMode(false);
    setNewFolderName("");
    try {
      const store = await storePromise;
      await store.set(KEY_DOWNLOAD_TARGET, clean);
      await store.save();
    } catch {
      /* non-fatal: the choice still applies for this session */
    }
  }

  const playlists = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTracks) set.add(t.playlist || "(root)");
    const arr = Array.from(set);
    arr.sort((a, b) => a.localeCompare(b));
    return ["(all)", ...arr.filter((x) => x !== "(all)")];
  }, [allTracks]);

  // Artist index: every artist named in a tag (collaborations count under each name) → track count.
  const artists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTracks) {
      for (const a of splitArtists(t.artist)) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === UNTAGGED) return 1; // always last
        if (b.name === UNTAGGED) return -1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [allTracks]);

  const shownPlaylists = useMemo(() => {
    const q = playlistQuery.trim().toLowerCase();
    return q ? playlists.filter((p) => p === "(all)" || p.toLowerCase().includes(q)) : playlists;
  }, [playlists, playlistQuery]);

  const shownArtists = useMemo(() => {
    const q = artistQuery.trim().toLowerCase();
    return q ? artists.filter((a) => a.name.toLowerCase().includes(q)) : artists;
  }, [artists, artistQuery]);

  // Tracks by their playlist-file key, for resolving m3u8 entries.
  const tracksByKey = useMemo(() => {
    const m = new Map<string, Track>();
    const root = folder;
    if (!root) return m;
    for (const t of allTracks) m.set(relKey(root, t.path).toLowerCase(), t);
    return m;
  }, [allTracks, folder]);

  const currentPlaylistFile = useMemo(
    () => (plView ? playlistFiles.find((p) => p.name === plView) ?? null : null),
    [playlistFiles, plView]
  );

  const shownPlaylistFiles = useMemo(() => {
    const q = plQuery.trim().toLowerCase();
    return q ? playlistFiles.filter((p) => p.name.toLowerCase().includes(q)) : playlistFiles;
  }, [playlistFiles, plQuery]);

  const filteredTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: Track) => !q || t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);

    if (plView) {
      // playlist FILE: entries in their own order; entries whose file is gone are skipped
      const pl = currentPlaylistFile;
      if (!pl) return [];
      const out: Track[] = [];
      for (const e of pl.entries) {
        const t = tracksByKey.get(e.toLowerCase());
        if (t && matches(t)) out.push(t);
      }
      return sortTracks(out, sortMode);
    }
    const out = allTracks.filter((t) => {
      if (artistView) {
        // virtual playlist: every track by this artist, whatever folder it lives in
        if (!splitArtists(t.artist).includes(artistView)) return false;
      } else if (playlist !== "(all)" && (t.playlist || "(root)") !== playlist) {
        return false;
      }
      return matches(t);
    });
    return sortTracks(out, sortMode);
  }, [allTracks, playlist, artistView, plView, currentPlaylistFile, tracksByKey, query, sortMode]);

  async function chooseSort(mode: SortMode) {
    setSortMode(mode);
    try {
      const store = await storePromise;
      await store.set(KEY_SORT, mode);
      await store.save();
    } catch {
      /* non-fatal */
    }
  }

  // Is the selected track already in a given playlist file?
  function inPlaylist(pl: PlaylistFile, t: Track) {
    const k = relKey(folder, t.path).toLowerCase();
    return pl.entries.some((e) => e.toLowerCase() === k);
  }

  async function loadPlaylists(lib: string) {
    try {
      const pls = await invoke<PlaylistFile[]>("list_playlists", { libraryDir: lib });
      setPlaylistFiles(pls);
    } catch (err) {
      setStatus(`Playlists: ${String(err)}`);
    }
  }

  async function createPlaylistsFromFolders() {
    const lib = folderRef.current;
    if (!lib) return;
    try {
      const pls = await invoke<PlaylistFile[]>("playlists_from_folders", { libraryDir: lib });
      setPlaylistFiles(pls);
      setStatus(`Created ${pls.length} playlist files in _Playlists`);
    } catch (err) {
      setStatus(`Playlists: ${String(err)}`);
    }
  }

  async function addToPlaylist(name: string, tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return;
    try {
      const pl = await invoke<PlaylistFile>("playlist_add", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => {
        const i = prev.findIndex((p) => p.name === pl.name);
        const next = i >= 0 ? prev.map((p) => (p.name === pl.name ? pl : p)) : [...prev, pl];
        return next.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      });
      setStatus(`Added to ${pl.name}`);
    } catch (err) {
      setStatus(`Add failed: ${String(err)}`);
    }
  }

  async function removeFromPlaylist(name: string, tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return;
    try {
      const pl = await invoke<PlaylistFile>("playlist_remove", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => prev.map((p) => (p.name === pl.name ? pl : p)));
      setStatus(`Removed from ${pl.name}`);
    } catch (err) {
      setStatus(`Remove failed: ${String(err)}`);
    }
  }

  async function createPlaylist(name: string) {
    const lib = folderRef.current;
    const clean = name.trim();
    if (!lib || !clean) return;
    try {
      const pl = await invoke<PlaylistFile>("playlist_create", { args: { libraryDir: lib, name: clean } });
      setPlaylistFiles((prev) =>
        prev.some((p) => p.name === pl.name)
          ? prev
          : [...prev, pl].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      );
      setNewPlaylistMode(false);
      setNewPlaylistName("");
      openPlaylistView(pl.name);
    } catch (err) {
      setStatus(`Create failed: ${String(err)}`);
    }
  }

  async function deletePlaylist(name: string) {
    const lib = folderRef.current;
    if (!lib || !name) return;
    try {
      await invoke("playlist_delete", { args: { libraryDir: lib, name } });
      setPlaylistFiles((prev) => prev.filter((p) => p.name !== name));
      if (plView === name) setPlView("");
      setStatus(`Playlist "${name}" moved to the Recycle Bin (tracks untouched)`);
    } catch (err) {
      setStatus(`Delete failed: ${String(err)}`);
    } finally {
      setConfirmDeletePlaylist("");
    }
  }

  function openPlaylistView(name: string) {
    setArtistView("");
    setPlaylist("(all)");
    setPlView(name);
  }

  const shownCount = filteredTracks.length;

  useEffect(() => {
    if (!autoplayRef.current) return;
    if (filteredTracks.length === 0) return;
    autoplayRef.current = false;
    const t = filteredTracks[Math.floor(Math.random() * filteredTracks.length)];
    loadAndPlay(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks]);

  function shufflePlayPlaylist(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    openPlaylistView(name);
  }
  function shufflePlayArtist(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    setPlView("");
    setPlaylist("(all)");
    setArtistView(name);
  }
  function shufflePlayFolder(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    setPlView("");
    setArtistView("");
    setPlaylist(name);
  }

  const currentTrack = useMemo(
    () => (currentPath ? allTracks.find((t) => t.path === currentPath) ?? null : null),
    [allTracks, currentPath]
  );

  // Selected tracks in list order (only those currently listed count).
  const selectedTracks = useMemo(
    () => (selectedPaths.size ? filteredTracks.filter((t) => selectedPaths.has(t.path)) : []),
    [filteredTracks, selectedPaths]
  );
  const selectedTrack = selectedTracks.length === 1 ? selectedTracks[0] : null;

  function onRowClick(e: ReactMouseEvent, t: Track) {
    const paths = filteredTracks.map((x) => x.path);
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchorRef.current) {
        const a = paths.indexOf(anchorRef.current);
        const b = paths.indexOf(t.path);
        if (a >= 0 && b >= 0) {
          if (!e.ctrlKey && !e.metaKey) next.clear();
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(paths[i]);
          return next;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        if (next.has(t.path)) next.delete(t.path);
        else next.add(t.path);
      } else if (next.size === 1 && next.has(t.path)) {
        next.clear();
      } else {
        next.clear();
        next.add(t.path);
      }
      anchorRef.current = t.path;
      return next;
    });
  }

  // Ctrl+A selects everything listed (unless typing in a field); Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedPaths(new Set(filteredTracks.map((t) => t.path)));
      } else if (e.key === "Escape") {
        setSelectedPaths(new Set());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filteredTracks]);

  const currentIndex = useMemo(() => {
    if (!currentPath) return -1;
    return filteredTracks.findIndex((t) => t.path === currentPath);
  }, [filteredTracks, currentPath]);

  function pickNextIndex(delta: number) {
    const n = filteredTracks.length;
    if (n === 0) return -1;
    if (shuffle) return Math.floor(Math.random() * n);
    const base = currentIndex >= 0 ? currentIndex : 0;
    return (base + delta + n) % n;
  }

  // Re-read the current Music folder (after renames/moves done outside the app).
  async function rescanLibrary() {
    const lib = folderRef.current;
    if (!lib) return;
    try {
      setStatus("Scanning…");
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(lib);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
  }

  // Mobile: type the folder path instead of picking it.
  async function importFolderPath(path: string) {
    const dir = path.trim();
    if (!dir) return;
    try {
      setFolder(dir);
      setStatus("Scanning…");
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, dir);
      await store.save();
      const found = await invoke<Track[]>("scan_music_folder", { dir });
      setAllTracks(found);
      setPlaylist("(all)");
      setPlView("");
      setArtistView("");
      setQuery("");
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(dir);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
  }

  async function importFolder() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked || typeof picked !== "string") return;

      setFolder(picked);
      setStatus("Scanning…");

      // persist selection
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, picked);
      await store.save();

      const found = await invoke<Track[]>("scan_music_folder", { dir: picked });

      setAllTracks(found);
      setPlaylist("(all)");
      setPlView("");
      setArtistView("");
      setQuery("");
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(picked);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
  }

  async function startManualDownload() {
    const url = downloadUrl.trim();
    if (!url || dlBusy) return;
    await startDownload(url, dlTarget, dlPlaylistsRef.current, null);
  }

  async function startDownload(url: string, target: string, playlists: string[], queued: QueuedLink | null): Promise<boolean> {
    // Never download "somewhere": without a Music root there is no playlist to land in.
    const lib = folderRef.current || "";
    if (!lib) {
      setDlLogs("[error] Pick your Music folder first (Import) — downloads land in a playlist folder under it.\n");
      return false;
    }
    const folderName = target || DEFAULT_DOWNLOAD_TARGET;
    activeDlRef.current = { target: folderName, playlists, queued };
    setDlBusy(true);
    setDlLogs(queued ? `[soundhood] queued link → ${folderName}${playlists.length ? " + " + playlists.join(", ") : ""}\n` : "");
    const playlist = isPlaylistLink(url);
    if (isMobile) {
      // Phone: yt-dlp lives inside the app (soundhood-ytdl plugin); the result comes back directly.
      const sep = lib.includes("\\") ? "\\" : "/";
      const outDir = `${lib.replace(/[\\/]+$/, "")}${sep}${folderName}`;
      setStatus("Downloading…");
      const id = `dl-${Date.now()}`;
      dlIdRef.current = id;
      try {
        const res = await invoke<PhoneDownloadResult>("plugin:soundhood-ytdl|download", {
          args: { url, outDir, playlist, id },
        });
        setDlLogs((prev) => prev + `\n[done] exit code: ${res.exitCode}\n`);
        await finishDownload(res.exitCode, res.files || []);
        return res.exitCode === 0;
      } catch (err) {
        setDlBusy(false);
        setDlLogs((prev) => prev + `\n[error] ${String(err)}\n`);
        setStatus(`Download failed: ${String(err).split("\n")[0].slice(0, 120)}`);
        if (queued) { activeDlRef.current = { ...activeDlRef.current, queued: null }; queueRunRef.current = []; }
        return false;
      }
    }
    try {
      await invoke("ytdlp_download_audio", {
        args: { url, libraryDir: lib, targetFolder: folderName, playlist },
      });
      return true;
    } catch (err) {
      setDlBusy(false);
      setDlLogs((prev) => prev + `\n[error] ${String(err)}\n`);
      return false;
    }
  }

  // After a download ended (either engine): rescan, file the new tracks into the chosen playlists,
  // drop a finished queued link, start the next queued one.
  async function finishDownload(exitCode: number, filePaths: string[]) {
    setDlBusy(false);
    const lib = folderRef.current;
    if (!lib) return;
    try {
      setStatus("Refreshing…");
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(lib);
      const active = activeDlRef.current;
      const targets = active.playlists;
      if (exitCode === 0 && filePaths.length && targets.length) {
        const paths = filePaths.filter((fp) => found.some((x) => x.path === fp));
        if (paths.length) {
          for (const name of targets) {
            await invoke<PlaylistFile>("playlist_add", { args: { libraryDir: lib, name, paths } });
          }
          await loadPlaylists(lib);
          setDlLogs((prev) => prev + `[soundhood] ${paths.length} file${paths.length === 1 ? "" : "s"} added to: ${targets.join(", ")}\n`);
          setStatus(`Downloaded ${paths.length} and added to ${targets.length} playlist${targets.length === 1 ? "" : "s"}`);
        }
      } else if (exitCode === 0) {
        setStatus(`Downloaded ${filePaths.length} file${filePaths.length === 1 ? "" : "s"}`);
      }
      if (active.queued) {
        if (exitCode === 0) saveQueue(shareQueueRef.current.filter((q) => q.url !== active.queued!.url));
        activeDlRef.current = { ...active, queued: null };
        setTimeout(() => nextQueuedRef.current(), 300);
      }
    } catch (err) {
      setStatus(`Refresh error: ${String(err)}`);
    }
  }

  // Desktop: work through the queued links one after another (each with its own destination).
  function runQueue() {
    if (dlBusy || !shareQueue.length) return;
    queueRunRef.current = [...shareQueue];
    nextQueued();
  }
  function nextQueued() {
    const item = queueRunRef.current.shift();
    if (!item) { setStatus("Queue done"); return; }
    startDownload(item.url, item.target || DEFAULT_DOWNLOAD_TARGET, item.playlists || [], item).then((ok) => {
      if (!ok) { queueRunRef.current = []; }
    });
  }
  const nextQueuedRef = useRef(nextQueued);
  nextQueuedRef.current = nextQueued;
  const finishDownloadRef = useRef(finishDownload);
  finishDownloadRef.current = finishDownload;

  // Phone: progress lines from the in-app yt-dlp.
  const [dlProgress, setDlProgress] = useState<number>(-1);
  useEffect(() => {
    if (!isMobile) return;
    let un: (() => void) | undefined;
    let active = true;
    addPluginListener<{ id: string; progress: number; eta?: number; line: string }>("soundhood-ytdl", "progress", (e) => {
      if (typeof e.progress === "number" && e.progress >= 0) setDlProgress(e.progress);
      if (e.line) setDlLogs((prev) => (prev.length > 20000 ? prev.slice(-12000) : prev) + e.line + "\n");
    }).then((l) => { if (active) un = () => l.unregister(); else l.unregister(); }).catch((e) => setStatus(`Progress events unavailable: ${String(e).slice(0, 100)}`));
    return () => { active = false; if (un) un(); };
  }, [isMobile]);
  useEffect(() => { if (!dlBusy) setDlProgress(-1); }, [dlBusy]);
  // Seconds since the download started — so a silent yt-dlp is distinguishable from a dead one.
  const [dlSeconds, setDlSeconds] = useState<number>(0);
  useEffect(() => {
    if (!dlBusy) { setDlSeconds(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setDlSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [dlBusy]);
  const dlIdRef = useRef<string>("");
  async function cancelPhoneDownload() {
    const id = dlIdRef.current;
    if (!id) return;
    try { await invoke("plugin:soundhood-ytdl|cancel", { args: { id } }); setStatus("Cancelling…"); } catch (e) { setStatus(`Cancel failed: ${String(e).slice(0, 100)}`); }
  }
  const [ytdlpBusy, setYtdlpBusy] = useState<boolean>(false);
  async function copyLog() {
    const text = dlLogs;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Log copied");
      return;
    } catch { /* clipboard API refused: fall back to a selection */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus(ok ? "Log copied" : "Copy failed — long-press the log to select it");
    } catch {
      setStatus("Copy failed — long-press the log to select it");
    }
  }
  async function netcheck() {
    setYtdlpBusy(true);
    setStatus("Checking the network from python…");
    setDlLogs((prev) => prev + "[netcheck] running…\n");
    try {
      const r = await invoke<{ output: string }>("plugin:soundhood-ytdl|netcheck");
      setDlLogs((prev) => prev + r.output + "\n");
      setStatus("Network check done — see the log");
    } catch (e) {
      setDlLogs((prev) => prev + `[netcheck] failed: ${String(e)}\n`);
      setStatus("Network check failed");
    }
    setYtdlpBusy(false);
  }
  const [ytdlpVersion, setYtdlpVersion] = useState<string>("");
  useEffect(() => {
    if (!isMobile || !mSettings) return;
    invoke<{ version: string }>("plugin:soundhood-ytdl|ytdlp_version").then((r) => setYtdlpVersion(r.version)).catch((e) => setYtdlpVersion(`unavailable: ${String(e).slice(0, 80)}`));
  }, [isMobile, mSettings, ytdlpBusy]);
  async function updateYtdlp() {
    setYtdlpBusy(true);
    setStatus("Updating yt-dlp…");
    try {
      const r = await invoke<{ status: string; version: string }>("plugin:soundhood-ytdl|ytdlp_update");
      setStatus(`yt-dlp ${r.version} (${r.status === "ALREADY_UP_TO_DATE" ? "already current" : "updated"})`);
    } catch (e) {
      setStatus(`yt-dlp update failed: ${String(e).slice(0, 120)}`);
    }
    setYtdlpBusy(false);
  }

  function loadAndPlay(t: Track) {
    const audio = audioRef.current;
    if (!audio) return;

    const src = convertFileSrc(t.path);
    setCurrentPath(t.path);
    setCurrentName(displayName(t.name));
    setCurrentPlaylist(t.playlist || "(root)");

    // Phone: the webview never accepts the direct file URL (and can take seconds to say so) —
    // go straight to the bytes route.
    if (isMobile) {
      playViaBlob(t, src, "android: direct file URL skipped", true);
      return;
    }
    audio.src = src;
    audio.load();

    // Any failure to load/decode the file is otherwise silent (nothing plays, no message):
    // surface it in the status pill, with the media error code.
    audio.onerror = () => {
      const code = audio.error?.code;
      const why = code === 1 ? "aborted" : code === 2 ? "network/read error" : code === 3 ? "decode error" : code === 4 ? "format not supported / file not reachable" : "unknown";
      setIsPlaying(false);
      setStatus(`Can't play "${displayName(t.name)}": ${why}`);
    };
    audio.onloadedmetadata = () => {
      setDuration(audio.duration || 0);
      setProgress(0);
    };
    // play() is called right inside the tap/click (a "user gesture") — phones refuse playback
    // started later from a callback. It simply waits for enough data, then starts.
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => {
        setIsPlaying(false);
        // The direct file URL was refused (seen on Android): pull the file through the same
        // channel as a plain download and hand the bytes to the player instead.
        playViaBlob(t, src, String(e?.message || e));
      });
  }

  const blobUrlRef = useRef<string>("");
  function mimeFor(path: string): string {
    const ext = path.toLowerCase().split(".").pop() || "";
    return ext === "m4a" || ext === "mp4" ? "audio/mp4"
      : ext === "mp3" ? "audio/mpeg"
      : ext === "flac" ? "audio/flac"
      : ext === "ogg" || ext === "oga" ? "audio/ogg"
      : ext === "opus" ? "audio/ogg"
      : ext === "wav" ? "audio/wav"
      : ext === "aac" ? "audio/aac"
      : "audio/*";
  }
  async function playViaBlob(t: Track, src: string, firstError: string, rustOnly = false) {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("Loading…");
    try {
      let buf: ArrayBuffer;
      if (rustOnly) {
        buf = await invoke<ArrayBuffer>("read_file_bytes", { path: t.path });
      } else {
        try {
          const r = await fetch(src);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          buf = await r.arrayBuffer();
        } catch {
          // The file URL is not reachable from the page at all: ask Rust for the bytes.
          buf = await invoke<ArrayBuffer>("read_file_bytes", { path: t.path });
        }
      }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(new Blob([buf], { type: mimeFor(t.path) }));
      blobUrlRef.current = url;
      audio.onerror = () => {
        setIsPlaying(false);
        setStatus(`Can't decode "${displayName(t.name)}" (${(buf.byteLength / 1e6).toFixed(1)} MB, error ${audio.error?.code ?? "?"})`);
      };
      audio.src = url;
      audio.load();
      await audio.play();
      setIsPlaying(true);
      setStatus(`Playing (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
    } catch (e: any) {
      setIsPlaying(false);
      setStatus(`Can't play "${displayName(t.name)}": ${e?.message || e} · first: ${firstError}`);
    }
  }

  // Move any track into another playlist folder. If it is the one playing, the player
  // is re-pointed at the new path without losing the position; otherwise playback is untouched.
  async function moveTrackTo(fromPath: string, target: string) {
    const lib = folderRef.current;
    if (!fromPath || !lib || !target) return;

    try {
      const moved = await invoke<Track>("move_track", {
        args: { path: fromPath, libraryDir: lib, targetFolder: target },
      });

      setAllTracks((prev) =>
        prev.map((t) => (t.path === fromPath ? { ...moved, artist: moved.artist || t.artist } : t))
      );
      setSelectedPaths((prev) => {
        if (!prev.has(fromPath)) return prev;
        const next = new Set(prev);
        next.delete(fromPath);
        next.add(moved.path);
        return next;
      });
      setStatus(`Moved "${displayName(moved.name)}" to ${moved.playlist}`);
      await loadPlaylists(lib); // playlist files were updated on the Rust side

      if (fromPath !== currentPath) return;

      setCurrentPath(moved.path);
      setCurrentPlaylist(moved.playlist);

      // Re-point the player at the new path, keeping the position.
      const audio = audioRef.current;
      if (audio) {
        const pos = audio.currentTime;
        const wasPlaying = !audio.paused;
        audio.src = convertFileSrc(moved.path);
        audio.load();
        audio.onloadedmetadata = () => {
          setDuration(audio.duration || 0);
          audio.currentTime = pos;
          setProgress(pos);
          if (wasPlaying) audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        };
      }
    } catch (err) {
      setStatus(`Move failed: ${String(err)}`);
    }
  }

  // Send a track to the Recycle Bin (after the confirmation box). Stops it if it was playing.
  async function deleteTracks(tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || tracks.length === 0) return;
    const done: string[] = [];
    const failed: string[] = [];
    for (const t of tracks) {
      try {
        await invoke("delete_track", { args: { path: t.path, libraryDir: lib } });
        done.push(t.path);
      } catch (err) {
        failed.push(`${displayName(t.name)}: ${String(err)}`);
      }
    }
    if (done.includes(currentPath)) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setIsPlaying(false);
      setCurrentPath("");
      setCurrentName("");
      setCurrentPlaylist("");
      setProgress(0);
      setDuration(0);
    }
    const gone = new Set(done);
    setSelectedPaths((prev) => new Set([...prev].filter((p) => !gone.has(p))));
    setAllTracks((prev) => prev.filter((x) => !gone.has(x.path)));
    setStatus(
      done.length === 1 && failed.length === 0
        ? `Moved "${displayName(tracks[0].name)}" to the Recycle Bin`
        : `Recycle Bin: ${done.length} moved${failed.length ? `, ${failed.length} failed — ${failed[0]}` : ""}`
    );
    await loadPlaylists(lib);
    setConfirmDelete(null);
  }

  // Move several files (Folders view). Each move keeps playlists consistent on the Rust side.
  async function moveTracksTo(tracks: Track[], target: string) {
    for (const t of tracks) {
      if ((t.playlist || "(root)") !== target) await moveTrackTo(t.path, target);
    }
  }

  // Escape closes whichever box is open.
  useEffect(() => {
    if (!confirmDelete && !editTags && !confirmFix && !confirmDeletePlaylist) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmDelete(null);
        setEditTags(null);
        setConfirmFix(false);
        setConfirmDeletePlaylist("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDelete, editTags, confirmFix, confirmDeletePlaylist]);

  // "Song - Artist" from a filename — the library convention.
  function titleArtistFromName(name: string): { title: string; artist: string } {
    const stem = displayName(name);
    const i = stem.lastIndexOf(" - ");
    if (i > 0 && i < stem.length - 3) {
      return { title: stem.slice(0, i).trim(), artist: stem.slice(i + 3).trim() };
    }
    return { title: stem.trim(), artist: "" };
  }

  function openTagEditor(t: Track) {
    setEditTags({ track: t, title: t.title, artist: t.artist });
  }

  async function saveTags() {
    const lib = folderRef.current;
    if (!editTags || !lib) return;
    try {
      const updated = await invoke<Track>("write_tags", {
        args: { path: editTags.track.path, libraryDir: lib, title: editTags.title, artist: editTags.artist },
      });
      setAllTracks((prev) => prev.map((t) => (t.path === updated.path ? updated : t)));
      setStatus(`Tags saved: ${displayName(updated.name)}`);
      setEditTags(null);
    } catch (err) {
      setStatus(`Tag write failed: ${String(err)}`);
    }
  }

  // Batch: rewrite title/artist tags of every track currently listed, from their filenames.
  async function fixTagsFromFilenames() {
    const lib = folderRef.current;
    if (!lib || filteredTracks.length === 0) return;
    setFixBusy(true);
    setStatus(`Writing tags for ${filteredTracks.length} files…`);
    try {
      const report = await invoke<{ updated: Track[]; skipped: number; failed: string[] }>("fix_tags_from_filenames", {
        args: { paths: filteredTracks.map((t) => t.path), libraryDir: lib },
      });
      const byPath = new Map(report.updated.map((t) => [t.path, t] as const));
      setAllTracks((prev) => prev.map((t) => byPath.get(t.path) ?? t));
      setStatus(`Tags: ${report.updated.length} updated, ${report.skipped} kept`);
      setFixReport({ updated: report.updated.length, skipped: report.skipped, failed: report.failed });
    } catch (err) {
      setStatus(`Tag write failed: ${String(err)}`);
    } finally {
      setFixBusy(false);
      setConfirmFix(false);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }

  function playPrev() {
    const idx = pickNextIndex(-1);
    if (idx >= 0) loadAndPlay(filteredTracks[idx]);
  }

  function playNext() {
    const idx = pickNextIndex(1);
    if (idx >= 0) loadAndPlay(filteredTracks[idx]);
  }

  // Auto-load last imported library on startup
  useEffect(() => {
    (async () => {
      try {
        const store = await storePromise;

        let os = "";
        try {
          os = await invoke<string>("platform");
          setPlatform(os);
        } catch {
          /* older backend */
        }

        const savedTarget = await store.get<string>(KEY_DOWNLOAD_TARGET);
        if (savedTarget && typeof savedTarget === "string") setDlTarget(savedTarget);

        const savedDlPl = await store.get<string[]>(KEY_DOWNLOAD_PLAYLISTS);
        if (Array.isArray(savedDlPl)) setDlPlaylists(savedDlPl.filter((x) => typeof x === "string"));

        const savedSort = await store.get<string>(KEY_SORT);
        if (savedSort && (SORT_MODES as readonly string[]).includes(savedSort)) setSortMode(savedSort as SortMode);

        const savedQueue = await store.get<QueuedLink[]>(KEY_SHARE_QUEUE);
        if (Array.isArray(savedQueue)) setShareQueue(savedQueue.filter((q) => q && typeof q.url === "string"));

        const savedVolume = await store.get<number>(KEY_VOLUME);
        if (typeof savedVolume === "number" && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
        settingsLoadedRef.current = true;

        let saved = await store.get<string>(KEY_LIBRARY_DIR);
        // Android: no folder picker (it returns content URIs, not paths) — start from the standard Music folder.
        if ((!saved || typeof saved !== "string") && os === "android") {
          saved = "/storage/emulated/0/Music";
          await store.set(KEY_LIBRARY_DIR, saved);
          await store.save();
        }
        if (!saved || typeof saved !== "string") return;

        setFolder(saved);
        setStatus("Scanning…");

        const found = await invoke<Track[]>("scan_music_folder", { dir: saved });

        setAllTracks(found);
        setPlaylist("(all)");
        setQuery("");
        setStatus(`Found ${found.length} tracks`);
        await loadPlaylists(saved);
      } catch (err) {
        setStatus(`Auto-load failed: ${String(err)}`);
      }
    })();
  }, []);

  // Keep progress updated
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setProgress(audio.currentTime || 0);
    const onEnded = () => {
      setIsPlaying(false);
      playNext();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks, currentIndex, shuffle]);

  // Cover picture embedded in the playing file (front cover), as a blob URL; "" when none.
  const [coverUrl, setCoverUrl] = useState<string>("");
  const coverUrlRef = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    if (!currentPath) { setCoverUrl(""); return; }
    (async () => {
      try {
        const buf = await invoke<ArrayBuffer>("cover_art", { path: currentPath });
        if (cancelled) return;
        if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
        coverUrlRef.current = "";
        if (!buf || buf.byteLength < 16) { setCoverUrl(""); return; }
        const b = new Uint8Array(buf, 0, 4);
        const mime = b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x52 && b[1] === 0x49 ? "image/webp" : "image/jpeg";
        const url = URL.createObjectURL(new Blob([buf], { type: mime }));
        coverUrlRef.current = url;
        setCoverUrl(url);
      } catch {
        if (!cancelled) setCoverUrl("");
      }
    })();
    return () => { cancelled = true; };
  }, [currentPath]);

  // Lock screen / headset / notification controls (Media Session API). The phone shows the song
  // and artist and routes play/pause/next/previous/seek back into the app; same on desktop.
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title: currentName || "Soundhood",
        artist: currentTrack?.artist || "",
        album: currentPlaylist || "",
        artwork: coverUrl ? [{ src: coverUrl, sizes: "512x512", type: "image/jpeg" }] : [],
      });
      ms.playbackState = currentPath ? (isPlaying ? "playing" : "paused") : "none";
    } catch { /* older webview */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentName, currentPath, currentPlaylist, isPlaying, currentTrack?.artist, coverUrl]);
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch { /* unsupported action */ } };
    set("play", () => { const a = audioRef.current; if (a && a.src) a.play().then(() => setIsPlaying(true)).catch(() => {}); });
    set("pause", () => { const a = audioRef.current; if (a) { a.pause(); setIsPlaying(false); } });
    set("previoustrack", () => playPrev());
    set("nexttrack", () => playNext());
    set("seekto", (d) => { const a = audioRef.current; if (a && typeof d.seekTime === "number") { a.currentTime = d.seekTime; setProgress(a.currentTime); } });
    set("seekbackward", (d) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, a.currentTime - (d.seekOffset || 10)); });
    set("seekforward", (d) => { const a = audioRef.current; if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + (d.seekOffset || 10)); });
    return () => { for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) set(a, null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks, currentIndex, shuffle]);
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    const a = audioRef.current;
    if (!ms || !a || !duration || !isFinite(duration)) return;
    try { ms.setPositionState({ duration, playbackRate: a.playbackRate || 1, position: Math.min(progress, duration) }); } catch { /* ignore */ }
  }, [duration, progress]);

  // yt-dlp listeners (robust against React StrictMode + HMR)
  useEffect(() => {
    let active = true;

    let unlistenOut: (() => void) | undefined;
    let unlistenErr: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenFile: (() => void) | undefined;

    const setup = async () => {
      const uOut = await listen<string>("ytdlp:stdout", (e) => {
        // add newline if missing, to keep logs readable
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        setDlLogs((prev) => prev + chunk);
      });

      const uErr = await listen<string>("ytdlp:stderr", (e) => {
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        setDlLogs((prev) => prev + chunk);
      });

      const uFile = await listen<string[]>("ytdlp:files", (e) => {
        lastDownloadRef.current = Array.isArray(e.payload) ? e.payload : [];
      });

      const uDone = await listen<number>("ytdlp:done", async (e) => {
        setDlLogs((prev) => prev + `\n[done] exit code: ${e.payload}\n`);
        const filePaths = lastDownloadRef.current;
        lastDownloadRef.current = [];
        await finishDownloadRef.current(e.payload, filePaths);
      });

      // If StrictMode unmounted us before the awaits finished, immediately unlisten.
      if (!active) {
        uOut();
        uErr();
        uFile();
        uDone();
        return;
      }

      unlistenOut = uOut;
      unlistenErr = uErr;
      unlistenFile = uFile;
      unlistenDone = uDone;
    };

    setup();

    return () => {
      active = false;
      unlistenOut?.();
      unlistenErr?.();
      unlistenFile?.();
      unlistenDone?.();
    };
  }, []);


  return (
    <div className={`app ${isMobile ? "mobile" : ""}`} style={{ "--mBottomH": `${mBottomH}px` } as CSSProperties}>
      <audio ref={audioRef} preload="metadata" />
      <style>{`
        :root{
          --bg0:${COLORS.bg0};
          --bg1:${COLORS.bg1};
          --accent:${COLORS.accent};
          --accent2:${COLORS.accent2};
          --text:${COLORS.text};
          --textDim:${COLORS.textDim};
          --panel:${COLORS.panel};
          --border:${COLORS.border};
        }
        *{ box-sizing:border-box; }
        body,html,#root{ height:100%; margin:0; background:var(--bg0); color:var(--text); font-family:system-ui,-apple-system,Segoe UI,Roboto; }
        .app{
          height:100%;
          display:flex;
          flex-direction:column;
          background: radial-gradient(1200px 600px at 20% 0%, rgba(0,255,191,0.10), transparent 60%),
                      radial-gradient(900px 600px at 80% 10%, rgba(140,25,255,0.10), transparent 60%),
                      linear-gradient(180deg, rgba(255,255,255,0.02), transparent 40%),
                      var(--bg0);
        }
        .topbar{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:16px;
        }
        .brand{
          display:flex;
          align-items:center;
          gap:12px;
          font-weight:800;
          letter-spacing:0.2px;
          font-size:22px;
        }
        .btn{
          border:1px solid var(--border);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 12px;
          cursor:pointer;
        }
        .btn:disabled{ opacity:0.45; cursor:not-allowed; }
        .status{
          padding: 8px 12px;
          border:1px solid var(--border);
          border-radius: 14px;
          background: rgba(0,0,0,0.25);
          color: var(--textDim);
          font-size: 13px;
        }

        .downloadBar{
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 0 16px 12px 16px;
        }
        .downloadInput{
          flex: 1;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          outline:none;
        }
        .downloadInput:focus{
          border-color: rgba(0,255,191,0.45);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
        }
        .targetLabel{ color: var(--textDim); font-size: 13px; white-space: nowrap; }
        .targetNew{ width: 220px; flex: none; }

        /* In-app dropdown */
        .dd{ position: relative; }
        .ddBtn{
          display:flex; align-items:center; gap: 8px;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          cursor: pointer;
          max-width: 260px;
          font: inherit;
        }
        .ddBtn.open, .ddBtn:focus{
          border-color: rgba(0,255,191,0.45);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
          outline: none;
        }
        .ddLabel{ overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ddChevron{ color: var(--textDim); font-size: 12px; }
        .ddMenu{
          position: absolute; z-index: 50;
          top: calc(100% + 6px); left: 0;
          min-width: 100%; width: max-content; max-width: 340px;
          max-height: 340px; overflow: auto;
          padding: 6px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: #1a1a1a;
          box-shadow: 0 14px 40px rgba(0,0,0,0.65);
        }
        .ddMenu.up{ top: auto; bottom: calc(100% + 6px); }
        .player{ position: relative; z-index: 5; }  /* popups from the bar float above the panels */
        .ddItem{
          padding: 8px 10px;
          border-radius: 10px;
          cursor: pointer;
          color: var(--text);
          white-space: nowrap;
          border: 1px solid transparent;
        }
        .ddItem:hover{ background: rgba(255,255,255,0.06); }
        .ddItem.active{ border-color: rgba(0,255,191,0.35); background: rgba(0,255,191,0.10); }
        .ddExtra{ color: var(--accent); margin-top: 4px; }
        .ddSmall{ margin-top: 6px; }
        .ddSmall .ddBtn{ padding: 5px 10px; font-size: 12px; border-radius: 10px; color: var(--textDim); }

        .shuffleBtn{
          display:grid; place-items:center;
          width: 38px; height: 38px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.45);
          cursor: pointer;
          transition: color .15s, border-color .15s, background .15s, transform .1s;
        }
        .shuffleBtn:hover{ color: var(--text); background: rgba(255,255,255,0.08); }
        .shuffleBtn:active{ transform: scale(0.94); }
        .shuffleBtn.on{
          color: var(--accent);
          border-color: rgba(0,255,191,0.45);
          background: rgba(0,255,191,0.10);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
        }
        .iconBtn{
          display:grid; place-items:center;
          width: 40px; height: 40px; flex:none;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.04);
          color: var(--textDim);
          cursor: pointer;
        }
        .iconBtn:hover{ color: var(--text); background: rgba(255,255,255,0.08); }
        .iconBtn.danger:hover{ color: #ff5c7a; border-color: rgba(255,92,122,0.45); background: rgba(255,92,122,0.10); }
        .iconBtn.small{ width: 30px; height: 30px; border-radius: 9px; }
        .sortDd .ddBtn{ color: var(--textDim); font-size: 13px; }
        .ddBtn.hasValues{ color: var(--accent); border-color: rgba(0,255,191,0.35); }
        .ddCheck{ display:flex; align-items:center; gap: 8px; }
        .ddBox{
          width: 16px; height: 16px; flex:none;
          border: 1px solid var(--border); border-radius: 5px;
          display:grid; place-items:center; font-size: 11px; color: var(--accent);
        }
        .ddCheck.active .ddBox{ border-color: rgba(0,255,191,0.6); background: rgba(0,255,191,0.12); }
        .selCount{ color: var(--accent); font-size: 13px; white-space: nowrap; display:flex; align-items:center; gap: 6px; }
        .linkBtn{ background: none; border: none; color: var(--textDim); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0; }
        .linkBtn:hover{ color: var(--text); }
        .headerRow{ display:flex; align-items:center; justify-content:space-between; gap: 10px; }
        .migrateBox{
          margin: 4px 4px 12px;
          padding: 12px;
          border: 1px dashed rgba(0,255,191,0.35);
          border-radius: 14px;
          background: rgba(0,255,191,0.05);
        }
        .migrateBox code{ color: var(--accent); font-size: 12px; }

        /* Confirmation box */
        .modalBackdrop{
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.55);
          display:grid; place-items:center;
        }
        .modal{
          width: min(440px, 90vw);
          border: 1px solid var(--border);
          border-radius: 18px;
          background: #181818;
          box-shadow: 0 24px 60px rgba(0,0,0,0.7);
          padding: 18px;
        }
        .modalTitle{ font-weight: 800; font-size: 16px; margin-bottom: 10px; }
        .modalTrack{ font-weight: 700; word-break: break-word; }
        .modalHint{ color: var(--textDim); font-size: 12px; margin-top: 6px; }
        .modalActions{ display:flex; justify-content:flex-end; gap: 10px; margin-top: 18px; }
        .primaryBtn{ border-color: rgba(0,255,191,0.45); background: rgba(0,255,191,0.12); color: var(--accent); }
        .primaryBtn:hover{ background: rgba(0,255,191,0.20); }
        .fieldLabel{ display:block; color: var(--textDim); font-size: 12px; margin: 10px 0 4px; }
        .fieldInput{ width: 100%; }
        .dangerBtn{ border-color: rgba(255,92,122,0.45); background: rgba(255,92,122,0.12); color: #ff8aa0; }
        .dangerBtn:hover{ background: rgba(255,92,122,0.22); }
        .volume{ display:flex; align-items:center; gap: 6px; }
        .volRange{ width: 90px; }
        .downloadLogs{
          margin: 0 16px 12px 16px;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          border-radius: 14px;
          max-height: 180px;
          overflow:auto;
        }
        .downloadLogs pre{
          margin: 0;
          padding: 10px 12px;
          font-size: 12px;
          color: var(--textDim);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .pathLine{
          padding: 0 16px 12px 16px;
          color: var(--textDim);
          font-size: 13px;
        }
        .content{
          flex:1;
          display:grid;
          grid-template-columns: 320px 1fr;
          gap:16px;
          padding: 0 16px 16px 16px;
          min-height: 0;
        }
        .panel{
          border:1px solid var(--border);
          background: rgba(0,0,0,0.22);
          border-radius: 18px;
          overflow:hidden;
          min-height:0;
          display:flex;
          flex-direction:column;
        }
        .panelHeader{
          flex:none;
          padding:12px 14px;
          font-weight:700;
          border-bottom:1px solid var(--border);
          background: rgba(255,255,255,0.03);
        }
        /* The list takes whatever height is left AFTER the header/search row —
           sizing it to the whole panel hid the last item under the panel edge. */
        .list{
          flex:1;
          min-height:0;
          padding:10px;
          overflow:auto;
        }
        .pill{
          padding:10px 12px;
          border-radius: 14px;
          cursor:pointer;
          border:1px solid transparent;
          color: var(--text);
          margin-bottom: 8px;
          background: rgba(255,255,255,0.03);
        }
        .pill.active{
          border-color: rgba(0,255,191,0.35);
          background: rgba(0,255,191,0.10);
        }
        .panelHeader.tabs{ display:flex; gap: 6px; padding: 8px 10px; }
        .tab{
          border: 1px solid transparent;
          background: transparent;
          color: var(--textDim);
          font: inherit; font-weight: 700;
          padding: 5px 10px;
          border-radius: 10px;
          cursor: pointer;
        }
        .tab.active{ color: var(--text); background: rgba(255,255,255,0.06); border-color: var(--border); }
        .tabCount{ color: var(--textDim); font-weight: 500; font-size: 12px; margin-left: 4px; }
        .artistPill{ display:flex; justify-content:space-between; align-items:center; gap: 10px; }
        .artistName{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .artistCount{ color: var(--textDim); font-size: 12px; flex:none; }
        .accentText{ color: var(--accent); }
        .dimText{ color: var(--textDim); font-weight: 500; }
        .searchRow{
          flex:none;
          padding: 10px;
          border-bottom:1px solid var(--border);
          display:flex;
          gap:10px;
          align-items:center;
          background: rgba(0,0,0,0.10);
        }
        .search{
          flex:1;
          border:1px solid var(--border);
          background: rgba(0,0,0,0.18);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          outline:none;
        }
        .trackRow{
          padding:10px 12px;
          border-radius: 14px;
          cursor:pointer;
          border:1px solid transparent;
          background: rgba(255,255,255,0.02);
          margin-bottom:8px;
        }
        .trackRow{ user-select: none; }
        .trackRow.selected{
          border-color: rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.07);
        }
        .trackRow.active{
          border-color: rgba(140,25,255,0.35);
          background: rgba(140,25,255,0.10);
        }
        .trackRow.active.selected{
          border-color: rgba(140,25,255,0.6);
        }

        .player{
          border-top:1px solid var(--border);
          padding: 12px 16px;
          background: rgba(0,0,0,0.25);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        /* Now-playing never grows with the title: fixed share of the bar, one line, ellipsis. */
        .nowPlaying{
          display:flex;
          flex-direction:column;
          gap: 2px;
          flex: 0 1 280px;
          min-width: 180px;
          max-width: 34%;
          /* no overflow:hidden here — it would clip the "Move to…" popup; the children clip themselves */
        }
        .nowPlaying{ flex-direction: row; align-items: center; gap: 10px; }
        .npText{ display:flex; flex-direction:column; gap: 2px; min-width: 0; flex: 1; }
        .npArt{
          width: 46px; height: 46px; flex:none; border-radius: 10px; overflow:hidden;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border);
          display:grid; place-items:center; color: rgba(0,255,191,0.35); font-size: 20px;
        }
        .npArt img{ width:100%; height:100%; object-fit: cover; display:block; }
        .miniArt{
          width: 42px; height: 42px; flex:none; border-radius: 9px; overflow:hidden;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border);
          display:grid; place-items:center; color: rgba(0,255,191,0.35); font-size: 18px;
        }
        .miniArt img{ width:100%; height:100%; object-fit: cover; display:block; }
        .mPlayerArt.hasArt{ padding: 8px 0; }
        .mPlayerArt img{
          width: min(78vw, 100%); max-height: 100%; aspect-ratio: 1; object-fit: cover;
          border-radius: 22px; border: 1px solid var(--border);
          box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);
        }
        .npTitle{ font-weight:800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .npSub{ color: var(--textDim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .controls{
          display:flex;
          align-items:center;
          gap: 10px;
          flex: none;
        }
        .circle{
          width: 44px;
          height: 44px;
          border-radius: 999px;
          border:1px solid var(--border);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          display:grid;
          place-items:center;
          cursor:pointer;
          padding: 0;
        }
        .circle svg{ display:block; }
        /* The timeline always keeps a usable width; it never gets crushed by its neighbours. */
        .timeline{
          flex: 1 1 260px;
          min-width: 260px;
          display:flex;
          align-items:center;
          gap: 10px;
        }
        .time{ color: var(--textDim); font-size: 12px; min-width: 44px; text-align:center; flex:none; }
        /* Sliders: thin purple fill on a faint track, small glowing thumb — no native blue, no white. */
        .range{
          width: 100%; min-width: 0;
          -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 999px; outline: none; margin: 0;
          background: linear-gradient(90deg, #b06cff 0%, #8c19ff var(--p, 0%), rgba(255,255,255,0.10) var(--p, 0%));
        }
        .range::-webkit-slider-thumb{
          -webkit-appearance: none;
          width: 14px; height: 14px; border-radius: 999px;
          background: #d2b4ff;
          border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 3px rgba(140,25,255,0.28);
          cursor: pointer;
        }
        .range::-moz-range-thumb{
          width: 14px; height: 14px; border-radius: 999px;
          background: #d2b4ff; border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 3px rgba(140,25,255,0.28);
        }
        .range::-moz-range-track{ background: transparent; }
        .app.mobile .range{ height: 5px; }
        .app.mobile .range::-webkit-slider-thumb{ width: 18px; height: 18px; }
        .rightInfo{
          display:flex;
          align-items:center;
          gap: 10px;
          color: var(--textDim);
          font-size: 12px;
          flex: none;
          white-space: nowrap;
          justify-content:flex-end;
        }
        /* Narrow window: the timeline takes a full second row under the other controls. */
        @media (max-width: 980px){
          .timeline{ order: 10; flex: 1 1 100%; min-width: 0; }
          .nowPlaying{ max-width: 46%; }
        }
        /* ---------- Phone layout (class "mobile" on .app; desktop untouched) ---------- */
        .app.mobile{ position: relative; }
        .app.mobile .topbar{ padding: 10px 12px; }
        .app.mobile .brand{ font-size: 18px; gap: 8px; }
        .app.mobile .status{ font-size: 11px; padding: 5px 9px; max-width: 48%; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .app.mobile .pathLine{ display:none; }
        .mSettings{ display:flex; flex-wrap: wrap; gap: 8px; align-items:center; padding: 0 12px 10px; }
        .mSettings .downloadInput{ flex: 1 1 160px; min-width: 0; }
        .mFolder{ flex: 1 1 100%; color: var(--textDim); font-size: 12px; word-break: break-all; }
        .queueAdd{ flex: 1 1 100%; display:flex; gap: 8px; align-items:center; margin-top: 4px; }
        .queueAdd .downloadInput{ flex: 1; min-width: 0; }
        .queueAdd{ flex-wrap: wrap; }
        .mLogs{ flex: 1 1 100%; margin: 4px 0 0; max-height: 140px; }
        .queueBox{ flex: 1 1 100%; margin-top: 4px; border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; background: rgba(0,0,0,0.25); }
        .queueTitle{ font-weight: 700; margin-bottom: 8px; }
        .queueRow{ display:flex; align-items:center; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); }
        .queueRow.fresh .queueUrl{ color: var(--accent); }
        .queueUrl{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .app.mobile .content{ display:flex; flex-direction:column; padding: 0 10px 10px; gap: 0; }
        .app.mobile .panel{ flex: 1; border-radius: 16px; }
        .app.mobile .panelHeader{ padding: 10px 12px; }
        .app.mobile .headerRow{ justify-content: flex-start; }
        .app.mobile .headerTitle{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .app.mobile .searchRow{ flex-wrap: wrap; gap: 8px; padding: 8px 10px; }
        .app.mobile .search{ flex: 1 1 120px; min-width: 0; }
        .app.mobile .pill{ padding: 13px 14px; margin-bottom: 6px; }
        .app.mobile .trackRow{ display:flex; align-items:center; gap: 10px; padding: 11px 14px; margin-bottom: 6px; }
        .rowMain{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; }
        .rowSub{ color: var(--textDim); font-size: 12px; margin-top: 2px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rowTick{
          width: 22px; height: 22px; flex:none;
          border: 1px solid var(--border); border-radius: 7px;
          display:grid; place-items:center; font-size: 13px; color: var(--accent);
        }
        .rowTick.on{ border-color: rgba(0,255,191,0.6); background: rgba(0,255,191,0.12); }
        .app.mobile .ddMenu{ max-width: 88vw; }
        .app.mobile .modal{ width: min(440px, 94vw); }
        .mBottom{
          position: relative; z-index: 70; flex:none;
          border-top: 1px solid var(--border);
          background: #141414;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .miniBar{ display:flex; align-items:center; gap: 10px; padding: 8px 12px; cursor:pointer; }
        .miniInfo{ flex: 1; min-width: 0; display:flex; flex-direction:column; gap: 2px; }
        .miniBar .circle{ width: 40px; height: 40px; flex:none; }
        .miniProgress{ height: 2px; background: rgba(255,255,255,0.08); }
        .miniProgress > div{ height: 100%; background: var(--accent); transition: width .25s linear; }
        .tabBar{ display:flex; }
        .tabBtn{
          flex: 1; background: none; border: none;
          color: var(--textDim); font: inherit; font-size: 12px; font-weight: 700;
          padding: 11px 4px 12px; cursor:pointer;
        }
        .tabBtn.active{ color: var(--accent); }
        .tabBtn:disabled{ opacity: 0.35; }
        .mPlayer{
          position: absolute; inset: 0 0 var(--mBottomH, 80px) 0; z-index: 60;
          display:flex; flex-direction:column; gap: 14px;
          padding: 16px 18px 18px;
          background: radial-gradient(700px 500px at 50% 0%, rgba(140,25,255,0.16), transparent 60%),
                      radial-gradient(600px 400px at 50% 100%, rgba(0,255,191,0.10), transparent 60%),
                      var(--bg0);
        }
        .mPlayerTop{ display:flex; align-items:center; justify-content:space-between; gap: 10px; }
        .mPlayerFrom{ flex: 1; min-width: 0; text-align:center; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mPlayerArt{ flex: 1; min-height: 0; display:grid; place-items:center; font-size: 110px; color: rgba(0,255,191,0.22); }
        .mPlayerTitle{ font-size: 21px; font-weight: 800; text-align:center; word-break: break-word; }
        .mPlayerSub{ color: var(--textDim); text-align:center; min-height: 1.2em; }
        .app.mobile .timeline{ flex: none; min-width: 0; }
        .mPlayerControls{ display:flex; align-items:center; justify-content:center; gap: 14px; }
        .mPlayerControls .circle{ width: 52px; height: 52px; font-size: 18px; }
        .circle.big{
          width: 68px !important; height: 68px !important; font-size: 24px !important;
          border-color: rgba(0,255,191,0.45); background: rgba(0,255,191,0.12); color: var(--accent);
        }
        .mPlayerAdd{ display:flex; justify-content:center; }
        .mPlayerAdd .ddMenu{ left: 50%; transform: translateX(-50%); }
        /* Scrollbars */
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) rgba(0,0,0,0.25);
        }

        *::-webkit-scrollbar { width: 10px; height: 10px; }
        *::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.25);
          border-radius: 999px;
        }
        *::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 999px;
          border: 2px solid rgba(0,0,0,0.25);
        }
        *::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.24);
        }
      `}</style>

      <div className="topbar">
        <div className="brand">
          <div>Soundhood</div>
          {isMobile ? (
            <button className={`iconBtn ${mSettings ? "primaryBtn" : ""}`} onClick={() => setMSettings((v) => !v)} title="Library folder · rescan">
              <GearIcon />
            </button>
          ) : (
            <button className="btn" onClick={importFolder}>Import</button>
          )}
          {folder && !isMobile ? (
            <button className="btn" onClick={rescanLibrary} title="Re-read the Music folder">
              Rescan
            </button>
          ) : null}
        </div>
        <div className="status">{isMobile ? status : `Status: ${status}`}</div>
      </div>

      {isMobile && mSettings ? (
        <div className="mSettings">
          <div className="mFolder">{folder ? `Library: ${folder}` : "Type the folder that holds your music, then tap Use."}</div>
          <input
            className="downloadInput"
            placeholder="/storage/emulated/0/Music"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") importFolderPath(pathInput); }}
          />
          <button className="btn" onClick={() => importFolderPath(pathInput)} disabled={!pathInput.trim()}>Use</button>
          {folder ? <button className="btn" onClick={rescanLibrary} title="Re-read the Music folder">Rescan</button> : null}
          <div className="queueAdd">
            <input
              className="downloadInput"
              placeholder="Paste a YouTube link…"
              inputMode="url"
              value={queueInput}
              onChange={(e) => setQueueInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && queueLink(queueInput)) setQueueInput(""); }}
            />
            <button className="btn" onClick={() => { if (queueLink(queueInput)) setQueueInput(""); }} disabled={!queueInput.trim()}>Add</button>
            <button className="btn" onClick={pasteLink} title="Read the link from the clipboard">Paste</button>
          </div>
          {dlBusy ? (
            <div className="queueBox">
              <div className="queueTitle headerRow">
                <span>Downloading… {dlProgress >= 0 ? `${Math.round(dlProgress)}%` : ""} <span className="tabCount">{dlSeconds}s</span></span>
                <button className="btn" onClick={cancelPhoneDownload}>Cancel</button>
              </div>
              <div className="miniProgress"><div style={{ width: `${dlProgress >= 0 ? dlProgress : 0}%` }} /></div>
            </div>
          ) : null}
          {dlLogs ? (
            <div className="downloadLogs mLogs"><pre>{dlLogs.slice(-3000)}</pre></div>
          ) : null}
          <div className="queueAdd">
            <button className="btn" onClick={updateYtdlp} disabled={ytdlpBusy || dlBusy} title="Fetch the newest yt-dlp inside the app (YouTube changes often)">
              {ytdlpBusy ? "Updating…" : "Update yt-dlp"}
            </button>
            {ytdlpVersion ? <span className="modalHint" style={{ marginTop: 0 }}>yt-dlp {ytdlpVersion}</span> : null}
            <button className="btn" onClick={netcheck} disabled={ytdlpBusy || dlBusy} title="Can the bundled python reach YouTube? (DNS, TCP, HTTPS)">Network check</button>
            {shareQueue.length ? (
              <button className="btn primaryBtn" onClick={runQueue} disabled={dlBusy}>Download queue ({shareQueue.length})</button>
            ) : null}
            {dlLogs ? <button className="btn" onClick={copyLog} title="Copy the whole log to the clipboard">Copy log</button> : null}
            {dlLogs ? <button className="btn" onClick={() => setDlLogs("")}>Clear log</button> : null}
          </div>
          {shareQueue.length ? (
            <div className="queueBox">
              <div className="queueTitle">
                Links to download <span className="tabCount">{shareQueue.length}</span>
                <span className="modalHint" style={{ marginTop: 0 }}> · queued on this device; "Download queue" runs them here, or the PC picks them up with the Music folder</span>
              </div>
              {shareQueue.map((q) => (
                <div key={q.url} className={`queueRow ${q.url === sharedLink ? "fresh" : ""}`}>
                  <span className="queueUrl">
                    {q.url}
                    <div className="rowSub">→ {q.target || DEFAULT_DOWNLOAD_TARGET}{q.playlists?.length ? ` · ${q.playlists.join(", ")}` : ""}</div>
                  </span>
                  <button className="linkBtn" onClick={() => { try { navigator.clipboard.writeText(q.url); setStatus("Link copied"); } catch { /* no clipboard */ } }}>copy</button>
                  <button className="iconBtn small danger" title="Remove from the list" onClick={() => saveQueue(shareQueue.filter((x) => x.url !== q.url))}><TrashIcon /></button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pathLine">
        {folder ? `Folder: ${folder}` : "Pick a folder to begin."}
      </div>

      {!isMobile ? (
      <div className="downloadBar">
        <input
          className="downloadInput"
          placeholder="Paste a YouTube URL and hit Download…"
          value={downloadUrl}
          onChange={(e) => setDownloadUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") startManualDownload();
          }}
        />
        <span className="targetLabel">into</span>
        {newFolderMode ? (
          <>
            <input
              className="downloadInput targetNew"
              placeholder="New playlist folder…"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") chooseTarget(newFolderName);
                if (e.key === "Escape") setNewFolderMode(false);
              }}
            />
            <button className="btn" onClick={() => chooseTarget(newFolderName)} disabled={!newFolderName.trim()}>
              OK
            </button>
          </>
        ) : (
          <Dropdown
            value={dlTarget}
            options={targetOptions}
            title="Playlist folder the download lands in"
            extra={{ label: "+ New folder…", value: NEW_FOLDER_SENTINEL }}
            onSelect={(v) => {
              if (v === NEW_FOLDER_SENTINEL) setNewFolderMode(true);
              else chooseTarget(v);
            }}
          />
        )}
        <span className="targetLabel">+ playlists</span>
        <MultiDropdown
          values={dlPlaylists}
          options={playlistFiles.map((p) => p.name)}
          onChange={chooseDlPlaylists}
          placeholder="none"
          title="Playlists the downloaded track is added to (remembered)"
        />
        <button className="btn" onClick={startManualDownload} disabled={dlBusy || !downloadUrl.trim()}>
          {dlBusy ? "Downloading…" : "Download"}
        </button>
        <button className="btn" onClick={() => setDlLogs("")} disabled={!dlLogs}>
          Clear logs
        </button>
        {shareQueue.length ? (
          <button className="btn primaryBtn" onClick={runQueue} disabled={dlBusy} title="Download every queued link (shared from the phone), each into its chosen folder and playlists">
            Download queue ({shareQueue.length})
          </button>
        ) : null}
      </div>
      ) : null}

      {dlLogs && !isMobile ? (
        <div className="downloadLogs">
          <pre>{dlLogs}</pre>
        </div>
      ) : null}

      <div className="content">
        {!isMobile || mScreen === "browse" ? (
        <div className="panel">
          <div className="panelHeader tabs">
            <button className={`tab ${sideTab === "playlists" ? "active" : ""}`} onClick={() => setSideTab("playlists")}>
              Playlists <span className="tabCount">{playlistFiles.length}</span>
            </button>
            <button className={`tab ${sideTab === "artists" ? "active" : ""}`} onClick={() => setSideTab("artists")}>
              Artists <span className="tabCount">{artists.length}</span>
            </button>
            <button className={`tab ${sideTab === "folders" ? "active" : ""}`} onClick={() => setSideTab("folders")} title="Where the files are stored">
              Folders
            </button>
          </div>

          {sideTab === "playlists" ? (
            <>
              <div className="searchRow">
                {newPlaylistMode ? (
                  <>
                    <input
                      className="search"
                      placeholder="New playlist name…"
                      autoFocus
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") createPlaylist(newPlaylistName);
                        if (e.key === "Escape") setNewPlaylistMode(false);
                      }}
                    />
                    <button className="btn" onClick={() => createPlaylist(newPlaylistName)} disabled={!newPlaylistName.trim()}>OK</button>
                  </>
                ) : (
                  <>
                    <input
                      className="search"
                      placeholder="Filter playlists…"
                      value={plQuery}
                      onChange={(e) => setPlQuery(e.target.value)}
                    />
                    <button className="btn" title="New playlist" onClick={() => setNewPlaylistMode(true)} disabled={!folder}>+</button>
                  </>
                )}
              </div>
              <div className="list">
                {playlistFiles.length === 0 && folder ? (
                  <div className="migrateBox">
                    <div className="modalTrack">No playlist files yet</div>
                    <div className="modalHint" style={{ margin: "6px 0 10px" }}>
                      Playlists now live as small <code>.m3u8</code> files in <code>{folder}\_Playlists</code>, so a song can be in several at once.
                      Create one per existing folder to start from what you have — nothing moves on disk.
                    </div>
                    <button className="btn primaryBtn" onClick={createPlaylistsFromFolders}>Create playlists from folders</button>
                  </div>
                ) : null}
                <div
                  className={`pill ${!plView && !artistView && playlist === "(all)" ? "active" : ""}`}
                  onClick={() => { setPlView(""); setArtistView(""); setPlaylist("(all)"); goTracks(); }}
                  onDoubleClick={() => shufflePlayFolder("(all)")}
                  title="Everything · double-click to shuffle-play the whole library"
                >
                  (all)
                </div>
                {shownPlaylistFiles.map((p) => (
                  <div
                    key={p.name}
                    className={`pill artistPill ${p.name === plView ? "active" : ""}`}
                    onClick={() => { if (isMobile) { openPlaylistView(p.name); goTracks(); } else if (plView === p.name) setPlView(""); else openPlaylistView(p.name); }}
                    onDoubleClick={() => shufflePlayPlaylist(p.name)}
                    title="Click to open · double-click to shuffle-play"
                  >
                    <span className="artistName">{p.name}</span>
                    <span className="artistCount">{p.entries.length}</span>
                  </div>
                ))}
              </div>
            </>
          ) : sideTab === "folders" ? (
            <>
              <div className="searchRow">
                <input
                  className="search"
                  placeholder="Filter folders…"
                  value={playlistQuery}
                  onChange={(e) => setPlaylistQuery(e.target.value)}
                />
              </div>
              <div className="list">
                {shownPlaylists.map((p) => (
                  <div
                    key={p}
                    className={`pill ${!artistView && !plView && p === playlist ? "active" : ""}`}
                    onClick={() => {
                      setArtistView("");
                      setPlView("");
                      setPlaylist(p);
                      goTracks();
                    }}
                    onDoubleClick={() => shufflePlayFolder(p)}
                    title="Click to open · double-click to shuffle-play"
                  >
                    {p}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="searchRow">
                <input
                  className="search"
                  placeholder="Filter artists…"
                  value={artistQuery}
                  onChange={(e) => setArtistQuery(e.target.value)}
                />
              </div>
              <div className="list">
                {shownArtists.map((a) => (
                  <div
                    key={a.name}
                    className={`pill artistPill ${a.name === artistView ? "active" : ""}`}
                    onClick={() => { setPlView(""); if (isMobile) { setArtistView(a.name); goTracks(); } else setArtistView((cur) => (cur === a.name ? "" : a.name)); }}
                    onDoubleClick={() => shufflePlayArtist(a.name)}
                    title={`All ${a.count} track${a.count === 1 ? "" : "s"} by ${a.name}, across every folder · double-click to shuffle-play`}
                  >
                    <span className="artistName">{a.name}</span>
                    <span className="artistCount">{a.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        ) : null}

        {!isMobile || mScreen === "tracks" ? (
        <div className="panel">
          <div className="panelHeader headerRow">
            {isMobile ? (
              <button className="iconBtn small" onClick={() => setMScreen("browse")} title="Back"><ChevronIcon dir="left" size={16} /></button>
            ) : null}
            <span className="headerTitle">
              {plView ? (
                <>
                  <span className="accentText">{plView}</span>
                  <span className="dimText"> · playlist · {currentPlaylistFile?.entries.length ?? 0}</span>
                </>
              ) : artistView ? (
                <>
                  Tracks · <span className="accentText">{artistView}</span>
                  <span className="dimText"> · all folders</span>
                </>
              ) : playlist !== "(all)" ? (
                <>
                  <span className="accentText">{playlist}</span>
                  <span className="dimText"> · folder</span>
                </>
              ) : (
                "Tracks"
              )}
            </span>
            {plView ? (
              <button
                className="iconBtn danger small"
                title={`Delete the playlist "${plView}" (the songs stay)`}
                onClick={() => setConfirmDeletePlaylist(plView)}
              >
                <TrashIcon />
              </button>
            ) : null}
          </div>
          <div className="searchRow">
            <input
              className="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Dropdown
              className="sortDd"
              value={sortMode}
              options={[...SORT_MODES]}
              title="Sort the track list"
              onSelect={(v) => chooseSort(v as SortMode)}
            />
            {selectedTracks.length > 1 ? (
              <span className="selCount" title="Esc clears the selection">
                {selectedTracks.length} selected
                <button className="linkBtn" onClick={() => setSelectedPaths(new Set())}>clear</button>
              </span>
            ) : null}
            {selectedTracks.length > 0 ? (
              <Dropdown
                value=""
                placeholder={selectedTracks.length > 1 ? `Add ${selectedTracks.length} to playlist…` : "Add to playlist…"}
                title="Add the selected track(s) to a playlist"
                options={playlistFiles
                  .filter((p) => !selectedTracks.every((t) => inPlaylist(p, t)))
                  .map((p) => p.name)}
                extra={{ label: "+ New playlist…", value: NEW_PLAYLIST_SENTINEL }}
                onSelect={(v) => {
                  if (v === NEW_PLAYLIST_SENTINEL) {
                    setSideTab("playlists");
                    setNewPlaylistMode(true);
                  } else addToPlaylist(v, selectedTracks);
                }}
              />
            ) : null}
            {selectedTracks.length > 0 && plView && currentPlaylistFile && selectedTracks.some((t) => inPlaylist(currentPlaylistFile, t)) ? (
              <button
                className="btn"
                title={`Remove the selected track(s) from ${plView} (the files stay)`}
                onClick={() => removeFromPlaylist(plView, selectedTracks)}
              >
                Remove{selectedTracks.length > 1 ? ` ${selectedTracks.length}` : ""} from playlist
              </button>
            ) : null}
            {selectedTracks.length > 0 && sideTab === "folders" ? (
              <Dropdown
                value=""
                placeholder={selectedTracks.length > 1 ? `Move ${selectedTracks.length} files to…` : "Move file to…"}
                title="Move the selected file(s) to another folder (playlists follow)"
                options={targetOptions.filter((name) => !selectedTracks.every((t) => (t.playlist || "(root)") === name))}
                onSelect={(target) => moveTracksTo(selectedTracks, target)}
              />
            ) : null}
            {selectedTrack ? (
              <button
                className="iconBtn"
                title={`Edit the tags of "${displayName(selectedTrack.name)}"`}
                onClick={() => openTagEditor(selectedTrack)}
              >
                <PencilIcon />
              </button>
            ) : null}
            {selectedTracks.length > 0 ? (
              <button
                className="iconBtn danger"
                title={selectedTracks.length > 1 ? `Delete ${selectedTracks.length} tracks (to the Recycle Bin)` : `Delete "${displayName(selectedTracks[0].name)}" (to the Recycle Bin)`}
                onClick={() => setConfirmDelete(selectedTracks)}
              >
                <TrashIcon />
              </button>
            ) : null}
            {isMobile ? (
              <button
                className={`btn ${mSelectMode ? "primaryBtn" : ""}`}
                title="Tick songs instead of playing them"
                onClick={() => { if (mSelectMode) setSelectedPaths(new Set()); setMSelectMode((v) => !v); }}
              >
                {mSelectMode ? "Done" : "Select"}
              </button>
            ) : (
              <button
                className="btn"
                disabled={fixBusy || filteredTracks.length === 0}
                title="Rewrite the title/artist tags of every track listed here from its 'Song - Artist' filename"
                onClick={() => setConfirmFix(true)}
              >
                {fixBusy ? "Writing…" : "Tags ← names"}
              </button>
            )}
            <button
              className={`shuffleBtn ${shuffle ? "on" : ""}`}
              onClick={() => setShuffle((s) => !s)}
              title={shuffle ? "Shuffle is on — click to play in order" : "Shuffle is off — click to shuffle"}
              aria-pressed={shuffle}
            >
              <ShuffleIcon on={shuffle} />
            </button>
          </div>
          <div className="list">
            {filteredTracks.map((t) => (
              <div
                key={t.path}
                className={`trackRow ${t.path === currentPath ? "active" : ""} ${selectedPaths.has(t.path) ? "selected" : ""}`}
                onClick={(e) => { if (!isMobile) onRowClick(e, t); else if (mSelectMode) toggleRow(t); else loadAndPlay(t); }}
                onDoubleClick={() => { if (!isMobile) loadAndPlay(t); }}
                title={isMobile ? undefined : "Click to select · Ctrl+click adds · Shift+click ranges · double-click plays"}
              >
                {isMobile && mSelectMode ? <span className={`rowTick ${selectedPaths.has(t.path) ? "on" : ""}`}>{selectedPaths.has(t.path) ? "✓" : ""}</span> : null}
                <span className="rowMain">
                  {displayName(t.name)}
                  {isMobile && t.artist ? <div className="rowSub">{t.artist}</div> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
        ) : null}
      </div>

      {!isMobile ? (
      <div className="player">
        <div className="nowPlaying">
          <div className="npArt">{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
          <div className="npText">
          <div className="npTitle">{currentName || "Nothing playing"}</div>
          <div className="npSub">
            {currentPlaylist
              ? `${currentTrack?.artist ? currentTrack.artist + " • " : ""}${currentPlaylist}`
              : `All playlists • ${allTracks.length} tracks`}
          </div>
          {currentPath ? (
            <Dropdown
              className="ddSmall"
              up
              value=""
              placeholder="Add to playlist…"
              title="Add the playing track to a playlist"
              options={playlistFiles.filter((p) => !(currentTrack && inPlaylist(p, currentTrack))).map((p) => p.name)}
              onSelect={(name) => { if (currentTrack) addToPlaylist(name, [currentTrack]); }}
            />
          ) : null}
          </div>
        </div>

        <div className="controls">
          <button className="circle" onClick={playPrev} title="Previous"><PrevIcon /></button>
          <button className="circle" onClick={togglePlay} title="Play/Pause">{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
          <button className="circle" onClick={playNext} title="Next"><NextIcon /></button>
        </div>

        <div className="timeline">
          <div className="time">{formatTime(progress)}</div>
          <input
            className="range"
            type="range"
            style={{ "--p": `${duration ? (clamp(progress, 0, duration) / duration) * 100 : 0}%` } as CSSProperties}
            min={0}
            max={duration || 0}
            step={0.25}
            value={clamp(progress, 0, duration || 0)}
            onChange={(e) => {
              const audio = audioRef.current;
              if (!audio) return;
              const v = Number(e.target.value);
              audio.currentTime = clamp(v, 0, audio.duration || 0);
              setProgress(audio.currentTime);
            }}
          />
          <div className="time">{formatTime(duration)}</div>
        </div>

        <div className="rightInfo">
          <div className="volume" title={`Volume ${Math.round(volume * 100)}%`}>
            <span>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
            <input
              className="range volRange"
              type="range"
              style={{ "--p": `${volume * 100}%` } as CSSProperties}
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
          <div style={{ opacity: 0.35 }}>•</div>
          <button
            className={`shuffleBtn ${shuffle ? "on" : ""}`}
            onClick={() => setShuffle((s) => !s)}
            title={shuffle ? "Shuffle is on — click to play in order" : "Shuffle is off — click to shuffle"}
            aria-pressed={shuffle}
          >
            <ShuffleIcon on={shuffle} />
          </button>
          <div style={{ opacity: 0.35 }}>•</div>
          <div>{currentIndex >= 0 ? `${currentIndex + 1}/${shownCount}` : `0/${shownCount}`}</div>
        </div>

      </div>
      ) : null}

      {isMobile ? (
        <div className="mBottom" ref={mBottomRef}>
          {currentPath && mScreen !== "player" ? (
            <div className="miniBar" onClick={() => setMScreen("player")} title="Open the player">
              <div className="miniArt">{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
              <div className="miniInfo">
                <div className="npTitle">{currentName}</div>
                <div className="npSub">{currentTrack?.artist || currentPlaylist || ""}</div>
              </div>
              <button className="circle" onClick={(e) => { e.stopPropagation(); togglePlay(); }} title="Play/Pause">{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
              <button className="circle" onClick={(e) => { e.stopPropagation(); playNext(); }} title="Next"><NextIcon /></button>
            </div>
          ) : null}
          {currentPath && mScreen !== "player" ? (
            <div className="miniProgress"><div style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} /></div>
          ) : null}
          <nav className="tabBar">
            <button className={`tabBtn ${mScreen !== "player" && sideTab === "playlists" ? "active" : ""}`} onClick={() => { setSideTab("playlists"); setMScreen("browse"); }}>Playlists</button>
            <button className={`tabBtn ${mScreen !== "player" && sideTab === "artists" ? "active" : ""}`} onClick={() => { setSideTab("artists"); setMScreen("browse"); }}>Artists</button>
            <button className={`tabBtn ${mScreen !== "player" && sideTab === "folders" ? "active" : ""}`} onClick={() => { setSideTab("folders"); setMScreen("browse"); }}>Folders</button>
            <button className={`tabBtn ${mScreen === "player" ? "active" : ""}`} onClick={() => setMScreen("player")} disabled={!currentPath}>Playing</button>
          </nav>
        </div>
      ) : null}

      {isMobile && mScreen === "player" ? (
        <div className="mPlayer">
          <div className="mPlayerTop">
            <button className="iconBtn" onClick={() => setMScreen("tracks")} title="Back to the list"><ChevronIcon dir="down" /></button>
            <div className="dimText mPlayerFrom">{currentPlaylist || "All tracks"}</div>
            <div className="dimText">{currentIndex >= 0 ? `${currentIndex + 1}/${shownCount}` : `0/${shownCount}`}</div>
          </div>
          <div className={`mPlayerArt ${coverUrl ? "hasArt" : ""}`}>{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
          <div className="mPlayerTitle">{currentName || "Nothing playing"}</div>
          <div className="mPlayerSub">{currentTrack?.artist || " "}</div>
          <div className="timeline">
            <div className="time">{formatTime(progress)}</div>
            <input
              className="range"
              type="range"
              style={{ "--p": `${duration ? (clamp(progress, 0, duration) / duration) * 100 : 0}%` } as CSSProperties}
              min={0}
              max={duration || 0}
              step={0.25}
              value={clamp(progress, 0, duration || 0)}
              onChange={(e) => {
                const audio = audioRef.current;
                if (!audio) return;
                const v = Number(e.target.value);
                audio.currentTime = clamp(v, 0, audio.duration || 0);
                setProgress(audio.currentTime);
              }}
            />
            <div className="time">{formatTime(duration)}</div>
          </div>
          <div className="mPlayerControls">
            <button
              className={`shuffleBtn ${shuffle ? "on" : ""}`}
              onClick={() => setShuffle((s) => !s)}
              aria-pressed={shuffle}
              title={shuffle ? "Shuffle is on" : "Shuffle is off"}
            >
              <ShuffleIcon on={shuffle} />
            </button>
            <button className="circle" onClick={playPrev} title="Previous"><PrevIcon size={22} /></button>
            <button className="circle big" onClick={togglePlay} title="Play/Pause">{isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}</button>
            <button className="circle" onClick={playNext} title="Next"><NextIcon size={22} /></button>
            <span className="shuffleBtn" style={{ visibility: "hidden" }} />
          </div>
          {currentPath ? (
            <div className="mPlayerAdd">
              <Dropdown
                up
                value=""
                placeholder="Add to playlist…"
                title="Add the playing track to a playlist"
                options={playlistFiles.filter((p) => !(currentTrack && inPlaylist(p, currentTrack))).map((p) => p.name)}
                onSelect={(name) => { if (currentTrack) addToPlaylist(name, [currentTrack]); }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {queueDraft ? (
        <div className="modalBackdrop" onMouseDown={() => setQueueDraft(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Where should this go?</div>
            <div className="modalHint" style={{ wordBreak: "break-all", marginBottom: 10 }}>{queueDraft.url}</div>
            <label className="fieldLabel">Folder it lands in</label>
            <Dropdown
              value={queueDraft.target}
              options={targetOptions}
              title="Storage folder for the file(s)"
              onSelect={(v) => setQueueDraft({ ...queueDraft, target: v })}
            />
            <label className="fieldLabel">Playlists it joins</label>
            <MultiDropdown
              values={queueDraft.playlists}
              options={playlistFiles.map((p) => p.name)}
              onChange={(next) => setQueueDraft({ ...queueDraft, playlists: next })}
              placeholder="none"
              title="Every file this link produces is added to these playlists"
            />
            <div className="modalHint" style={{ marginTop: 10 }}>
              A playlist link produces several files; all of them get the same folder and playlists.
              {" "}"Queue" keeps it for later (or for the PC); "Download" starts right away on this device.
            </div>
            <div className="modalActions">
              <button className="btn" onClick={() => setQueueDraft(null)}>Cancel</button>
              <button className="btn" onClick={() => confirmQueueDraft(false)}>Queue</button>
              <button className="btn primaryBtn" onClick={() => confirmQueueDraft(true)} disabled={dlBusy} autoFocus>Download</button>
            </div>
          </div>
        </div>
      ) : null}

      {editTags ? (
        <div className="modalBackdrop" onMouseDown={() => setEditTags(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Edit tags</div>
            <div className="modalHint" style={{ marginBottom: 12 }}>{editTags.track.name}</div>
            <label className="fieldLabel">Title</label>
            <input
              className="downloadInput fieldInput"
              value={editTags.title}
              autoFocus
              onChange={(e) => setEditTags({ ...editTags, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") saveTags(); }}
            />
            <label className="fieldLabel">Artist</label>
            <input
              className="downloadInput fieldInput"
              value={editTags.artist}
              onChange={(e) => setEditTags({ ...editTags, artist: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") saveTags(); }}
            />
            <div className="modalActions">
              <button
                className="btn"
                title="Fill both fields from the filename ('Song - Artist')"
                onClick={() => setEditTags({ ...editTags, ...titleArtistFromName(editTags.track.name) })}
              >
                From filename
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => setEditTags(null)}>Cancel</button>
              <button className="btn primaryBtn" onClick={saveTags}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmFix ? (
        <div className="modalBackdrop" onMouseDown={() => setConfirmFix(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Write tags from filenames?</div>
            <div className="modalBody">
              <div className="modalTrack">{filteredTracks.length} track{filteredTracks.length === 1 ? "" : "s"} currently listed</div>
              <div className="modalHint">
                Conservative: a file's title/artist tag is replaced from its "Song - Artist" name only when the tag is <b>empty</b> or looks like raw YouTube output
                ("(Official Video)", "[Lyric Video]", "| Channel", a video id…). Curated tags — even ones that differ from a shortened filename — are kept.
                This edits the files themselves; the phone and other players will show the result.
              </div>
            </div>
            <div className="modalActions">
              <button className="btn" onClick={() => setConfirmFix(false)} autoFocus>Cancel</button>
              <button className="btn primaryBtn" onClick={fixTagsFromFilenames} disabled={fixBusy}>Write tags</button>
            </div>
          </div>
        </div>
      ) : null}

      {fixReport ? (
        <div className="modalBackdrop" onMouseDown={() => setFixReport(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Tags written</div>
            <div className="modalBody">
              <div className="modalTrack">
                {fixReport.updated} updated · {fixReport.skipped} kept as they were
                {fixReport.failed.length ? ` · ${fixReport.failed.length} failed` : ""}
              </div>
              {fixReport.failed.length ? (
                <div className="modalHint" style={{ whiteSpace: "pre-wrap" }}>{fixReport.failed.slice(0, 8).join("\n")}</div>
              ) : null}
            </div>
            <div className="modalActions">
              <button className="btn primaryBtn" onClick={() => setFixReport(null)} autoFocus>OK</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeletePlaylist ? (
        <div className="modalBackdrop" onMouseDown={() => setConfirmDeletePlaylist("")}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete this playlist?</div>
            <div className="modalBody">
              <div className="modalTrack">{confirmDeletePlaylist}</div>
              <div className="modalHint">Only the playlist file goes to the Recycle Bin. The songs stay exactly where they are.</div>
            </div>
            <div className="modalActions">
              <button className="btn" onClick={() => setConfirmDeletePlaylist("")} autoFocus>Cancel</button>
              <button className="btn dangerBtn" onClick={() => deletePlaylist(confirmDeletePlaylist)}>Delete playlist</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="modalBackdrop" onMouseDown={() => setConfirmDelete(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">{confirmDelete.length > 1 ? `Delete ${confirmDelete.length} tracks?` : "Delete this track?"}</div>
            <div className="modalBody">
              <div className="modalTrack" style={{ maxHeight: 160, overflow: "auto" }}>
                {confirmDelete.slice(0, 12).map((t) => (
                  <div key={t.path}>{displayName(t.name)}</div>
                ))}
                {confirmDelete.length > 12 ? <div className="dimText">…and {confirmDelete.length - 12} more</div> : null}
              </div>
              <div className="modalHint">
                {isMobile
                  ? "On the phone there is no Recycle Bin: the files are deleted for real. Playlists are updated."
                  : "The files go to the Windows Recycle Bin, so this can be undone from there. Playlists are updated."}
              </div>
            </div>
            <div className="modalActions">
              <button className="btn" onClick={() => setConfirmDelete(null)} autoFocus>Cancel</button>
              <button className="btn dangerBtn" onClick={() => deleteTracks(confirmDelete)}>
                {confirmDelete.length > 1 ? `Delete ${confirmDelete.length}` : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
