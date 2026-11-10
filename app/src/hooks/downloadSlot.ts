// One download at a time, on either engine. A download holds the slot from the moment it starts
// until it is over: the helper has ended and what it produced is filed into that download's own
// playlists, with the last change read again. The slot is taken synchronously (a ref), so no path
// that starts a download (the sheet's Download, a queued link, the queue's next link, a Retry) can
// start a second one while one runs, whatever an older render saw. `busy` keeps what waits for a
// download (Undo last change, Sync now, the Download buttons) locked until that end; `running` is
// the helper alone and decides the download's toast, which goes the moment the helper ends.
// Also what the running download shows and offers: its progress (0 to 100, or -1; the phone's
// plugin sends its own figure and lines, the PC's yt-dlp lines are read by useDownloads), its
// seconds, and on the phone its Cancel (the PC host has no cancel yet).
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type { Notices } from "./useNotices";

export type DownloadSlot = ReturnType<typeof useDownloadSlot>;

type SlotArgs = {
  isMobile: boolean;
  notify: Notices["notify"];
  /** A line the phone's plugin printed (the log, the reason a download stopped). */
  onPhoneLine: (line: string) => void;
  appendLog: (lines: string[]) => void;
};

export function useDownloadSlot({ isMobile, notify, onPhoneLine, appendLog }: SlotArgs) {
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(-1);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) setProgress(-1);
  }, [running]);
  // Seconds since the helper started, so a silent yt-dlp is distinguishable from a dead one.
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const t0 = Date.now();
    const t = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  // The phone's plugin: its progress figure and its output lines, registered once.
  const lineRef = useRef(onPhoneLine);
  useEffect(() => {
    lineRef.current = onPhoneLine;
  });
  useEffect(() => {
    if (!isMobile) return;
    let un: (() => void) | undefined;
    let active = true;
    addPluginListener<{ id: string; progress: number; eta?: number; line: string }>("soundhood-ytdl", "progress", (e) => {
      if (typeof e.progress === "number" && e.progress >= 0) setProgress(e.progress);
      if (e.line) lineRef.current(e.line);
    })
      .then((l) => {
        if (active) un = () => l.unregister();
        else l.unregister();
      })
      .catch((e) => appendLog([`Progress events unavailable: ${String(e).slice(0, 100)}`]));
    return () => {
      active = false;
      if (un) un();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // The phone's download in flight, for its Cancel.
  const phoneId = useRef("");
  async function cancelPhoneDownload() {
    const id = phoneId.current;
    if (!id) return;
    try {
      await invoke("plugin:soundhood-ytdl|cancel", { args: { id } });
      notify({ text: "Cancelling the download" });
    } catch (e) {
      notify({ text: `Cancel failed: ${String(e).slice(0, 100)}` });
    }
  }

  return {
    /** A download is in flight, from its start to the end of its filing. */
    busy,
    /** The helper runs (its toast shows). */
    running,
    progress,
    setProgress,
    seconds,
    phoneId,
    /** The phone's download can be stopped (the PC host has no cancel yet). */
    canCancel: isMobile,
    cancelPhoneDownload,
    /** True while a download holds the slot, as of now. */
    taken: () => held.current,
    /** Takes the slot for a download about to start; false, changing nothing, while one holds it. */
    take(): boolean {
      if (held.current) return false;
      held.current = true;
      setBusy(true);
      setRunning(true);
      return true;
    },
    /**
     * The helper ended: the download's toast goes at once, before any toast saying how it ended,
     * so that toast never pushes a newer notice out of the stack past the leaving one.
     */
    helperEnded() {
      flushSync(() => setRunning(false));
    },
    /** The download is over (filed, failed or refused by the host): another one may start. */
    release() {
      held.current = false;
      setRunning(false);
      setBusy(false);
    },
  };
}
