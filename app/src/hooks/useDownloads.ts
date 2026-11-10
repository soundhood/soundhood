// Getting music in: links shared, pasted or typed into the app and the "Where should this go?"
// draft, the queue of links waiting (stored and written into the library), running a download on
// either engine (yt-dlp on the PC, the in-app plugin on the phone) and filing what it produced into
// the chosen playlists. What happens is said by toasts (the running download's own toast is
// DownloadToast, which reads dlBusy, dlProgress, dlSeconds and run) and the log; a download that ran
// and failed also leaves `failure`, which Settings and the sheet show as an error row with Retry.
//
// The downloader switch (Settings, YouTube) decides on every path: startDownload, which every
// download goes through (the sheet's Download, a queued link, the queue runner, Retry), refuses while
// it is off or before startup has read the stored switch (a settings store that cannot be read counts
// as off); switching it off ends a running queue after the download in flight and drops the Retry of
// a failed one; and a link shared before startup has read the stored switch, or while the first-launch
// setup is up, waits until both are over (useSharedLinks).
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { MutableRefObject } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { CHANNEL_REFUSAL, isChannelLink, lastErrorLine, queueEndStatus, queueStopStatus } from "../downloads";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { firstUrl, isPlaylistLink } from "../lib/links";
import { DEFAULT_DOWNLOAD_TARGET, KEY_DOWNLOAD_PLAYLISTS, KEY_DOWNLOAD_TARGET, KEY_SHARE_QUEUE, storePromise } from "../lib/store";
import type { PhoneDownloadResult, PlaylistFile, QueueDraft, QueuedLink, Setter, Track } from "../lib/types";
import { journaled } from "../lib/journal";
import type { Notices } from "./useNotices";
import { useSharedLinks } from "./useSharedLinks";
import { songCount } from "../features/library/trackInfo";

// The yt-dlp listeners live in their own file; the shell imports them from here, as before.
export { useYtdlpEvents } from "./useYtdlpEvents";

export type Downloads = ReturnType<typeof useDownloads>;

/** A download that ran and failed: what the error row says, and how to try again. */
export type DownloadFailure = { title: string; detail: string; retry: () => void };

/** The newest "[download]  45.3%" figure in a chunk of yt-dlp output, or -1. */
export function progressIn(text: string): number {
  let found = -1;
  for (const m of text.matchAll(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/g)) found = Number(m[1]);
  return found >= 0 && found <= 100 ? found : -1;
}

type DownloadsArgs = {
  isMobile: boolean;
  notices: Notices;
  /** Settings, YouTube: the download UI shows (and links are taken) only while this is on. */
  downloader: boolean;
  /** Startup has read the stored settings (until then `downloader` is only a default). */
  prefsLoaded: boolean;
  /** The first-launch setup is up: a shared link waits for it to close. */
  setupOpen: boolean;
  openSettings: () => void;
  folder: string;
  folderRef: MutableRefObject<string>;
  allTracks: Track[];
  setAllTracks: Setter<Track[]>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  refreshLastChange: (lib?: string) => Promise<void>;
  setDlLogs: Setter<string>;
  appendLog: (lines: string[]) => void;
};

