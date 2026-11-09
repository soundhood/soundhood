// Playlist files: creating, filling, emptying and deleting them. Each call says how it went on the
// status line, as before, and also returns it (true, or the new playlist's name) so the screens can
// show a toast.
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlaylistFile, Setter, Track } from "../lib/types";

export type Playlists = ReturnType<typeof usePlaylists>;

type PlaylistsArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  folderRef: MutableRefObject<string>;
  setPlaylistFiles: Setter<PlaylistFile[]>;
  plView: string;
  setPlView: Setter<string>;
  openPlaylistView: (name: string) => void;
  refreshLastChange: (lib?: string) => Promise<void>;
  setConfirmDeletePlaylist: Setter<string>;
};

export function usePlaylists({
  isMobile,
  setStatus,
  folderRef,
  setPlaylistFiles,
  plView,
  setPlView,
  openPlaylistView,
  refreshLastChange,
  setConfirmDeletePlaylist,
}: PlaylistsArgs) {
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

  async function addToPlaylist(name: string, tracks: Track[]): Promise<boolean> {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return false;
    let ok = false;
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
      ok = true;
    } catch (err) {
      setStatus(`Add failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
    return ok;
  }

  async function removeFromPlaylist(name: string, tracks: Track[]): Promise<boolean> {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return false;
    let ok = false;
    try {
      const pl = await invoke<PlaylistFile>("playlist_remove", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => prev.map((p) => (p.name === pl.name ? pl : p)));
      setStatus(`Removed from ${pl.name}`);
      ok = true;
    } catch (err) {
      setStatus(`Remove failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
    return ok;
  }

  /** Creates the playlist file; `open` also shows it as the track list (the default, as before). */
  async function createPlaylist(name: string, open = true): Promise<string | null> {
    const lib = folderRef.current;
    const clean = name.trim();
    if (!lib || !clean) return null;
    let created: string | null = null;
    try {
      const pl = await invoke<PlaylistFile>("playlist_create", { args: { libraryDir: lib, name: clean } });
      setPlaylistFiles((prev) =>
        prev.some((p) => p.name === pl.name)
          ? prev
          : [...prev, pl].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      );
      if (open) openPlaylistView(pl.name);
      created = pl.name;
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

  return {
    createPlaylistsFromFolders,
    addToPlaylist,
    removeFromPlaylist,
    createPlaylist,
    deletePlaylist,
  };
}
