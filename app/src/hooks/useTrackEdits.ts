// Changes to tracks on disk and their undo: moving files between folders, sending them to the bin,
// writing tags, and every Undo (Settings "Undo last change", a toast's Undo, "Undo this batch").
// Each tier-1 write ends in a BatchReport (`report`, drawn by features/dialogs/WriteReport.tsx),
// which never closes by itself and offers "Undo this batch". The player lets go of a file it holds
// while it changes.
//
// Every write runs through the journal (lib/journal.ts), which hands back the report its own command
// sent, so each change is kept by its own batch id. A selection of N songs is still N journaled
// changes (one per song; OPEN): the report keeps the id of each, and "Undo this batch" undoes
// exactly those, newest first (undo_batch), whatever came after them, stopping with a plain line at
// the first one that is refused. Nothing here guesses a change from the newest one in the journal.
import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { batchLogLines, changeOf, libraryKey } from "../coreIpc";
import type { BatchReport, Change } from "../coreIpc";
import type { BatchRow } from "../design";
import { folderLabel, songCount } from "../features/library/trackInfo";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { journaled } from "../lib/journal";
import { displayName } from "../lib/tracks";
import type { HeldPlayback, PlaylistFile, Setter, TagDraft, Track } from "../lib/types";
import { reasonLines, undoOutcome, type UndoStep } from "../lib/undoOutcome";
import type { Notices } from "./useNotices";

export type TrackEdits = ReturnType<typeof useTrackEdits>;

/** What a tier-1 batch did, as the BatchReport shows it. */
export type WriteReport = {
  title: string;
  rows: BatchRow[];
  /** Lines under the counts: why rows were skipped or failed, why an undo stopped. */
  reasons: string[];
  /** The journaled changes the batch made, oldest first, each by its own id. Empty: nothing to undo (or it was an undo). */
  changes: Change[];
};

/** Where an undo was asked for: its result is a toast for a toast, else a report. */
export type UndoFrom = "settings" | "report" | "toast";

type TrackEditsArgs = {
  isMobile: boolean;
  notices: Notices;
  folderRef: MutableRefObject<string>;
  setAllTracks: Setter<Track[]>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  refreshLastChange: (lib?: string) => Promise<void>;
  plView: string;
  setPlView: Setter<string>;
  setSelectedPaths: Setter<Set<string>>;
  appendLog: (lines: string[]) => void;
  currentPathRef: MutableRefObject<string>;
  setCurrentPath: Setter<string>;
  setCurrentPlaylist: Setter<string>;
  releasePlayingTrack: (path: string) => HeldPlayback | null;
  reloadHeldTrack: (held: HeldPlayback, path: string) => Promise<void>;
  stopPlayer: () => void;
  editTags: TagDraft | null;
  setEditTags: Setter<TagDraft | null>;
  setConfirmDelete: Setter<Track[] | null>;
};

/** "Title - Artist" as the tags read, for a report row. */
function tagLine(title: string, artist: string): string {
  return `${title || "(no title)"} - ${artist || "(no artist)"}`;
}

/** An error as one plain line. */
function plain(err: unknown): string {
  return String(err).split("\n")[0].slice(0, 200);
}

