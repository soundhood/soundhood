// Playlist files: creating, filling, emptying and deleting them. Each write goes through the journal
// (lib/journal.ts) and returns the change its own command made (null: it changed nothing, so there
// is nothing to undo), so the screens' toasts undo exactly that change. Failures still go to the
// status line, as before.
import { useRef, type MutableRefObject } from "react";
import { changeOf, type Change } from "../coreIpc";
import { journaled } from "../lib/journal";
import type { PlaylistFile, Setter, Track } from "../lib/types";
import type { Notices } from "./useNotices";

export type Playlists = ReturnType<typeof usePlaylists>;

/**
 * A playlist write that went through: the change it made, null when it changed nothing (a song
 * already in the playlist, a name that exists). `sure` is false when the host's report did not come
 * back in time: then it is not known whether it changed anything.
 */
export type PlaylistWrite = { change: Change | null; sure: boolean };

type PlaylistsArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  notices: Notices;
  folderRef: MutableRefObject<string>;
  setPlaylistFiles: Setter<PlaylistFile[]>;
  plView: string;
  setPlView: Setter<string>;
  openPlaylistView: (name: string) => void;
  refreshLastChange: (lib?: string) => Promise<void>;
  setConfirmDeletePlaylist: Setter<string>;
};

const byName = (a: PlaylistFile, b: PlaylistFile) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export function usePlaylists({
  isMobile,
  setStatus,
  notices,
  folderRef,
  setPlaylistFiles,
  plView,
  setPlView,
  openPlaylistView,
  refreshLastChange,
  setConfirmDeletePlaylist,
}: PlaylistsArgs) {
  // "Make playlists from folders" runs once at a time: a second press while it runs does nothing.
  const makingRef = useRef(false);

  async function createPlaylistsFromFolders() {
    const lib = folderRef.current;
    if (!lib || makingRef.current) return;
    makingRef.current = true;
    try {
      const { value: pls, report, sure } = await journaled<PlaylistFile[]>("playlists_from_folders", { libraryDir: lib });
      setPlaylistFiles(pls);
      // The change's own words, as the Undo row and the undo's toast say it ("Made 5 playlists from
      // folders"; one playlist: "Created playlist <name>").
      const change = changeOf(report);
      if (change) notices.undoable(change.label, [change]);
      else notices.notify({ text: sure ? "Every folder already has its playlist" : "Made playlists from folders" });
    } catch (err) {
      setStatus(`Playlists: ${String(err)}`);
    } finally {
      makingRef.current = false;
    }
    await refreshLastChange(lib);
  }

  async function addToPlaylist(name: string, tracks: Track[]): Promise<PlaylistWrite | null> {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return null;
    let done: PlaylistWrite | null = null;
    try {
      const { value: pl, report, sure } = await journaled<PlaylistFile>("playlist_add", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => {
        const i = prev.findIndex((p) => p.name === pl.name);
        const next = i >= 0 ? prev.map((p) => (p.name === pl.name ? pl : p)) : [...prev, pl];
        return next.sort(byName);
      });
      setStatus(`Added to ${pl.name}`);
      done = { change: changeOf(report), sure };
    } catch (err) {
      setStatus(`Add failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
    return done;
  }

  async function removeFromPlaylist(name: string, tracks: Track[]): Promise<PlaylistWrite | null> {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return null;
    let done: PlaylistWrite | null = null;
    try {
      const { value: pl, report, sure } = await journaled<PlaylistFile>("playlist_remove", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => prev.map((p) => (p.name === pl.name ? pl : p)));
      setStatus(`Removed from ${pl.name}`);
      done = { change: changeOf(report), sure };
    } catch (err) {
      setStatus(`Remove failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
    return done;
  }

  /**
   * Creates the playlist file, or finds the one of that name; `open` also shows it as the track list
   * (the default, as before). Returns its name and the change (null: it existed already).
   */
  async function createPlaylist(name: string, open = true): Promise<(PlaylistWrite & { name: string }) | null> {
    const lib = folderRef.current;
    const clean = name.trim();
    if (!lib || !clean) return null;
    let created: (PlaylistWrite & { name: string }) | null = null;
    try {
      const { value: pl, report, sure } = await journaled<PlaylistFile>("playlist_create", { args: { libraryDir: lib, name: clean } });
      setPlaylistFiles((prev) => (prev.some((p) => p.name === pl.name) ? prev : [...prev, pl].sort(byName)));
      if (open) openPlaylistView(pl.name);
      created = { name: pl.name, change: changeOf(report), sure };
    } catch (err) {
      setStatus(`Create failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
    return created;
  }

  async function deletePlaylist(name: string) {
    const lib = folderRef.current;
    if (!lib || !name) return;
    try {
      const { report } = await journaled<null>("playlist_delete", { args: { libraryDir: lib, name } });
      setPlaylistFiles((prev) => prev.filter((p) => p.name !== name));
      if (plView === name) setPlView("");
      // Phone: the bin inside the library; desktop: the Recycle Bin. Both undoable.
      const text = `Playlist "${name}" moved to ${isMobile ? "the bin" : "the Recycle Bin"} (songs untouched)`;
      const change = changeOf(report);
      if (change) notices.undoable(text, [change]);
      else notices.notify({ text });
    } catch (err) {
      setStatus(`Delete failed: ${String(err)}`);
    } finally {
      setConfirmDeletePlaylist("");
    }
    await refreshLastChange(lib);
  }

  return {
    createPlaylistsFromFolders,
    addToPlaylist,
    removeFromPlaylist,
    createPlaylist,
    deletePlaylist,
  };
}
