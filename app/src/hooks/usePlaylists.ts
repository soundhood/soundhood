// Playlist files: the filter and the "new playlist" field of the Playlists tab, and creating,
// filling, emptying and deleting playlists.
import { useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlaylistFile, Setter, Track } from "../lib/types";

export type Playlists = ReturnType<typeof usePlaylists>;

type PlaylistsArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  folderRef: MutableRefObject<string>;
  playlistFiles: PlaylistFile[];
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
  playlistFiles,
  setPlaylistFiles,
  plView,
  setPlView,
  openPlaylistView,
  refreshLastChange,
  setConfirmDeletePlaylist,
}: PlaylistsArgs) {
  const [plQuery, setPlQuery] = useState<string>("");
  const [newPlaylistMode, setNewPlaylistMode] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>("");

  const shownPlaylistFiles = useMemo(() => {
    const q = plQuery.trim().toLowerCase();
    return q ? playlistFiles.filter((p) => p.name.toLowerCase().includes(q)) : playlistFiles;
  }, [playlistFiles, plQuery]);

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

  async function addToPlaylist(name: string, tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return;
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
    } catch (err) {
      setStatus(`Add failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
  }

  async function removeFromPlaylist(name: string, tracks: Track[]) {
    const lib = folderRef.current;
    if (!lib || !name || tracks.length === 0) return;
    try {
      const pl = await invoke<PlaylistFile>("playlist_remove", {
        args: { libraryDir: lib, name, paths: tracks.map((t) => t.path) },
      });
      setPlaylistFiles((prev) => prev.map((p) => (p.name === pl.name ? pl : p)));
      setStatus(`Removed from ${pl.name}`);
    } catch (err) {
      setStatus(`Remove failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
  }

  async function createPlaylist(name: string) {
    const lib = folderRef.current;
    const clean = name.trim();
    if (!lib || !clean) return;
    try {
      const pl = await invoke<PlaylistFile>("playlist_create", { args: { libraryDir: lib, name: clean } });
      setPlaylistFiles((prev) =>
        prev.some((p) => p.name === pl.name)
          ? prev
          : [...prev, pl].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      );
      setNewPlaylistMode(false);
      setNewPlaylistName("");
      openPlaylistView(pl.name);
    } catch (err) {
      setStatus(`Create failed: ${String(err)}`);
    }
    await refreshLastChange(lib);
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
    plQuery,
    setPlQuery,
    newPlaylistMode,
    setNewPlaylistMode,
    newPlaylistName,
    setNewPlaylistName,
    shownPlaylistFiles,
    createPlaylistsFromFolders,
    addToPlaylist,
    removeFromPlaylist,
    createPlaylist,
    deletePlaylist,
  };
}
