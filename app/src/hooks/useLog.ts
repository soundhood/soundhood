// The log: the visible lines (downloads, Proton, the network check, the self-test, the scan count
// and other messages that used to be the status line), the change lines kept only for "Copy log",
// Clear log and Copy log. Settings shows it under Tools (View log, Copy log); nothing of it is on the
// screens.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { batchLogLines, capLog, copyLogText, diagnosticsLines } from "../coreIpc";
import type { BatchReport, Diagnostics } from "../coreIpc";
import type { Notices } from "./useNotices";

export type Log = ReturnType<typeof useLog>;

type LogArgs = {
  folderRef: MutableRefObject<string>;
  isMobile: boolean;
  platform: string;
  notices: Notices;
};

export function useLog({ folderRef, isMobile, platform, notices }: LogArgs) {
  const [dlLogs, setDlLogs] = useState<string>("");

  /** Appends lines to the log, keeping only its tail once it grows long. */
  const appendLog = useCallback((lines: string[]) => {
    if (lines.length) setDlLogs((prev) => capLog(prev) + lines.join("\n") + "\n");
  }, []);
  // Status lines routed to the log (useNotices) land here.
  useLayoutEffect(() => notices.bindLog(appendLog), [notices, appendLog]);

  // Lines kept only for "Copy log": every applied batch (core:batch) and the developer switch. The
  // visible log never shows a change line (an edit says what it did in its own toast or report).
  const quietLogRef = useRef<string>("");
  function appendQuietLog(lines: string[]) {
    if (lines.length) quietLogRef.current = capLog(quietLogRef.current) + lines.join("\n") + "\n";
  }
  /** "Clear log": the visible log and the lines kept for copying. */
  function clearLog() {
    setDlLogs("");
    quietLogRef.current = "";
  }

  /** The newest line of the visible log (Settings shows it under View log). */
  const lastLine = useMemo(() => {
    const lines = dlLogs.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim();
    return "";
  }, [dlLogs]);

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
      notices.notify({ text: "Log copied" });
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
      notices.notify({ text: ok ? "Log copied" : copyFailed });
    } catch {
      notices.notify({ text: copyFailed });
    }
  }

  return { dlLogs, setDlLogs, lastLine, appendLog, appendQuietLog, clearLog, copyLog };
}

// Every batch the core applies (tag edit, move, delete, playlist change, undo) is reported by
// the host as a `core:batch` event: one line per entry, kept for "Copy log" only. Same
// StrictMode-safe pattern. Called by the shell after the yt-dlp listeners, where this effect always ran.
export function useCoreBatchLog(appendQuietLog: (lines: string[]) => void) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
