// The library: its folder, its tracks and playlist files, what the browse panel shows, the list of
// tracks that follows from it, scanning and importing, and the newest change that can be undone.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangeSummary } from "../coreIpc";
import { isTestLibrary } from "../testLibrary";
import { KEY_LIBRARY_DIR, KEY_SORT, storePromise } from "../lib/store";
import { UNTAGGED, relKey, sortTracks, splitArtists } from "../lib/tracks";
import type { SortMode } from "../lib/tracks";
import type { PlaylistFile, Setter, Track } from "../lib/types";

export type Library = ReturnType<typeof useLibrary>;

export function useLibrary({ setStatus }: { setStatus: Setter<string> }) {
  const [folder, setFolder] = useState<string>("");
  // Phone settings: the library folder typed in by hand (a phone has no folder picker).
  const [pathInput, setPathInput] = useState<string>("");
  const [allTracks, setAllTracks] = useState<Track[]>([]);

  // What the track list shows: a folder ("(all)" = every track), an artist, or a playlist file.
  const [playlist, setPlaylist] = useState<string>("(all)");
  const [artistView, setArtistView] = useState<string>("");
  // The playlist file being viewed ("" = none). Exactly one of artistView / plView / folder is active.
  const [plView, setPlView] = useState<string>("");
  const [playlistFiles, setPlaylistFiles] = useState<PlaylistFile[]>([]);
  // Filters the open list (the search field while a list is open).
  const [query, setQuery] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("Natural order");

  // IMPORTANT: avoid duplicate ytdlp listeners in dev/hmr by using a ref for latest folder.
  // The same folder change also reloads the links queue; that half lives in useDownloads.
  const folderRef = useRef<string>("");
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  // The fixture root the host returned (remembered); the test library is shown when the current
  // library is that folder.
  const [fixtureRoot, setFixtureRoot] = useState<string>("");
  const fixtureOn = isTestLibrary(folder, fixtureRoot);

  // "Undo last change": the newest change on this device that can still be undone (from the
  // journal), re-read after every command that writes, after a rescan and after an undo.
  const [lastChange, setLastChange] = useState<ChangeSummary | null>(null);
  const lastChangeSeqRef = useRef<number>(0);
  async function refreshLastChange(lib: string = folderRef.current) {
    const seq = ++lastChangeSeqRef.current; // only the newest answer counts
    if (!lib) { setLastChange(null); return; }
    try {
      const c = await invoke<ChangeSummary | null>("last_change", { libraryDir: lib });
      if (seq === lastChangeSeqRef.current) setLastChange(c ?? null);
    } catch {
      if (seq === lastChangeSeqRef.current) setLastChange(null);
    }
  }

  const playlists = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTracks) set.add(t.playlist || "(root)");
    const arr = Array.from(set);
    arr.sort((a, b) => a.localeCompare(b));
    return ["(all)", ...arr.filter((x) => x !== "(all)")];
  }, [allTracks]);

  // Artist index: every artist named in a tag (collaborations count under each name) → track count.
  const artists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTracks) {
      for (const a of splitArtists(t.artist)) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === UNTAGGED) return 1; // always last
        if (b.name === UNTAGGED) return -1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [allTracks]);

  // Tracks by their playlist-file key, for resolving m3u8 entries.
  const tracksByKey = useMemo(() => {
    const m = new Map<string, Track>();
    const root = folder;
    if (!root) return m;
    for (const t of allTracks) m.set(relKey(root, t.path).toLowerCase(), t);
    return m;
  }, [allTracks, folder]);

  const currentPlaylistFile = useMemo(
    () => (plView ? playlistFiles.find((p) => p.name === plView) ?? null : null),
    [playlistFiles, plView]
  );

  const filteredTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: Track) => !q || t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);

    if (plView) {
      // playlist FILE: entries in their own order; entries whose file is gone are skipped
      const pl = currentPlaylistFile;
      if (!pl) return [];
      const out: Track[] = [];
      for (const e of pl.entries) {
        const t = tracksByKey.get(e.toLowerCase());
        if (t && matches(t)) out.push(t);
      }
      return sortTracks(out, sortMode);
    }
    const out = allTracks.filter((t) => {
      if (artistView) {
        // virtual playlist: every track by this artist, whatever folder it lives in
        if (!splitArtists(t.artist).includes(artistView)) return false;
      } else if (playlist !== "(all)" && (t.playlist || "(root)") !== playlist) {
        return false;
      }
      return matches(t);
    });
    return sortTracks(out, sortMode);
  }, [allTracks, playlist, artistView, plView, currentPlaylistFile, tracksByKey, query, sortMode]);

  async function chooseSort(mode: SortMode) {
    setSortMode(mode);
    try {
      const store = await storePromise;
      await store.set(KEY_SORT, mode);
      await store.save();
    } catch {
      /* non-fatal */
    }
  }

  // Is the selected track already in a given playlist file?
  function inPlaylist(pl: PlaylistFile, t: Track) {
    const k = relKey(folder, t.path).toLowerCase();
    return pl.entries.some((e) => e.toLowerCase() === k);
  }

  async function loadPlaylists(lib: string): Promise<PlaylistFile[] | null> {
    try {
      const pls = await invoke<PlaylistFile[]>("list_playlists", { libraryDir: lib });
      setPlaylistFiles(pls);
      return pls;
    } catch (err) {
      setStatus(`Playlists: ${String(err)}`);
      return null;
    }
  }

  function openPlaylistView(name: string) {
    setArtistView("");
    setPlaylist("(all)");
    setPlView(name);
  }

  // Re-read the current Music folder (after renames/moves done outside the app).
  async function rescanLibrary() {
    const lib = folderRef.current;
    if (!lib) return;
    try {
      setStatus("Scanning…");
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(lib);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
    await refreshLastChange(lib);
  }

  // Mobile: type the folder path instead of picking it.
  async function importFolderPath(path: string) {
    const dir = path.trim();
    if (!dir) return;
    try {
      setFolder(dir);
      setStatus("Scanning…");
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, dir);
      await store.save();
      const found = await invoke<Track[]>("scan_music_folder", { dir });
      setAllTracks(found);
      setPlaylist("(all)");
      setPlView("");
      setArtistView("");
      setQuery("");
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(dir);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
    await refreshLastChange(dir);
  }

  async function importFolder() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked || typeof picked !== "string") return;

      setFolder(picked);
      setStatus("Scanning…");

      // persist selection
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, picked);
      await store.save();

      const found = await invoke<Track[]>("scan_music_folder", { dir: picked });

      setAllTracks(found);
      setPlaylist("(all)");
      setPlView("");
      setArtistView("");
      setQuery("");
      setStatus(`Found ${found.length} tracks`);
      await loadPlaylists(picked);
      await refreshLastChange(picked);
    } catch (err) {
      setStatus(`Scan error: ${String(err)}`);
    }
  }

  return {
    folder,
    setFolder,
    folderRef,
    pathInput,
    setPathInput,
    allTracks,
    setAllTracks,
    playlist,
    setPlaylist,
    artistView,
    setArtistView,
    plView,
    setPlView,
    playlistFiles,
    setPlaylistFiles,
    query,
    setQuery,
    sortMode,
    setSortMode,
    fixtureRoot,
    setFixtureRoot,
    fixtureOn,
    lastChange,
    setLastChange,
    refreshLastChange,
    artists,
    /** The storage folders, "(all)" first. */
    folders: playlists,
    tracksByKey,
    currentPlaylistFile,
    filteredTracks,
    chooseSort,
    inPlaylist,
    loadPlaylists,
    openPlaylistView,
    rescanLibrary,
    importFolderPath,
    importFolder,
  };
}
