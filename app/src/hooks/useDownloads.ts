// Getting music in: the desktop download box, links shared or pasted into the app and the
// "Where should this go?" draft, the queue of links waiting (stored and written into the library),
// running a download on either engine (yt-dlp on the PC, the in-app plugin on the phone) and
// filing what it produced into the chosen playlists.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { capLog } from "../coreIpc";
import { CHANNEL_REFUSAL, isChannelLink, queueStopStatus } from "../downloads";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { firstUrl, isPlaylistLink } from "../lib/links";
import { DEFAULT_DOWNLOAD_TARGET, KEY_DOWNLOAD_PLAYLISTS, KEY_DOWNLOAD_TARGET, KEY_SHARE_QUEUE, storePromise } from "../lib/store";
import type { PhoneDownloadResult, PlaylistFile, QueueDraft, QueuedLink, Setter, Track } from "../lib/types";

export type Downloads = ReturnType<typeof useDownloads>;

type DownloadsArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  folder: string;
  folderRef: MutableRefObject<string>;
  allTracks: Track[];
  setAllTracks: Setter<Track[]>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  refreshLastChange: (lib?: string) => Promise<void>;
  setDlLogs: Setter<string>;
  appendLog: (lines: string[]) => void;
  setMSettings: Setter<boolean>;
};

export function useDownloads({
  isMobile,
  setStatus,
  folder,
  folderRef,
  allTracks,
  setAllTracks,
  loadPlaylists,
  refreshLastChange,
  setDlLogs,
  appendLog,
  setMSettings,
}: DownloadsArgs) {
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
  const [queueDraft, setQueueDraft] = useState<QueueDraft | null>(null);
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
  /** The phone's "Add" (button or Enter): queue the typed link and empty the box. */
  function addQueueInput() {
    if (queueLink(queueInput)) setQueueInput("");
  }
  /** "copy" on a waiting link. */
  function copyQueuedLink(url: string) {
    try { navigator.clipboard.writeText(url); setStatus("Link copied"); } catch { /* no clipboard */ }
  }
  /** The bin button on a waiting link. */
  function removeQueuedLink(url: string) {
    saveQueue(shareQueue.filter((x) => x.url !== url));
  }

  // Manual download box
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [dlBusy, setDlBusy] = useState<boolean>(false);

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

  // The links queue follows the library: re-read whenever the folder changes, and every minute on
  // the desktop (the phone may have added links to the synced file). folderRef itself is set by
  // useLibrary's effect for the same change.
  useEffect(() => {
    if (folder) loadQueueFromLibrary(folder);
    if (!folder || isMobile) return;
    const t = setInterval(() => loadQueueFromLibrary(folder), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return {
    shareQueue,
    setShareQueue,
    sharedLink,
    queueInput,
    setQueueInput,
    queueDraft,
    setQueueDraft,
    downloadUrl,
    setDownloadUrl,
    dlBusy,
    dlTarget,
    setDlTarget,
    newFolderName,
    setNewFolderName,
    newFolderMode,
    setNewFolderMode,
    dlPlaylists,
    setDlPlaylists,
    targetOptions,
    dlProgress,
    dlSeconds,
    lastDownloadRef,
    finishDownloadRef,
    noteDlOutput,
    loadQueueFromLibrary,
    queueLink,
    confirmQueueDraft,
    pasteLink,
    addQueueInput,
    copyQueuedLink,
    removeQueuedLink,
    chooseDlPlaylists,
    chooseTarget,
    startManualDownload,
    runQueue,
    cancelPhoneDownload,
  };
}

type YtdlpEventsArgs = {
  noteDlOutput: (text: string) => void;
  setDlLogs: Setter<string>;
  lastDownloadRef: MutableRefObject<string[]>;
  finishDownloadRef: MutableRefObject<(exitCode: number, filePaths: string[]) => Promise<void>>;
};

// yt-dlp listeners (robust against React StrictMode + HMR). Its own hook so the shell can register
// it after the startup load, where this effect always ran.
export function useYtdlpEvents({ noteDlOutput, setDlLogs, lastDownloadRef, finishDownloadRef }: YtdlpEventsArgs) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
