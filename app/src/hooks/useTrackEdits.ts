// Changes to tracks on disk and their undo: moving files between folders, sending them to the bin,
// writing tags, and "Undo last change". Each is a tier-1 write: it ends in a BatchReport (`report`,
// drawn by features/dialogs/WriteReport.tsx), which never closes by itself and offers "Undo this
// batch". The player lets go of a file it holds while it changes.
//
// A selection of N songs is still N journaled changes (one per song; OPEN), so a report remembers
// the id of each change it made (last_change read right after the op, kept only when it is new)
// and "Undo this batch" undoes them newest first through undo_last, checking before each one that
// the newest change on this device is the one expected, and stopping with a plain line at the
// first that is not.
import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { batchLogLines, libraryKey, undoStatus } from "../coreIpc";
import type { BatchReport, ChangeSummary } from "../coreIpc";
import type { BatchRow } from "../design";
import { folderLabel, songCount } from "../features/library/trackInfo";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { displayName } from "../lib/tracks";
import type { HeldPlayback, PlaylistFile, Setter, TagDraft, Track } from "../lib/types";
import type { Notices } from "./useNotices";

export type TrackEdits = ReturnType<typeof useTrackEdits>;

/** What a tier-1 batch did, as the BatchReport shows it. */
export type WriteReport = {
  title: string;
  rows: BatchRow[];
  /** Lines under the counts: why rows were skipped or failed, why an undo stopped. */
  reasons: string[];
  /** The journaled changes the batch made, oldest first. Empty: nothing to undo (or it was an undo). */
  changes: ChangeSummary[];
};

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

/** The last part of a library path. */
function fileName(p: string): string {
  return p.slice(p.replace(/\\/g, "/").lastIndexOf("/") + 1);
}

