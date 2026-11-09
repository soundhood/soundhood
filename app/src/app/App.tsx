import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, addPluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { batchLogLines, capLog, copyLogText, diagnosticsLines, libraryKey, undoStatus } from "../coreIpc";
import type { BatchReport, ChangeSummary, Diagnostics, RefreshReport, SelfTestReport } from "../coreIpc";
import { CHANNEL_REFUSAL, isChannelLink, queueStopStatus } from "../downloads";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { SYNC_OFF_LINE, isTestLibrary, shownFolder } from "../testLibrary";
import { clamp, formatTime } from "../lib/format";
import { firstUrl, isPlaylistLink } from "../lib/links";
import {
  DEFAULT_DOWNLOAD_TARGET,
  KEY_DEV_MODE,
  KEY_DOWNLOAD_PLAYLISTS,
  KEY_DOWNLOAD_TARGET,
  KEY_FIXTURE_ROOT,
  KEY_LAST_SYNC,
  KEY_LIBRARY_DIR,
  KEY_REAL_LIBRARY_DIR,
  KEY_SHARE_QUEUE,
  KEY_SORT,
  KEY_VOLUME,
  NEW_FOLDER_SENTINEL,
  storePromise,
} from "../lib/store";
import { NEW_PLAYLIST_SENTINEL, SORT_MODES, UNTAGGED, displayName, relKey, sortTracks, splitArtists, titleArtistFromName } from "../lib/tracks";
import type { SortMode } from "../lib/tracks";
import type { PhoneDownloadResult, PlaylistFile, QueuedLink, Track } from "../lib/types";
import { Dropdown, MultiDropdown } from "./legacy/Dropdown";
import { ChevronIcon, GearIcon, NextIcon, PauseIcon, PencilIcon, PlayIcon, PrevIcon, ShuffleIcon, TrashIcon } from "./legacy/icons";
import { LEGACY_STYLES } from "./legacyStyles";

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
  // Tag editor (single track).
  const [editTags, setEditTags] = useState<{ track: Track; title: string; artist: string } | null>(null);
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
  // Height of the phone's bottom block (mini player + tabs + gesture bar): the full-screen player
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
    if (isChannelLink(url)) { refuseChannelLink(); return false; }
    setQueueDraft({ url, target: dlTarget || DEFAULT_DOWNLOAD_TARGET, playlists: dlPlaylistsRef.current });
    return true;
  }
  function confirmQueueDraft(downloadNow: boolean) {
    const d = queueDraft;
    if (!d) return;
    const check = checkFolderName(d.target || DEFAULT_DOWNLOAD_TARGET);
    if (!check.ok) {
      setStatus(folderNameRefusal(d.target, check.reason));
      return;
    }
    const item: QueuedLink = { url: d.url, added: Date.now(), target: check.name, playlists: d.playlists };
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
    if (!folder || isMobile) return;
    const t = setInterval(() => loadQueueFromLibrary(folder), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // "Undo last change": the newest change on this device that can still be undone (from the
  // journal), re-read after every command that writes, after a rescan and after an undo.
  const [lastChange, setLastChange] = useState<ChangeSummary | null>(null);
  const [undoBusy, setUndoBusy] = useState<boolean>(false);
  const lastChangeSeqRef = useRef<number>(0);
  async function refreshLastChange(lib: string = folderRef.current) {
    const seq = ++lastChangeSeqRef.current; // only the newest answer counts
    if (!lib) { setLastChange(null); return; }
    try {
      const c = await invoke<ChangeSummary | null>("last_change", { libraryDir: lib });
      if (seq === lastChangeSeqRef.current) setLastChange(c ?? null);
    } catch {
      if (seq === lastChangeSeqRef.current) setLastChange(null);
    }
  }

  /** Appends lines to the log, keeping only its tail once it grows long. */
  function appendLog(lines: string[]) {
    if (lines.length) setDlLogs((prev) => capLog(prev) + lines.join("\n") + "\n");
  }

  // Lines kept only for "Copy log": every applied batch (core:batch) and the developer switch. The
  // visible log keeps what it showed before the rebuild (downloads, Proton, the network check), so
  // an edit never opens the log panel on the desktop or adds lines to the phone's settings log.
  const quietLogRef = useRef<string>("");
  function appendQuietLog(lines: string[]) {
    if (lines.length) quietLogRef.current = capLog(quietLogRef.current) + lines.join("\n") + "\n";
  }
  /** "Clear log": the visible log and the lines kept for copying. */
  function clearLog() {
    setDlLogs("");
    quietLogRef.current = "";
  }

  // Output of the download in flight (its tail), for the reason a queued download stopped.
  const dlOutputRef = useRef<string>("");
  function noteDlOutput(text: string) {
    if (text) dlOutputRef.current = (dlOutputRef.current + text).slice(-4000);
  }

  /** A channel link is refused where it enters (paste, share, queue, download), in one plain line. */
  function refuseChannelLink() {
    appendLog([`[error] ${CHANNEL_REFUSAL}`]);
    setStatus(CHANNEL_REFUSAL);
  }

  // Hidden developer section (brief §5.9 Tools): "Test library", "Run self-test", "Rebuild
  // index". Shown after 7 taps on the status pill (phone) or Ctrl+Alt+Shift+D (desktop); remembered.
  const [devMode, setDevMode] = useState<boolean>(false);
  const devModeRef = useRef<boolean>(false);
  devModeRef.current = devMode;
  // The fixture root the host returned (remembered); the test library is shown when the current
  // library is that folder.
  const [fixtureRoot, setFixtureRoot] = useState<string>("");
  const fixtureOn = isTestLibrary(folder, fixtureRoot);
  const [devBusy, setDevBusy] = useState<"" | "fixture" | "selftest" | "rebuild">("");
  const statusTapsRef = useRef<{ n: number; at: number }>({ n: 0, at: 0 });

  async function toggleDevMode() {
    const next = !devModeRef.current;
    devModeRef.current = next;
    setDevMode(next);
    setStatus(next ? "Developer tools on" : "Developer tools off");
    try {
      const store = await storePromise;
      await store.set(KEY_DEV_MODE, next);
      await store.save();
    } catch { /* non-fatal: it still applies for this session */ }
  }

  // Seven taps in a row on the phone's status pill, each within 1.5 s of the previous one.
  function onStatusTap() {
    if (!isMobile) return;
    const now = Date.now();
    const taps = statusTapsRef.current;
    taps.n = now - taps.at < 1500 ? taps.n + 1 : 1;
    taps.at = now;
    if (taps.n >= 7) {
      taps.n = 0;
      toggleDevMode();
    }
  }

  // "Test library": on = remember the real library and point the app at the generated test
  // library (created by the host on first use); off = go back to the remembered library. The state
  // itself is never stored: it follows from the shown library being the fixture root.
  async function switchFixtureRoot(enable: boolean) {
    if (devBusy) return;
    setDevBusy("fixture");
    try {
      const store = await storePromise;
      if (enable) {
        const current = folderRef.current;
        const r = await invoke<{ root: string }>("dev_fixture_root", { enable: true });
        if (!r?.root) throw new Error("the host returned no fixture folder");
        await store.set(KEY_FIXTURE_ROOT, r.root);
        // Only a real library is remembered, never the test library itself.
        if (current && !isTestLibrary(current, r.root)) await store.set(KEY_REAL_LIBRARY_DIR, current);
        await store.save();
        setFixtureRoot(r.root);
        appendQuietLog(["[dev] test library on"]);
        await importFolderPath(r.root);
      } else {
        const saved = await store.get<string>(KEY_REAL_LIBRARY_DIR);
        const real = typeof saved === "string" && saved && !isTestLibrary(saved, fixtureRoot) ? saved : "";
        try {
          await invoke("dev_fixture_root", { enable: false });
        } catch { /* nothing to switch off on the host */ }
        await store.set(KEY_REAL_LIBRARY_DIR, "");
        await store.save();
        appendQuietLog(["[dev] test library off"]);
        if (real) await importFolderPath(real);
        else await closeLibrary("Test library off: choose your library folder again");
      }
    } catch (e) {
      setStatus(`Test library: ${String(e).slice(0, 120)}`);
    }
    setDevBusy("");
  }

  /** No library shown (the test library was switched off and no real one is known). */
  async function closeLibrary(message: string) {
    if (currentPathRef.current) stopPlayer();
    setFolder("");
    setAllTracks([]);
    setPlaylistFiles([]);
    setSelectedPaths(new Set());
    setPlaylist("(all)");
    setPlView("");
    setArtistView("");
    setLastChange(null);
    setStatus(message);
    try {
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, "");
      await store.save();
    } catch { /* non-fatal: the library is closed for this session */ }
  }

  async function runSelfTest() {
    if (devBusy) return;
    setDevBusy("selftest");
    setStatus("Running the self-test…");
    try {
      const r = await invoke<SelfTestReport>("self_test");
      const summary = `Self-test: ${r.passed} passed, ${r.failed} failed`;
      appendLog([...(r.lines ?? []), summary]);
      setStatus(summary);
    } catch (e) {
      appendLog([`[error] self-test: ${String(e)}`]);
      setStatus(`Self-test failed: ${String(e).slice(0, 120)}`);
    }
    setDevBusy("");
  }

  async function rebuildIndex() {
    const lib = folderRef.current;
    if (devBusy || !lib) return;
    setDevBusy("rebuild");
    setStatus("Rebuilding the index…");
    try {
      const r = await invoke<RefreshReport>("rebuild_index", { libraryDir: lib });
      const line = `Index rebuilt: ${r.total} tracks in ${(r.millis / 1000).toFixed(1)} s`;
      appendLog([`[index] ${line}`]);
      setStatus(line);
    } catch (e) {
      appendLog([`[error] rebuild index: ${String(e)}`]);
      setStatus(`Rebuild failed: ${String(e).slice(0, 120)}`);
    }
    setDevBusy("");
  }

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
    if (!name.trim()) return;
    const check = checkFolderName(name);
    if (!check.ok) {
      setStatus(folderNameRefusal(name, check.reason));
      return;
    }
    const clean = check.name;
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

  async function loadPlaylists(lib: string): Promise<PlaylistFile[] | null> {
    try {
      const pls = await invoke<PlaylistFile[]>("list_playlists", { libraryDir: lib });
      setPlaylistFiles(pls);
      return pls;
    } catch (err) {
      setStatus(`Playlists: ${String(err)}`);
      return null;
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
    await refreshLastChange(lib);
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
    await refreshLastChange(lib);
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
    await refreshLastChange(lib);
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
    await refreshLastChange(lib);
  }

  async function deletePlaylist(name: string) {
    const lib = folderRef.current;
    if (!lib || !name) return;
    try {
      await invoke("playlist_delete", { args: { libraryDir: lib, name } });
      setPlaylistFiles((prev) => prev.filter((p) => p.name !== name));
      if (plView === name) setPlView("");
      // Phone: the app's own bin inside the library; desktop: the system Recycle Bin. Both undoable.
      setStatus(`Playlist "${name}" moved to ${isMobile ? "the bin" : "the Recycle Bin"} (tracks untouched)`);
    } catch (err) {
      setStatus(`Delete failed: ${String(err)}`);
    } finally {
      setConfirmDeletePlaylist("");
    }
    await refreshLastChange(lib);
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
    await refreshLastChange(lib);
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
    await refreshLastChange(dir);
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
      await refreshLastChange(picked);
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
      setDlLogs("[error] Pick your Music folder first (Import). Downloads land in a playlist folder under it.\n");
      return false;
    }
    // The target may come from the synced queue file (written on another device): check it before
    // it becomes part of a path.
    const check = checkFolderName(target || DEFAULT_DOWNLOAD_TARGET);
    if (!check.ok) {
      const refusal = folderNameRefusal(target, check.reason);
      appendLog([`[error] ${refusal}`]);
      setStatus(refusal);
      return false;
    }
    const folderName = check.name;
    // A queued link may come from the synced queue file, written by another device or an older build.
    if (isChannelLink(url)) {
      refuseChannelLink();
      return false;
    }
    activeDlRef.current = { target: folderName, playlists, queued };
    dlOutputRef.current = "";
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
        noteDlOutput(res.log || "");
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
      // The host refused to start (a channel link, no Music folder, no yt-dlp): say why on the
      // status line too, not only in the log.
      setDlBusy(false);
      setDlLogs((prev) => prev + `\n[error] ${String(err)}\n`);
      setStatus(String(err).split("\n")[0].slice(0, 160));
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
        activeDlRef.current = { ...active, queued: null };
        if (exitCode === 0) {
          saveQueue(shareQueueRef.current.filter((q) => q.url !== active.queued!.url));
          setTimeout(() => nextQueuedRef.current(), 300);
        } else {
          // A refusal (bot wall, rate limit) would meet every remaining link too: stop the run here.
          // The failed link stays queued.
          queueRunRef.current = [];
          setStatus(queueStopStatus(dlOutputRef.current, exitCode));
        }
      }
    } catch (err) {
      setStatus(`Refresh error: ${String(err)}`);
    }
    await refreshLastChange(lib);
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
      if (e.line) noteDlOutput(e.line + "\n");
      if (e.line) setDlLogs((prev) => (prev.length > 20000 ? prev.slice(-12000) : prev) + e.line + "\n");
    }).then((l) => { if (active) un = () => l.unregister(); else l.unregister(); }).catch((e) => setStatus(`Progress events unavailable: ${String(e).slice(0, 100)}`));
    return () => { active = false; if (un) un(); };
  }, [isMobile]);
  useEffect(() => { if (!dlBusy) setDlProgress(-1); }, [dlBusy]);
  // Seconds since the download started, so a silent yt-dlp is distinguishable from a dead one.
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
    // The app/device details go on top, so a pasted log says which build and device it came from.
    let head: string[];
    try {
      head = diagnosticsLines(await invoke<Diagnostics>("diagnostics", { libraryDir: folderRef.current || null }));
    } catch (e) {
      head = [`diagnostics: unavailable (${String(e).slice(0, 120)})`];
    }
    // Then the visible log, then the change lines kept out of it (core:batch).
    const text = copyLogText(head, dlLogs, quietLogRef.current);
    // What to do by hand when the clipboard refuses: the phone selects with a long press.
    const copyFailed = isMobile
      ? "Copy failed: long-press the log to select it"
      : `Copy failed: select the log text and press ${platform === "macos" ? "Cmd" : "Ctrl"}+C`;
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
      setStatus(ok ? "Log copied" : copyFailed);
    } catch {
      setStatus(copyFailed);
    }
  }
  // ---------- Proton Drive (phone: rclone inside the app; PC: the Proton Drive app mirrors the folder) ----------
  type ProtonStatus = { bundled: boolean; connected: boolean; username: string };
  const [proton, setProton] = useState<ProtonStatus | null>(null);
  const [protonForm, setProtonForm] = useState<{ username: string; password: string; twofa: string }>({ username: "", password: "", twofa: "" });
  const [protonBusy, setProtonBusy] = useState<"" | "login" | "sync">("");
  const [lastSync, setLastSync] = useState<number>(0);
  async function refreshProton() {
    if (!isMobile) return;
    try { setProton(await invoke<ProtonStatus>("plugin:soundhood-ytdl|proton_status")); } catch { setProton({ bundled: false, connected: false, username: "" }); }
  }
  useEffect(() => { if (isMobile && mSettings) refreshProton(); }, [isMobile, mSettings]);
  useEffect(() => {
    if (!isMobile) return;
    let un: (() => void) | undefined;
    let active = true;
    addPluginListener<{ kind: string; line: string }>("soundhood-ytdl", "sync", (e) => {
      if (e.line) setDlLogs((prev) => (prev.length > 20000 ? prev.slice(-12000) : prev) + e.line + "\n");
    }).then((l) => { if (active) un = () => l.unregister(); else l.unregister(); }).catch(() => {});
    return () => { active = false; if (un) un(); };
  }, [isMobile]);
  async function protonLogin() {
    if (!protonForm.username.trim() || !protonForm.password) { setStatus("Proton: username and password needed"); return; }
    setProtonBusy("login");
    setStatus("Connecting to Proton Drive…");
    setDlLogs((prev) => prev + "[proton] connecting…\n");
    try {
      const r = await invoke<{ connected: boolean; username: string; folders: string }>("plugin:soundhood-ytdl|proton_login", {
        args: { username: protonForm.username.trim(), password: protonForm.password, twofa: protonForm.twofa.trim() },
      });
      setProtonForm({ username: "", password: "", twofa: "" });
      setStatus(r.connected ? `Connected to Proton Drive as ${r.username}` : "Proton: login finished but no session saved");
      setDlLogs((prev) => prev + `[proton] top-level folders:\n${r.folders}\n`);
    } catch (e) {
      setStatus("Proton login failed (see the log)");
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    refreshProton();
  }
  async function protonLogout() {
    try { await invoke("plugin:soundhood-ytdl|proton_logout"); } catch { /* ignore */ }
    setStatus("Disconnected from Proton Drive");
    refreshProton();
  }
  async function protonSync(direction: "down" | "up" | "both" = "both") {
    const lib = folderRef.current;
    if (!lib) { setStatus("Pick the Music folder first"); return; }
    // The test library must never meet the real Proton Drive folder (the buttons are off too).
    if (isTestLibrary(lib, fixtureRoot)) { setStatus(SYNC_OFF_LINE); return; }
    setProtonBusy("sync");
    setStatus("Syncing with Proton Drive…");
    try {
      const r = await invoke<{ ok: boolean; log: string }>("plugin:soundhood-ytdl|proton_sync", { args: { libraryDir: lib, remoteDir: "Music", direction } });
      const now = Date.now();
      setLastSync(now);
      try { const store = await storePromise; await store.set(KEY_LAST_SYNC, now); await store.save(); } catch { /* ignore */ }
      setStatus(r.ok ? "Proton sync done, refreshing…" : "Proton sync finished with errors");
      // Whatever arrived: new tracks, playlists, the download queue.
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      await loadPlaylists(lib);
      await loadQueueFromLibrary(lib);
      setStatus(`Synced · ${found.length} tracks`);
    } catch (e) {
      setStatus("Proton sync failed (see the log)");
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    await refreshLastChange(lib);
  }
  async function netcheck() {
    setYtdlpBusy(true);
    setStatus("Checking the network from python…");
    setDlLogs((prev) => prev + "[netcheck] running…\n");
    try {
      const r = await invoke<{ output: string }>("plugin:soundhood-ytdl|netcheck");
      setDlLogs((prev) => prev + r.output + "\n");
      setStatus("Network check done (see the log)");
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
    reloadAbortRef.current?.abort(); // a newer track wins over a pending reload

    const src = convertFileSrc(t.path);
    setCurrentPath(t.path);
    setCurrentName(displayName(t.name));
    setCurrentPlaylist(t.playlist || "(root)");

    // Phone: the webview never accepts the direct file URL (and can take seconds to say so),
    // so go straight to the bytes route.
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
    // play() is called right inside the tap/click (a "user gesture"): phones refuse playback
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

  // Write safety for the playing track: before its file is rewritten or moved, the player lets go
  // of it (no open handle, no range read of a half-replaced file), and afterwards it reloads the
  // file at the saved position, resuming if it was playing.
  const currentPathRef = useRef<string>("");
  currentPathRef.current = currentPath;
  type HeldPlayback = { pos: number; wasPlaying: boolean; viaBytes: boolean };
  // A pending reload's listeners, dropped when something else is loaded first.
  const reloadAbortRef = useRef<AbortController | null>(null);

  /** Stops and releases the player when `path` is the track it holds; null otherwise. */
  function releasePlayingTrack(path: string): HeldPlayback | null {
    const audio = audioRef.current;
    if (!audio || !path || path !== currentPathRef.current) return null;
    reloadAbortRef.current?.abort();
    // The phone always plays from the file's bytes; the desktop too once the file URL was refused.
    const held = { pos: audio.currentTime || 0, wasPlaying: !audio.paused, viaBytes: isMobile || audio.src.startsWith("blob:") };
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setIsPlaying(false);
    return held;
  }

  /** Loads `path` into the released player the same way it was playing, at the saved position. */
  async function reloadHeldTrack(held: HeldPlayback, path: string) {
    const audio = audioRef.current;
    if (!audio) return;
    const ac = new AbortController();
    reloadAbortRef.current = ac;
    try {
      let src: string;
      if (held.viaBytes) {
        const buf = await invoke<ArrayBuffer>("read_file_bytes", { path });
        if (ac.signal.aborted) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        src = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }));
        blobUrlRef.current = src;
      } else {
        src = convertFileSrc(path);
      }
      const resume = () => {
        ac.abort();
        audio.currentTime = held.pos;
        setProgress(held.pos);
        if (held.wasPlaying) audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      };
      audio.addEventListener("loadedmetadata", resume, { once: true, signal: ac.signal });
      audio.addEventListener("error", () => ac.abort(), { once: true, signal: ac.signal });
      audio.src = src;
      audio.load();
    } catch (e) {
      ac.abort();
      setIsPlaying(false);
      setStatus(`Can't reload the playing track: ${String(e).slice(0, 120)}`);
    }
  }

  /** Stops playback and forgets the current track (its file is gone). */
  function stopPlayer() {
    reloadAbortRef.current?.abort();
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

  // Move any track into another playlist folder. If it is the one playing, the player lets go of
  // the file during the move and picks it up at its new path at the same position.
  async function moveTrackTo(fromPath: string, target: string) {
    const lib = folderRef.current;
    if (!fromPath || !lib || !target) return;

    const held = releasePlayingTrack(fromPath);
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

      if (held) {
        setCurrentPath(moved.path);
        setCurrentPlaylist(moved.playlist);
        await reloadHeldTrack(held, moved.path);
      }
      await loadPlaylists(lib); // playlist files were updated on the Rust side
    } catch (err) {
      setStatus(`Move failed: ${String(err)}`);
      if (held) await reloadHeldTrack(held, fromPath);
    }
  }

  // Send tracks to the bin (after the confirmation box): the system Recycle Bin on the desktop,
  // the app's own bin inside the library on the phone; "Undo last change" brings them back.
  // Stops the player if its track was deleted.
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
    if (done.includes(currentPath)) stopPlayer();
    const gone = new Set(done);
    setSelectedPaths((prev) => new Set([...prev].filter((p) => !gone.has(p))));
    setAllTracks((prev) => prev.filter((x) => !gone.has(x.path)));
    const bin = isMobile ? "the bin" : "the Recycle Bin";
    setStatus(
      done.length === 1 && failed.length === 0
        ? `Moved "${displayName(tracks[0].name)}" to ${bin}`
        : `${isMobile ? "Bin" : "Recycle Bin"}: ${done.length} moved${failed.length ? `, ${failed.length} failed (${failed[0]})` : ""}`
    );
    await loadPlaylists(lib);
    setConfirmDelete(null);
    await refreshLastChange(lib);
  }

  // Move several files (Folders view). Each move keeps playlists consistent on the Rust side.
  async function moveTracksTo(tracks: Track[], target: string) {
    const check = checkFolderName(target);
    if (!check.ok) {
      setStatus(folderNameRefusal(target, check.reason));
      return;
    }
    for (const t of tracks) {
      if ((t.playlist || "(root)") !== check.name) await moveTrackTo(t.path, check.name);
    }
    await refreshLastChange();
  }

  // "Undo last change": reverses the newest batch this device made, then re-reads the library so
  // the lists, the playlists, the selection and the player follow whatever moved back.
  async function undoLast() {
    const lib = folderRef.current;
    const change = lastChange;
    if (!lib || !change || undoBusy) return;
    setUndoBusy(true);
    setStatus("Undoing…");
    try {
      const report = await invoke<BatchReport>("undo_last", { libraryDir: lib });
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      const pls = await loadPlaylists(lib);
      if (pls && plView && !pls.some((p) => p.name === plView)) setPlView("");
      await followUndo(report, found, lib);
      // What was left as it was, and why, goes to the visible log ("see the log"); applied lines
      // stay with the other change lines that only "Copy log" carries.
      appendLog(batchLogLines({ ...report, applied: [] }));
      setStatus(undoStatus(report, change.label));
    } catch (err) {
      setStatus(`Undo failed: ${String(err)}`);
    } finally {
      setUndoBusy(false);
    }
    await refreshLastChange(lib);
  }

  /** After an undo: remaps the selection and re-points or stops the player for files it moved back or removed. */
  async function followUndo(report: BatchReport, found: Track[], lib: string) {
    const byKey = new Map(found.map((t) => [libraryKey(lib, t.path), t] as const));
    // Library key of a file before the undo -> the track after it (null: the file is gone).
    const moved = new Map<string, Track | null>();
    for (const a of report.applied ?? []) {
      if (!a.path_before) continue;
      moved.set(libraryKey(lib, a.path_before), a.path_after ? byKey.get(libraryKey(lib, a.path_after)) ?? null : null);
    }
    setSelectedPaths((prev) => {
      const next = new Set<string>();
      for (const p of prev) {
        const k = libraryKey(lib, p);
        const to = moved.has(k) ? moved.get(k) : byKey.get(k);
        if (to) next.add(to.path);
      }
      return next;
    });
    const cur = currentPathRef.current;
    const k = cur ? libraryKey(lib, cur) : "";
    if (!k || !moved.has(k)) return;
    const to = moved.get(k);
    if (!to) {
      stopPlayer();
      return;
    }
    // Moved back, or its tags rewritten in place: reload the file at the same position.
    const held = releasePlayingTrack(cur);
    setCurrentPath(to.path);
    setCurrentPlaylist(to.playlist || "(root)");
    if (held) await reloadHeldTrack(held, to.path);
  }

  // Escape closes whichever box is open.
  useEffect(() => {
    if (!confirmDelete && !editTags && !confirmDeletePlaylist) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmDelete(null);
        setEditTags(null);
        setConfirmDeletePlaylist("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDelete, editTags, confirmDeletePlaylist]);

  function openTagEditor(t: Track) {
    setEditTags({ track: t, title: t.title, artist: t.artist });
  }

  async function saveTags() {
    const lib = folderRef.current;
    if (!editTags || !lib) return;
    const path = editTags.track.path;
    const held = releasePlayingTrack(path);
    try {
      const updated = await invoke<Track>("write_tags", {
        args: { path, libraryDir: lib, title: editTags.title, artist: editTags.artist },
      });
      setAllTracks((prev) => prev.map((t) => (t.path === updated.path ? updated : t)));
      setStatus(`Tags saved: ${displayName(updated.name)}`);
      setEditTags(null);
      if (held) await reloadHeldTrack(held, updated.path);
    } catch (err) {
      setStatus(`Tag write failed: ${String(err)}`);
      if (held) await reloadHeldTrack(held, path);
    }
    await refreshLastChange(lib);
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

        const savedSync = await store.get<number>(KEY_LAST_SYNC);
        if (typeof savedSync === "number") setLastSync(savedSync);
        const savedQueue = await store.get<QueuedLink[]>(KEY_SHARE_QUEUE);
        if (Array.isArray(savedQueue)) setShareQueue(savedQueue.filter((q) => q && typeof q.url === "string"));

        const savedVolume = await store.get<number>(KEY_VOLUME);
        if (typeof savedVolume === "number" && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
        settingsLoadedRef.current = true;

        if ((await store.get<boolean>(KEY_DEV_MODE)) === true) setDevMode(true);
        const savedFixtureRoot = await store.get<string>(KEY_FIXTURE_ROOT);
        if (typeof savedFixtureRoot === "string") setFixtureRoot(savedFixtureRoot);

        let saved = await store.get<string>(KEY_LIBRARY_DIR);
        // Android: no folder picker (it returns content URIs, not paths), so start from the standard Music folder.
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
        await refreshLastChange(saved);
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

  // The song length, whichever route loaded the file (direct URL on the PC, the file's bytes on
  // the phone, a reload after a write). Without it the seek bar's maximum stays 0: it sits at the
  // start and cannot be dragged. A new file starting to load resets the bar (on the phone the old
  // song plays on while the new one's bytes arrive); an emptied player (NaN) or a stream of
  // unknown length (Infinity) keeps the last known length; stopPlayer clears it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadStart = () => {
      setProgress(0);
      setDuration(0);
    };
    const onLength = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("loadedmetadata", onLength);
    audio.addEventListener("durationchange", onLength);
    return () => {
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("loadedmetadata", onLength);
      audio.removeEventListener("durationchange", onLength);
    };
  }, []);

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
      // The log keeps its tail (capLog), like the phone's, so a long download cannot grow it forever.
      const uOut = await listen<string>("ytdlp:stdout", (e) => {
        // add newline if missing, to keep logs readable
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        noteDlOutput(chunk);
        setDlLogs((prev) => capLog(prev) + chunk);
      });

      const uErr = await listen<string>("ytdlp:stderr", (e) => {
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        noteDlOutput(chunk);
        setDlLogs((prev) => capLog(prev) + chunk);
      });

      const uFile = await listen<string[]>("ytdlp:files", (e) => {
        lastDownloadRef.current = Array.isArray(e.payload) ? e.payload : [];
      });

      const uDone = await listen<number>("ytdlp:done", async (e) => {
        setDlLogs((prev) => capLog(prev) + `\n[done] exit code: ${e.payload}\n`);
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

  // Every batch the core applies (tag edit, move, delete, playlist change, undo) is reported by
  // the host as a `core:batch` event: one line per entry, kept for "Copy log" only, so an edit looks
  // exactly as it did before the rebuild (no log panel). Same StrictMode-safe pattern.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<BatchReport>("core:batch", (e) => {
      if (e.payload) appendQuietLog(batchLogLines(e.payload));
    })
      .then((u) => {
        if (active) unlisten = u;
        else u();
      })
      .catch(() => { /* a host without the event: nothing to log */ });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Developer section (hidden): Ctrl+Alt+Shift+D on the desktop.
  const toggleDevModeRef = useRef(toggleDevMode);
  toggleDevModeRef.current = toggleDevMode;
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        toggleDevModeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMobile]);

  // The developer controls: rows at the bottom of the phone's settings sheet, a row under the
  // desktop top bar. Plain buttons; the switch is a toggle button that says its state in words.
  const devControls = (
    <>
      <span className="modalHint" style={{ marginTop: 0 }}>Developer</span>
      <button
        className={`btn ${fixtureOn ? "primaryBtn" : ""}`}
        role="switch"
        aria-checked={fixtureOn}
        onClick={() => switchFixtureRoot(!fixtureOn)}
        disabled={devBusy !== "" || dlBusy || protonBusy !== "" || undoBusy}
        title="Point the app at the generated test library (screenshots, tests); off goes back to your library"
      >
        {devBusy === "fixture" ? "Switching…" : `Test library: ${fixtureOn ? "on" : "off"}`}
      </button>
      <button className="btn" onClick={runSelfTest} disabled={devBusy !== ""} title="Run the bundled checks through this build; the result goes to the log">
        {devBusy === "selftest" ? "Testing…" : "Run self-test"}
      </button>
      <button className="btn" onClick={rebuildIndex} disabled={devBusy !== "" || !folder} title="Rebuild the library index from the files alone; the time goes to the log">
        {devBusy === "rebuild" ? "Rebuilding…" : "Rebuild index"}
      </button>
    </>
  );

  return (
    <div className={`app ${isMobile ? "mobile" : ""}`} style={{ "--mBottomH": `${mBottomH}px` } as CSSProperties}>
      <audio ref={audioRef} preload="metadata" />
      <style>{LEGACY_STYLES}</style>

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
          {folder && !isMobile ? (
            <button
              className="btn"
              onClick={undoLast}
              disabled={!lastChange || undoBusy}
              title={lastChange ? `Undo: ${lastChange.label}` : "Nothing to undo"}
            >
              {undoBusy ? "Undoing…" : "Undo"}
            </button>
          ) : null}
          {fixtureOn ? (
            <span
              className="modalHint testLibraryNote"
              title="The app shows the generated test library, not your music. Switch it off under Developer."
            >
              Test library
            </span>
          ) : null}
        </div>
        <div className="status" onClick={onStatusTap}>{isMobile ? status : `Status: ${status}`}</div>
      </div>

      {devMode && !isMobile ? <div className="devBar">{devControls}</div> : null}

      {isMobile && mSettings ? (
        <div className="mSettings">
          <div className="mFolder">{folder ? `Library: ${shownFolder(folder, fixtureRoot)}` : "Type the folder that holds your music, then tap Use."}</div>
          <input
            className="downloadInput"
            placeholder="/storage/emulated/0/Music"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") importFolderPath(pathInput); }}
          />
          <button className="btn" onClick={() => importFolderPath(pathInput)} disabled={!pathInput.trim()}>Use</button>
          {folder ? <button className="btn" onClick={rescanLibrary} title="Re-read the Music folder">Rescan</button> : null}
          {folder ? (
            <div className="queueAdd">
              <button
                className="btn"
                onClick={undoLast}
                disabled={!lastChange || undoBusy || dlBusy || protonBusy !== ""}
                title="Reverse the last tag edit, move, delete or playlist change"
              >
                {undoBusy ? "Undoing…" : "Undo last change"}
              </button>
              <span className="modalHint" style={{ marginTop: 0 }}>
                {lastChange ? lastChange.label : "Nothing to undo"}
              </span>
            </div>
          ) : null}
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
          <div className="queueBox">
            <div className="queueTitle headerRow">
              <span>Proton Drive</span>
              {proton?.connected ? <span className="modalHint" style={{ marginTop: 0 }}>{proton.username}</span> : null}
            </div>
            {!proton ? (
              <div className="modalHint">checking…</div>
            ) : !proton.bundled ? (
              <div className="modalHint">This build has no sync engine (rclone not bundled).</div>
            ) : proton.connected ? (
              <div className="queueAdd" style={{ marginTop: 0 }}>
                <button className="btn primaryBtn" onClick={() => protonSync("both")} disabled={protonBusy !== "" || dlBusy || fixtureOn}>{protonBusy === "sync" ? "Syncing…" : "Sync now"}</button>
                <button className="btn" onClick={() => protonSync("down")} disabled={protonBusy !== "" || dlBusy || fixtureOn} title="Only fetch what the PC added">Get new</button>
                <button className="btn" onClick={() => protonSync("up")} disabled={protonBusy !== "" || dlBusy || fixtureOn} title="Only send what the phone added">Send new</button>
                <span className="modalHint" style={{ marginTop: 0 }}>{lastSync ? `last: ${new Date(lastSync).toLocaleString()}` : "never synced"}</span>
                <button className="linkBtn" onClick={protonLogout} disabled={protonBusy !== ""}>disconnect</button>
                {fixtureOn ? <div className="modalHint syncOffLine" style={{ flex: "1 1 100%", marginTop: 0 }}>{SYNC_OFF_LINE}</div> : null}
              </div>
            ) : (
              <div className="queueAdd" style={{ marginTop: 0 }}>
                <input className="downloadInput" placeholder="Proton email" inputMode="email" autoCapitalize="none" value={protonForm.username} onChange={(e) => setProtonForm({ ...protonForm, username: e.target.value })} />
                <input className="downloadInput" placeholder="Password" type="password" value={protonForm.password} onChange={(e) => setProtonForm({ ...protonForm, password: e.target.value })} />
                <input className="downloadInput" placeholder="2FA code (if enabled)" inputMode="numeric" value={protonForm.twofa} onChange={(e) => setProtonForm({ ...protonForm, twofa: e.target.value })} style={{ flex: "0 1 170px" }} />
                <button className="btn primaryBtn" onClick={protonLogin} disabled={protonBusy !== ""}>{protonBusy === "login" ? "Connecting…" : "Connect"}</button>
                <div className="modalHint" style={{ flex: "1 1 100%", marginTop: 0 }}>
                  The password is used once to open the session and is not stored; the app keeps only Proton's session tokens, on this phone.
                  Sync copies in both directions and never deletes.
                </div>
              </div>
            )}
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
            {dlLogs ? <button className="btn" onClick={clearLog}>Clear log</button> : null}
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
          {devMode ? <div className="queueAdd">{devControls}</div> : null}
        </div>
      ) : null}

      <div className="pathLine">
        {folder ? `Folder: ${shownFolder(folder, fixtureRoot)}` : "Pick a folder to begin."}
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
        {dlLogs ? (
          <button className="btn" onClick={copyLog} title="Copy the whole log to the clipboard, with the app and device details on top">
            Copy log
          </button>
        ) : null}
        <button className="btn" onClick={clearLog} disabled={!dlLogs}>
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
                      Create one per existing folder to start from what you have. Nothing moves on disk.
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
                title={`${selectedTracks.length > 1 ? `Delete ${selectedTracks.length} tracks` : `Delete "${displayName(selectedTracks[0].name)}"`} (to ${isMobile ? "the bin" : "the Recycle Bin"}; Undo brings ${selectedTracks.length > 1 ? "them" : "it"} back)`}
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
            ) : null}
            <button
              className={`shuffleBtn ${shuffle ? "on" : ""}`}
              onClick={() => setShuffle((s) => !s)}
              title={shuffle ? "Shuffle is on; click to play in order" : "Shuffle is off; click to shuffle"}
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
            title={shuffle ? "Shuffle is on; click to play in order" : "Shuffle is off; click to shuffle"}
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

      {confirmDeletePlaylist ? (
        <div className="modalBackdrop" onMouseDown={() => setConfirmDeletePlaylist("")}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete this playlist?</div>
            <div className="modalBody">
              <div className="modalTrack">{confirmDeletePlaylist}</div>
              <div className="modalHint">
                {isMobile
                  ? "Only the playlist file goes to the app's bin; Undo last change in settings brings it back. The songs stay exactly where they are."
                  : "Only the playlist file goes to the Recycle Bin; Undo in the top bar brings it back. The songs stay exactly where they are."}
              </div>
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
                  ? "The files go to the app's bin; Undo last change in settings brings them back. Playlists are updated."
                  : "The files go to the Recycle Bin; Undo in the top bar brings them back. Playlists are updated."}
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
