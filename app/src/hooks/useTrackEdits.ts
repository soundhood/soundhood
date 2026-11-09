// Changes to tracks on disk and their undo: moving files between folders, sending them to the bin,
// writing tags, and "Undo last change". The player lets go of a file it holds while it changes.
import { useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { batchLogLines, libraryKey, undoStatus } from "../coreIpc";
import type { BatchReport, ChangeSummary } from "../coreIpc";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { displayName } from "../lib/tracks";
import type { HeldPlayback, PlaylistFile, Setter, TagDraft, Track } from "../lib/types";

export type TrackEdits = ReturnType<typeof useTrackEdits>;

type TrackEditsArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  folderRef: MutableRefObject<string>;
  setAllTracks: Setter<Track[]>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  refreshLastChange: (lib?: string) => Promise<void>;
  lastChange: ChangeSummary | null;
  plView: string;
  setPlView: Setter<string>;
  setSelectedPaths: Setter<Set<string>>;
  appendLog: (lines: string[]) => void;
  currentPath: string;
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

export function useTrackEdits({
  isMobile,
  setStatus,
  folderRef,
  setAllTracks,
  loadPlaylists,
  refreshLastChange,
  lastChange,
  plView,
  setPlView,
  setSelectedPaths,
  appendLog,
  currentPath,
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

  return { undoBusy, moveTracksTo, deleteTracks, undoLast, openTagEditor, saveTags };
}
