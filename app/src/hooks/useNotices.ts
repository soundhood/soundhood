// Where the app's messages go now that the screens have no status line. What the owner should see
// now (a result, a refusal, an error) is a toast; what only matters later (a scan count, how the
// phone loaded a song) goes to the log, which Settings shows under Tools; transient progress words
// ("Scanning…") go nowhere, because each has its own indicator now (a busy button, the download
// toast). Results of library writes are toasts with Undo (playlist edits: `undoable`) or the
// BatchReport (useTrackEdits).
//
// The hooks that still report in status lines (useLibrary, usePlayer, usePlaylists) are handed
// `setStatus`, which sends each line where it belongs by what it says (routeStatus below).
import { useCallback, useMemo, useRef } from "react";
import type { Change } from "../coreIpc";
import { useToast } from "../design";
import type { Setter } from "../lib/types";

export interface Notice {
  text: string;
  /** One text action (Undo, Retry, Cancel). */
  action?: { label: string; onClick: () => void };
}

export type Notices = ReturnType<typeof useNotices>;

/** Where a status line goes. */
export type StatusRoute = "drop" | "quiet" | "log" | "toast";

/**
 * Where a status line from useLibrary, usePlayer or usePlaylists goes:
 * - "drop": progress words ending in an ellipsis; each now has its own indicator;
 * - "quiet": the result of a playlist edit whose caller already showed a toast (its change line is
 *   in the lines Copy log carries);
 * - "toast": a failure: a toast, and the line goes to the log as "[error] ...";
 * - "log": everything else (the scan count, the phone's byte route).
 */
export function routeStatus(text: string): StatusRoute {
  const t = text.trim();
  if (!t || t.endsWith("…")) return "drop";
  if (/^(Added to|Removed from) /.test(t)) return "quiet";
  if (/\b(failed|error)\b/i.test(t) || /^Can't /.test(t) || /^Playlists: /.test(t)) return "toast";
  return "log";
}

export function useNotices() {
  const toast = useToast();
  // The log and the undo are made by hooks called later (useLog, useTrackEdits); they hand
  // themselves over with bindLog and bindUndo. The undo answers false when another one is running.
  const logRef = useRef<(lines: string[]) => void>(() => {});
  const undoRef = useRef<(changes: readonly Change[]) => boolean>(() => false);
  const lastRef = useRef("");

  const notify = useCallback((n: Notice) => void toast.show({ text: n.text, action: n.action }), [toast]);

  /**
   * A toast whose Undo undoes exactly `changes` (the ones its own gesture made, by their ids) and
   * nothing else, whatever came after them. The first press takes it; a second press does nothing.
   * Pressed while another undo runs, the same toast comes back to be pressed again.
   */
  const undoable = useCallback(
    (text: string, changes: readonly Change[]) => {
      let pressed = false;
      const action = {
        label: "Undo",
        onClick: () => {
          if (pressed) return;
          pressed = undoRef.current(changes);
          if (!pressed) toast.show({ text, action });
        },
      };
      toast.show({ text, action });
    },
    [toast],
  );

  const route = useCallback(
    (text: string) => {
      lastRef.current = text;
      switch (routeStatus(text)) {
        case "drop":
        case "quiet":
          return;
        case "toast":
          toast.show({ text });
          logRef.current([`[error] ${text}`]);
          return;
        case "log":
          logRef.current([text]);
      }
    },
    [toast],
  );

  /** A drop-in for the old status line's setter: the line is routed, never shown as a status. */
  const setStatus = useCallback<Setter<string>>(
    (v) => route(typeof v === "function" ? v(lastRef.current) : v),
    [route],
  );

  const bindLog = useCallback((append: (lines: string[]) => void) => {
    logRef.current = append;
  }, []);
  const bindUndo = useCallback((undo: (changes: readonly Change[]) => boolean) => {
    undoRef.current = undo;
  }, []);

  return useMemo(() => ({ notify, undoable, setStatus, bindLog, bindUndo }), [notify, undoable, setStatus, bindLog, bindUndo]);
}