export function useTrackEdits({
  isMobile,
  notices,
  folderRef,
  setAllTracks,
  loadPlaylists,
  refreshLastChange,
  plView,
  setPlView,
  setSelectedPaths,
  appendLog,
  currentPathRef,
  setCurrentPath,
  setCurrentPlaylist,
  releasePlayingTrack,
  reloadHeldTrack,
  stopPlayer,
  editTags,
  setEditTags,
  setConfirmDelete,
}: TrackEditsArgs) {
  const [undoBusy, setUndoBusy] = useState<boolean>(false);
  // Set before the first await of an undo, so a second press (a double click, a toast and the
  // Settings button together) does nothing while one runs.
  const undoingRef = useRef(false);
  const [report, setReport] = useState<WriteReport | null>(null);
  // The edit dialog's own error row: a refused tag write keeps the dialog open.
  const [tagError, setTagError] = useState<string>("");
  // A write in flight (tags, a delete, a move): its dialog's button waits, and the ref turns a second
  // press away at once, before the button has redrawn.
  const [writing, setWriting] = useState<boolean>(false);
  const writingRef = useRef(false);
  function startWriting(): boolean {
    if (writingRef.current) return false;
    writingRef.current = true;
    setWriting(true);
    return true;
  }
  function endWriting() {
    writingRef.current = false;
    setWriting(false);
  }

  // Move any track into another playlist folder. If it is the one playing, the player lets go of
  // the file during the move and picks it up at its new path at the same position.
  async function moveTrackTo(
    fromPath: string,
    target: string,
  ): Promise<{ moved: Track; change: Change | null } | { error: string }> {
    const lib = folderRef.current;
    if (!fromPath || !lib || !target) return { error: "no library" };

    const held = releasePlayingTrack(fromPath);
    try {
      const { value: moved, report: sent } = await journaled<Track>("move_track", {
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

      if (held) {
        setCurrentPath(moved.path);
        setCurrentPlaylist(moved.playlist);
        await reloadHeldTrack(held, moved.path);
      }
      await loadPlaylists(lib); // playlist files were updated on the Rust side
      return { moved, change: changeOf(sent) };
    } catch (err) {
      if (held) await reloadHeldTrack(held, fromPath);
      return { error: plain(err) };
    }
  }

  // Send tracks to the bin (after the confirmation box): the Recycle Bin on the desktop, the bin
  // inside the library on the phone; "Undo this batch" brings them back. Stops the player if the
  // song it plays went to the bin.
  async function deleteTracks(tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || tracks.length === 0 || !startWriting()) return;
    const rows: BatchRow[] = [];
    const changes: Change[] = [];
    const gone = new Set<string>();
    for (const t of tracks) {
      const name = displayName(t.name);
      try {
        const { report: sent } = await journaled<null>("delete_track", { args: { path: t.path, libraryDir: lib } });
        gone.add(t.path);
        rows.push({ key: t.path, before: `in ${folderLabel(t.playlist || "(root)")}`, after: name, status: "done" });
        const c = changeOf(sent);
        if (c) changes.push(c);
      } catch (err) {
        rows.push({ key: t.path, before: name, after: name, status: "failed", reason: plain(err) });
      }
    }
    // The song playing now, read live: the player may have moved on while the files went.
    if (gone.has(currentPathRef.current)) stopPlayer();
    setSelectedPaths((prev) => new Set([...prev].filter((p) => !gone.has(p))));
    setAllTracks((prev) => prev.filter((x) => !gone.has(x.path)));
    await loadPlaylists(lib);
    setConfirmDelete(null);
    endWriting();
    await refreshLastChange(lib);
    const bin = isMobile ? "the bin" : "the Recycle Bin";
    setReport({
      title: gone.size ? `Moved ${songCount(gone.size)} to ${bin}` : "Nothing was deleted",
      rows,
      reasons: reasonLines(rows),
      changes,
    });
  }

  // Move several files (Folders view). Each move keeps playlists consistent on the Rust side.
  async function moveTracksTo(tracks: Track[], target: string) {
    const check = checkFolderName(target);
    if (!check.ok) {
      notices.notify({ text: folderNameRefusal(target, check.reason) });
      return;
    }
    const lib = folderRef.current;
    if (!lib || !startWriting()) return;
    const rows: BatchRow[] = [];
    const changes: Change[] = [];
    const to = folderLabel(check.name);
    for (const t of tracks) {
      const from = t.playlist || "(root)";
      const name = displayName(t.name);
      if (from === check.name) {
        rows.push({ key: t.path, before: name, after: name, status: "skipped", reason: `already in ${to}` });
        continue;
      }
      const r = await moveTrackTo(t.path, check.name);
      if ("moved" in r) {
        rows.push({ key: t.path, before: `in ${folderLabel(from)}`, after: name, status: "done" });
        if (r.change) changes.push(r.change);
      } else {
        rows.push({ key: t.path, before: name, after: name, status: "failed", reason: r.error });
      }
    }
    endWriting();
    await refreshLastChange(lib);
    const done = rows.filter((r) => r.status === "done").length;
    setReport({ title: done ? `Moved ${songCount(done)} to ${to}` : "Nothing was moved", rows, reasons: reasonLines(rows), changes });
  }

  /**
   * Starts undoing `changes` (oldest first), each by its own id, unless an undo is running: then it
   * returns false and does nothing. Settings passes the change it names, a toast the changes of its
   * own gesture, the report the changes of its batch.
   */
  function undoChanges(changes: readonly Change[], from: UndoFrom): boolean {
    const lib = folderRef.current;
    if (!lib || changes.length === 0 || undoingRef.current) return false;
    undoingRef.current = true;
    setUndoBusy(true);
    void runUndo(lib, [...changes], from).finally(() => {
      undoingRef.current = false;
      setUndoBusy(false);
    });
    return true;
  }

  /** "Undo this batch" in the open report. */
  function undoReport(): boolean {
    return report ? undoChanges(report.changes, "report") : false;
  }

  /**
   * Undoes `changes` newest first through undo_batch, stopping at the first that is refused, then
   * re-reads the library so the lists, the playlists, the selection and the player follow whatever
   * moved back, and says what happened: a toast for an undo from a toast, or for a clean undo of a
   * playlist change from Settings; else a report (it never closes by itself).
   */
  async function runUndo(lib: string, changes: Change[], from: UndoFrom) {
    const steps: UndoStep[] = [];
    for (const change of [...changes].reverse()) {
      let step: UndoStep;
      try {
        const { value } = await journaled<BatchReport>("undo_batch", { libraryDir: lib, batch: change.batch });
        step = { change, report: value };
      } catch (err) {
        step = { change, report: null, error: plain(err) };
      }
      steps.push(step);
      const r = step.report;
      if (!r || r.skipped?.length || r.failed?.length || r.aborted) break;
    }
    const out = undoOutcome(changes, steps, isMobile);
    let refreshError = "";
    try {
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      const pls = await loadPlaylists(lib);
      if (pls && plView && !pls.some((p) => p.name === plView)) setPlView("");
      await followUndo(out.merged, found, lib);
    } catch (err) {
      refreshError = `Refresh error: ${plain(err)}`;
    }
    // What was left as it was, and why, goes to the visible log too; applied lines stay with the
    // other change lines that only "Copy log" carries.
    appendLog(batchLogLines({ ...out.merged, applied: [] }));
    if (out.stopped) appendLog([`[undo] ${out.stopped}`]);
    if (refreshError) appendLog([`[undo] ${refreshError}`]);
    await refreshLastChange(lib);

    if (from === "toast") {
      // A toast's undo leaves an open report as it is: it was about another change.
      notices.notify({ text: refreshError || out.toast });
      return;
    }
    const playlistsOnly = out.merged.applied.every((a) => !a.path_before && !a.path_after);
    if (from === "settings" && changes.length === 1 && out.clean && playlistsOnly && !refreshError) {
      setReport(null);
      notices.notify({ text: out.toast });
      return;
    }
    setReport({ title: out.title, rows: out.rows, reasons: refreshError ? [refreshError, ...out.reasons] : out.reasons, changes: [] });
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

  function openTagEditor(t: Track) {
    setTagError("");
    setEditTags({ track: t, title: t.title, artist: t.artist });
  }

  async function saveTags() {
    const lib = folderRef.current;
    if (!editTags || !lib || !startWriting()) return;
    const track = editTags.track;
    const path = track.path;
    setTagError("");
    const held = releasePlayingTrack(path);
    try {
      const { value: updated, report: sent, sure } = await journaled<Track>("write_tags", {
        args: { path, libraryDir: lib, title: editTags.title, artist: editTags.artist },
      });
      setAllTracks((prev) => prev.map((t) => (t.path === updated.path ? updated : t)));
      setEditTags(null);
      if (held) await reloadHeldTrack(held, updated.path);
      const c = changeOf(sent);
      // Not sure what it sent (the host's events did not come back in time): written, no Undo here.
      const row: BatchRow = c || !sure
        ? { key: path, before: tagLine(track.title, track.artist), after: tagLine(updated.title, updated.artist), status: "done" }
        : { key: path, before: displayName(updated.name), after: displayName(updated.name), status: "skipped", reason: "the file already has these tags" };
      setReport({
        title: c || !sure ? `Saved the tags of ${displayName(updated.name)}` : "Nothing to change",
        rows: [row],
        reasons: reasonLines([row]),
        changes: c ? [c] : [],
      });
    } catch (err) {
      setTagError(plain(err));
      if (held) await reloadHeldTrack(held, path);
    }
    endWriting();
    await refreshLastChange(lib);
  }

  // A toast's Undo (useNotices) runs exactly the changes it was made with, through the newest render.
  const undoRef = useRef(undoChanges);
  useLayoutEffect(() => {
    undoRef.current = undoChanges;
  });
  useLayoutEffect(() => notices.bindUndo((changes) => undoRef.current(changes, "toast")), [notices]);

  return {
    undoBusy,
    writing,
    report,
    closeReport: () => setReport(null),
    undoReport,
    undoChanges,
    tagError,
    moveTracksTo,
    deleteTracks,
    openTagEditor,
    saveTags,
  };
}