export function useDownloads({
  isMobile,
  notices,
  downloader,
  prefsLoaded,
  setupOpen,
  openSettings,
  folder,
  folderRef,
  allTracks,
  setAllTracks,
  loadPlaylists,
  refreshLastChange,
  setDlLogs,
  appendLog,
}: DownloadsArgs) {
  const notify = notices.notify;
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

  // A link arrives (share sheet, paste, the Download item): ask where it should land ("Where should
  // this go?"), then queue it or download it with that choice. `draftError` is the sheet's own
  // error row (a refused link or folder name); the sheet stays open so it can be fixed.
  const [queueDraft, setQueueDraft] = useState<QueueDraft | null>(null);
  const [draftError, setDraftError] = useState<string>("");

  // The switch as it is now, for code that runs later than the render that saw it (a queue run's
  // next link, a Retry pressed after the switch went off).
  const downloaderRef = useRef(downloader);
  downloaderRef.current = downloader;
  // Startup has read the stored switch: until then `downloader` is only a default.
  const prefsLoadedRef = useRef(prefsLoaded);
  prefsLoadedRef.current = prefsLoaded;
  /**
   * False while the downloader is off, with a toast saying where to turn it on, and false before
   * startup has read the stored switch (nothing opens or starts on a default nobody chose).
   */
  function downloaderReady(): boolean {
    if (!prefsLoadedRef.current) {
      notify({ text: "The settings are still loading. Try again in a moment." });
      return false;
    }
    if (downloaderRef.current) return true;
    notify({ text: "The downloader is off. Turn it on in Settings, under YouTube.", action: { label: "Settings", onClick: openSettings } });
    return false;
  }
  function queueLink(text: string): boolean {
    if (!downloaderReady()) return false;
    const url = firstUrl(String(text || ""));
    if (!url) { notify({ text: "No link found in that text" }); return false; }
    if (isChannelLink(url)) { refuseChannelLink(); return false; }
    setDraftError("");
    setQueueDraft({ url, target: dlTarget || DEFAULT_DOWNLOAD_TARGET, playlists: dlPlaylistsRef.current });
    return true;
  }
  /** The sheet with an empty link field (the PC's Download item). */
  function openDraft() {
    if (!downloaderReady()) return;
    setDraftError("");
    setQueueDraft({ url: "", target: dlTarget || DEFAULT_DOWNLOAD_TARGET, playlists: dlPlaylistsRef.current });
  }
  function closeDraft() {
    setQueueDraft(null);
    setDraftError("");
  }
  /**
   * "Queue" or "Download" in the sheet. The link may have been typed or changed there, so it is
   * checked again. On the PC, Download works as the old download box did: the folder and playlists
   * chosen are remembered for the next link, and the link is not queued. On the phone, as before,
   * the link is queued first and leaves the queue once it downloaded.
   */
  function confirmQueueDraft(downloadNow: boolean, target?: string) {
    const d = queueDraft;
    if (!d) return;
    if (!downloaderReady()) {
      closeDraft();
      return;
    }
    const url = firstUrl(d.url);
    if (!url) { setDraftError("No link found in that text"); return; }
    if (isChannelLink(url)) { refuseChannelLink(); setDraftError(CHANNEL_REFUSAL); return; }
    const raw = target ?? d.target;
    const check = checkFolderName(raw || DEFAULT_DOWNLOAD_TARGET);
    if (!check.ok) {
      setDraftError(folderNameRefusal(raw, check.reason));
      return;
    }
    if (downloadNow && !isMobile && !dlBusy) {
      closeDraft();
      void chooseTarget(check.name);
      void chooseDlPlaylists(d.playlists);
      queueRunRef.current = [];
      setRun(null);
      void startDownload(url, check.name, d.playlists, null);
      return;
    }
    const item: QueuedLink = { url, added: Date.now(), target: check.name, playlists: d.playlists };
    const cur = shareQueueRef.current.filter((q) => q.url !== url);
    saveQueue([item, ...cur]);
    setSharedLink(url);
    closeDraft();
    if (downloadNow && !dlBusy) {
      queueRunRef.current = [];
      setRun(null);
      startDownload(item.url, item.target || DEFAULT_DOWNLOAD_TARGET, item.playlists || [], item);
    } else {
      notify({ text: dlBusy ? "Link queued: a download is running" : "Link queued" });
    }
  }
  /** "Enter" in the sheet's New folder field: checks the name (the error row says why not); no download. */
  function checkDraftFolder(name: string): boolean {
    const check = checkFolderName(name || DEFAULT_DOWNLOAD_TARGET);
    setDraftError(check.ok ? "" : folderNameRefusal(name, check.reason));
    return check.ok;
  }
  // A link shared into the phone: at once, or once startup has read the stored switch and the
  // first-launch setup has closed; then it goes the way the stored switch says (off, or a store that
  // could not be read: the toast saying where to turn it on).
  useSharedLinks({ prefsLoaded, setupOpen, take: queueLink });
  async function pasteLink() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        queueLink(t);
        return;
      }
    } catch { /* clipboard not readable here */ }
    notify({ text: "Could not read the clipboard: paste the link into the field" });
  }
  /** "Add" (button or Enter) beside the link field in Settings: the sheet for the typed link. */
  function addQueueInput() {
    if (queueLink(queueInput)) setQueueInput("");
  }
  /** "Copy" on a waiting link: says it copied only when the clipboard took it. */
  async function copyQueuedLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify({ text: "Link copied" });
    } catch {
      notify({ text: isMobile ? "Copy failed: long-press the link to select it" : "Copy failed: select the link and copy it by hand" });
    }
  }
  /** Remove on a waiting link. */
  function removeQueuedLink(url: string) {
    saveQueue(shareQueue.filter((x) => x.url !== url));
  }

  const [dlBusy, setDlBusy] = useState<boolean>(false);
  // A download ended: its toast goes at once (DownloadToast, on dlBusy), before any toast saying how
  // it ended, so that toast never pushes a newer notice out of the stack past the leaving one.
  const endBusy = () => flushSync(() => setDlBusy(false));
  const [failure, setFailure] = useState<DownloadFailure | null>(null);
  // While "Download queue" runs: which link of how many (the download toast says "2 of 5").
  const [run, setRun] = useState<{ at: number; of: number } | null>(null);
  const runTotalRef = useRef(0);
  // A queued link's Retry after its run stopped: when it has downloaded, the toast says how many
  // links still wait (the run is over; nothing else starts by itself).
  const retriedQueuedRef = useRef(false);

  // Where downloads land: a first-level folder under the Music root (= a playlist).
  const [dlTarget, setDlTarget] = useState<string>(DEFAULT_DOWNLOAD_TARGET);
  // Playlists a finished download is added to (remembered between downloads).
  const [dlPlaylists, setDlPlaylists] = useState<string[]>([]);
  const dlPlaylistsRef = useRef<string[]>([]);
  useEffect(() => {
    dlPlaylistsRef.current = dlPlaylists;
  }, [dlPlaylists]);
  const lastDownloadRef = useRef<string[]>([]);
  // Destination of the download in flight: the sheet's choices, or a queued link's own.
  const activeDlRef = useRef<{ url: string; target: string; playlists: string[]; queued: QueuedLink | null }>({
    url: "",
    target: DEFAULT_DOWNLOAD_TARGET,
    playlists: [],
    queued: null,
  });
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

  // Output of the download in flight (its tail), for the reason a queued download stopped, and the
  // progress the PC's yt-dlp prints ("[download]  45.3%"; the phone's plugin sends its own figure).
  const dlOutputRef = useRef<string>("");
  function noteDlOutput(text: string) {
    if (!text) return;
    dlOutputRef.current = (dlOutputRef.current + text).slice(-4000);
    if (!isMobile) {
      const p = progressIn(text);
      if (p >= 0) setDlProgress(p);
    }
  }

  /** A channel link is refused where it enters (paste, share, queue, download), in one plain line. */
  function refuseChannelLink() {
    appendLog([`[error] ${CHANNEL_REFUSAL}`]);
    notify({ text: CHANNEL_REFUSAL });
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
      notify({ text: folderNameRefusal(name, check.reason) });
      return;
    }
    const clean = check.name;
    setDlTarget(clean);
    try {
      const store = await storePromise;
      await store.set(KEY_DOWNLOAD_TARGET, clean);
      await store.save();
    } catch {
      /* non-fatal: the choice still applies for this session */
    }
  }

  /** The error row and a toast with Retry, for a download that ran and failed. */
  function failed(title: string, text: string, detail: string, retryWith: { url: string; target: string; playlists: string[]; queued: QueuedLink | null }) {
    const retry = () => {
      setFailure(null);
      queueRunRef.current = [];
      runTotalRef.current = 0;
      retriedQueuedRef.current = !!retryWith.queued;
      setRun(null);
      void startDownload(retryWith.url, retryWith.target, retryWith.playlists, retryWith.queued);
    };
    setFailure({ title, detail, retry });
    notify({ text, action: { label: "Retry", onClick: retry } });
  }

  async function startDownload(url: string, target: string, playlists: string[], queued: QueuedLink | null): Promise<boolean> {
    // The one check every download passes: nothing reaches the helper while the switch is off.
    if (!downloaderReady()) return false;
    // Never download "somewhere": without a Music root there is no playlist to land in.
    const lib = folderRef.current || "";
    if (!lib) {
      setDlLogs("[error] Choose your Music folder first (Settings, Library). Downloads land in a playlist folder under it.\n");
      notify({ text: "Choose your Music folder first (Settings, Library)" });
      return false;
    }
    // The target may come from the synced queue file (written on another device): check it before
    // it becomes part of a path.
    const check = checkFolderName(target || DEFAULT_DOWNLOAD_TARGET);
    if (!check.ok) {
      const refusal = folderNameRefusal(target, check.reason);
      appendLog([`[error] ${refusal}`]);
      notify({ text: refusal });
      return false;
    }
    const folderName = check.name;
    // A queued link may come from the synced queue file, written by another device or an older build.
    if (isChannelLink(url)) {
      refuseChannelLink();
      return false;
    }
    activeDlRef.current = { url, target: folderName, playlists, queued };
    dlOutputRef.current = "";
    setFailure(null);
    setDlBusy(true);
    setDlLogs(queued ? `[soundhood] queued link → ${folderName}${playlists.length ? " + " + playlists.join(", ") : ""}\n` : "");
    const playlist = isPlaylistLink(url);
    if (isMobile) {
      // Phone: yt-dlp lives inside the app (soundhood-ytdl plugin); the result comes back directly.
      const sep = lib.includes("\\") ? "\\" : "/";
      const outDir = `${lib.replace(/[\\/]+$/, "")}${sep}${folderName}`;
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
        endBusy();
        setDlLogs((prev) => prev + `\n[error] ${String(err)}\n`);
        const reason = String(err).split("\n")[0].slice(0, 120);
        if (queued) { activeDlRef.current = { ...activeDlRef.current, queued: null }; queueRunRef.current = []; runTotalRef.current = 0; setRun(null); }
        failed("Download failed", `Download failed: ${reason}`, reason, { url, target: folderName, playlists, queued });
        return false;
      }
    }
    try {
      await invoke("ytdlp_download_audio", {
        args: { url, libraryDir: lib, targetFolder: folderName, playlist },
      });
      return true;
    } catch (err) {
      // The host refused to start (a channel link, no Music folder, no yt-dlp): say why in a toast
      // too, not only in the log.
      endBusy();
      setRun(null);
      setDlLogs((prev) => prev + `\n[error] ${String(err)}\n`);
      notify({ text: String(err).split("\n")[0].slice(0, 160) });
      return false;
    }
  }

  // After a download ended (either engine): rescan, file the new tracks into the chosen playlists,
  // drop a finished queued link, start the next queued one.
  async function finishDownload(exitCode: number, filePaths: string[]) {
    endBusy();
    const lib = folderRef.current;
    if (!lib) return;
    const active = activeDlRef.current;
    try {
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      appendLog([`Found ${songCount(found.length)}`]);
      await loadPlaylists(lib);
      const targets = active.playlists;
      if (exitCode === 0 && filePaths.length && targets.length) {
        const paths = filePaths.filter((fp) => found.some((x) => x.path === fp));
        if (paths.length) {
          // Through the journal, like every playlist write: never between a write and its report.
          for (const name of targets) {
            await journaled<PlaylistFile>("playlist_add", { args: { libraryDir: lib, name, paths } });
          }
          await loadPlaylists(lib);
          setDlLogs((prev) => prev + `[soundhood] ${paths.length} file${paths.length === 1 ? "" : "s"} added to: ${targets.join(", ")}\n`);
          notify({ text: `Downloaded ${paths.length} and added to ${targets.length} playlist${targets.length === 1 ? "" : "s"}` });
        }
      } else if (exitCode === 0) {
        notify({ text: `Downloaded ${filePaths.length} file${filePaths.length === 1 ? "" : "s"}` });
      }
      const retryWith = { url: active.url, target: active.target, playlists: active.playlists, queued: active.queued };
      if (active.queued) {
        activeDlRef.current = { ...active, queued: null };
        if (exitCode === 0) {
          saveQueue(shareQueueRef.current.filter((q) => q.url !== active.queued!.url));
          setTimeout(() => nextQueuedRef.current(), 300);
        } else {
          // A refusal (bot wall, rate limit) would meet every remaining link too: stop the run here.
          // The failed link stays queued; the run is over, its Retry downloads that link alone.
          queueRunRef.current = [];
          runTotalRef.current = 0;
          setRun(null);
          const stop = queueStopStatus(dlOutputRef.current, exitCode);
          failed("Queue stopped", stop, stop.replace(/^Queue stopped: /, ""), retryWith);
        }
      } else if (exitCode !== 0) {
        const reason = lastErrorLine(dlOutputRef.current) || `the download did not finish (code ${exitCode})`;
        failed("Download failed", `Download failed: ${reason}`, reason, retryWith);
      }
    } catch (err) {
      notify({ text: `Refresh error: ${String(err)}` });
    }
    await refreshLastChange(lib);
  }

  // Work through the queued links one after another (each with its own destination).
  function runQueue() {
    if (dlBusy || !shareQueue.length) return;
    if (!downloaderReady()) return;
    queueRunRef.current = [...shareQueue];
    runTotalRef.current = shareQueue.length;
    nextQueued();
  }
  function nextQueued() {
    // Switched off while the last one ran: the run ends here, quietly (the switch said so already).
    if (!downloaderRef.current) {
      queueRunRef.current = [];
      runTotalRef.current = 0;
      setRun(null);
      return;
    }
    const item = queueRunRef.current.shift();
    if (!item) {
      // The links left in the queue file are still waiting: after a Retry, the rest of a stopped run.
      const ran = !!run || runTotalRef.current > 0;
      const text = queueEndStatus(ran, ran || retriedQueuedRef.current ? shareQueueRef.current.length : 0);
      if (text) notify({ text });
      retriedQueuedRef.current = false;
      runTotalRef.current = 0;
      setRun(null);
      return;
    }
    setRun({ at: runTotalRef.current - queueRunRef.current.length, of: runTotalRef.current });
    startDownload(item.url, item.target || DEFAULT_DOWNLOAD_TARGET, item.playlists || [], item).then((ok) => {
      if (!ok) { queueRunRef.current = []; runTotalRef.current = 0; setRun(null); }
    });
  }
  const nextQueuedRef = useRef(nextQueued);
  nextQueuedRef.current = nextQueued;
  // Switched off: a queue run stops after the download in flight, and a failed one's Retry goes.
  useEffect(() => {
    if (downloader) return;
    const running = queueRunRef.current.length > 0 || runTotalRef.current > 0;
    queueRunRef.current = [];
    runTotalRef.current = 0;
    setRun(null);
    setFailure(null);
    if (running) notify({ text: "Downloader off: the queue stops after this download" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloader]);
  const finishDownloadRef = useRef(finishDownload);
  finishDownloadRef.current = finishDownload;

  // Progress: the phone's plugin sends its own figure; on the PC noteDlOutput reads yt-dlp's lines.
  const [dlProgress, setDlProgress] = useState<number>(-1);
  useEffect(() => {
    if (!isMobile) return;
    let un: (() => void) | undefined;
    let active = true;
    addPluginListener<{ id: string; progress: number; eta?: number; line: string }>("soundhood-ytdl", "progress", (e) => {
      if (typeof e.progress === "number" && e.progress >= 0) setDlProgress(e.progress);
      if (e.line) noteDlOutput(e.line + "\n");
      if (e.line) setDlLogs((prev) => (prev.length > 20000 ? prev.slice(-12000) : prev) + e.line + "\n");
    }).then((l) => { if (active) un = () => l.unregister(); else l.unregister(); }).catch((e) => appendLog([`Progress events unavailable: ${String(e).slice(0, 100)}`]));
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
  /** The phone's download can be stopped (the PC host has no cancel yet). */
  const canCancel = isMobile;
  async function cancelPhoneDownload() {
    const id = dlIdRef.current;
    if (!id) return;
    try {
      await invoke("plugin:soundhood-ytdl|cancel", { args: { id } });
      notify({ text: "Cancelling the download" });
    } catch (e) {
      notify({ text: `Cancel failed: ${String(e).slice(0, 100)}` });
    }
  }

  return {
    shareQueue,
    setShareQueue,
    sharedLink,
    queueInput,
    setQueueInput,
    queueDraft,
    setQueueDraft,
    draftError,
    openDraft,
    closeDraft,
    dlBusy,
    failure,
    dismissFailure: () => setFailure(null),
    run,
    dlTarget,
    setDlTarget,
    dlPlaylists,
    setDlPlaylists,
    targetOptions,
    dlProgress,
    dlSeconds,
    canCancel,
    lastDownloadRef,
    finishDownloadRef,
    noteDlOutput,
    loadQueueFromLibrary,
    queueLink,
    confirmQueueDraft,
    checkDraftFolder,
    pasteLink,
    addQueueInput,
    copyQueuedLink,
    removeQueuedLink,
    chooseDlPlaylists,
    chooseTarget,
    runQueue,
    cancelPhoneDownload,
  };
}