/** One line per distinct reason: "2 skipped: already in Evenings". */
function reasonLines(rows: readonly BatchRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "done" || !r.reason) continue;
    const key = `${r.status === "skipped" ? "skipped" : "failed"}: ${r.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${k}`);
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
  const [report, setReport] = useState<WriteReport | null>(null);
  // The edit dialog's own error row: a refused tag write keeps the dialog open.
  const [tagError, setTagError] = useState<string>("");
  // A write in flight (tags, a delete, a move): its dialog's button waits, so a second press cannot
  // run it twice.
  const [writing, setWriting] = useState<boolean>(false);

  /** The newest change on this device that can be undone, read now. */
  async function newestChange(lib: string): Promise<ChangeSummary | null> {
    try {
      return (await invoke<ChangeSummary | null>("last_change", { libraryDir: lib })) ?? null;
    } catch {
      return null;
    }
  }
  /** The change an op just made: the newest one, when it is not the one there was before the op. */
  const madeBy = (before: ChangeSummary | null, after: ChangeSummary | null) => (after && after.batch !== before?.batch ? after : null);

  // Move any track into another playlist folder. If it is the one playing, the player lets go of
  // the file during the move and picks it up at its new path at the same position.
  async function moveTrackTo(fromPath: string, target: string): Promise<{ moved: Track } | { error: string }> {
    const lib = folderRef.current;
    if (!fromPath || !lib || !target) return { error: "no library" };

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

      if (held) {
        setCurrentPath(moved.path);
        setCurrentPlaylist(moved.playlist);
        await reloadHeldTrack(held, moved.path);
      }
      await loadPlaylists(lib); // playlist files were updated on the Rust side
      return { moved };
    } catch (err) {
      if (held) await reloadHeldTrack(held, fromPath);
      return { error: plain(err) };
    }
  }

  // Send tracks to the bin (after the confirmation box): the system Recycle Bin on the desktop,
  // the app's own bin inside the library on the phone; "Undo this batch" or "Undo last change"
  // brings them back. Stops the player if the song it plays went to the bin.
  async function deleteTracks(tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || tracks.length === 0 || writing) return;
    setWriting(true);
    const rows: BatchRow[] = [];
    const changes: ChangeSummary[] = [];
    const gone = new Set<string>();
    let before = await newestChange(lib);
    for (const t of tracks) {
      const name = displayName(t.name);
      try {
        await invoke("delete_track", { args: { path: t.path, libraryDir: lib } });
        gone.add(t.path);
        rows.push({ key: t.path, before: `in ${folderLabel(t.playlist || "(root)")}`, after: name, status: "done" });
        const after = await newestChange(lib);
        const c = madeBy(before, after);
        if (c) changes.push(c);
        before = after;
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
    setWriting(false);
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
    if (!lib) return;
    const rows: BatchRow[] = [];
    const changes: ChangeSummary[] = [];
    const to = folderLabel(check.name);
    let before = await newestChange(lib);
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
        const after = await newestChange(lib);
        const c = madeBy(before, after);
        if (c) changes.push(c);
        before = after;
      } else {
        rows.push({ key: t.path, before: name, after: name, status: "failed", reason: r.error });
      }
    }
    await refreshLastChange(lib);
    const done = rows.filter((r) => r.status === "done").length;
    setReport({ title: done ? `Moved ${songCount(done)} to ${to}` : "Nothing was moved", rows, reasons: reasonLines(rows), changes });
  }

  // "Undo last change" (Settings, a toast's Undo): the newest change this device made, read when
  // the undo starts, so it is always the one undo_last reverses.
  async function undoLast() {
    const lib = folderRef.current;
    if (!lib || undoBusy) return;
    const change = await newestChange(lib);
    if (!change) {
      notices.notify({ text: "Nothing to undo" });
      await refreshLastChange(lib);
      return;
    }
    await runUndo(lib, [change], true);
  }

  /** "Undo this batch" in the open report. */
  async function undoReport() {
    const lib = folderRef.current;
    const r = report;
    if (!lib || !r || !r.changes.length || undoBusy) return;
    await runUndo(lib, r.changes, false);
  }

  /**
   * Undoes `changes` (oldest first) newest first, then re-reads the library so the lists, the
   * playlists, the selection and the player follow whatever moved back, and says what happened: a
   * toast for a clean undo of a playlist change, else a report (it never closes by itself).
   */
  async function runUndo(lib: string, changes: ChangeSummary[], single: boolean) {
    setUndoBusy(true);
    const reports: BatchReport[] = [];
    let stopped = "";
    try {
      for (const c of [...changes].reverse()) {
        const now = await newestChange(lib);
        if (!now || now.batch !== c.batch) {
          stopped = now
            ? `Stopped: the newest change is now "${now.label}", which this batch did not make`
            : "Stopped: this batch was undone already";
          break;
        }
        reports.push(await invoke<BatchReport>("undo_last", { libraryDir: lib }));
      }
    } catch (err) {
      stopped = `Undo failed: ${plain(err)}`;
    }
    const merged: BatchReport = {
      batch: reports.map((r) => r.batch).join(","),
      applied: reports.flatMap((r) => r.applied ?? []),
      skipped: reports.flatMap((r) => r.skipped ?? []),
      failed: reports.flatMap((r) => r.failed ?? []),
      aborted: reports.some((r) => r.aborted),
    };
    try {
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      const pls = await loadPlaylists(lib);
      if (pls && plView && !pls.some((p) => p.name === plView)) setPlView("");
      await followUndo(merged, found, lib);
    } catch (err) {
      stopped ||= `Refresh error: ${plain(err)}`;
    }
    // What was left as it was, and why, goes to the visible log too; applied lines stay with the
    // other change lines that only "Copy log" carries.
    appendLog(batchLogLines({ ...merged, applied: [] }));
    if (stopped) appendLog([`[undo] ${stopped}`]);
    setUndoBusy(false);
    await refreshLastChange(lib);

    const clean = !stopped && reports.length === changes.length && !merged.skipped.length && !merged.failed.length && !merged.aborted;
    const playlistsOnly = merged.applied.every((a) => !a.path_before && !a.path_after);
    if (single && clean && playlistsOnly) {
      setReport(null);
      notices.notify({ text: undoStatus(merged, changes[0].label) });
      return;
    }
    const rows: BatchRow[] = [
      ...merged.applied.map((a, i) => ({ key: `done-${i}`, before: "", after: a.label, status: "done" as const })),
      ...merged.skipped.map((s, i) => ({ key: `skipped-${i}`, before: fileName(s.path), after: fileName(s.path), status: "skipped" as const, reason: s.reason })),
      ...merged.failed.map((f, i) => ({ key: `failed-${i}`, before: fileName(f.path), after: fileName(f.path), status: "failed" as const, reason: f.error })),
    ];
    const title =
      changes.length === 1
        ? stopped && !reports.length
          ? "Nothing was undone"
          : undoStatus(merged, changes[0].label)
        : `Undid ${reports.length} of ${changes.length} changes`;
    setReport({ title, rows, reasons: [...(stopped ? [stopped] : []), ...reasonLines(rows)], changes: [] });
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
    if (!editTags || !lib || writing) return;
    setWriting(true);
    const track = editTags.track;
    const path = track.path;
    setTagError("");
    const before = await newestChange(lib);
    const held = releasePlayingTrack(path);
    try {
      const updated = await invoke<Track>("write_tags", {
        args: { path, libraryDir: lib, title: editTags.title, artist: editTags.artist },
      });
      setAllTracks((prev) => prev.map((t) => (t.path === updated.path ? updated : t)));
      setEditTags(null);
      if (held) await reloadHeldTrack(held, updated.path);
      const c = madeBy(before, await newestChange(lib));
      const row: BatchRow = c
        ? { key: path, before: tagLine(track.title, track.artist), after: tagLine(updated.title, updated.artist), status: "done" }
        : { key: path, before: displayName(updated.name), after: displayName(updated.name), status: "skipped", reason: "the file already has these tags" };
      setReport({
        title: c ? `Saved the tags of ${displayName(updated.name)}` : "Nothing to change",
        rows: [row],
        reasons: reasonLines([row]),
        changes: c ? [c] : [],
      });
    } catch (err) {
      setTagError(plain(err));
      if (held) await reloadHeldTrack(held, path);
    }
    setWriting(false);
    await refreshLastChange(lib);
  }

  // A toast's Undo (a playlist deleted, playlists made from folders: useNotices) runs the newest undo.
  const undoRef = useRef(undoLast);
  useLayoutEffect(() => {
    undoRef.current = undoLast;
  });
  useLayoutEffect(() => notices.bindUndo(() => void undoRef.current()), [notices]);

  return {
    undoBusy,
    writing,
    report,
    closeReport: () => setReport(null),
    undoReport,
    tagError,
    moveTracksTo,
    deleteTracks,
    undoLast,
    openTagEditor,
    saveTags,
  };
}
