// Startup: ask the host which platform this is, read every saved setting, then load the last
// imported library (on Android, the standard Music folder when none was chosen yet).
import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  KEY_DEV_MODE,
  KEY_DOWNLOAD_PLAYLISTS,
  KEY_DOWNLOAD_TARGET,
  KEY_FIXTURE_ROOT,
  KEY_LAST_SYNC,
  KEY_LIBRARY_DIR,
  KEY_SHARE_QUEUE,
  KEY_SORT,
  KEY_VOLUME,
  storePromise,
} from "../lib/store";
import { SORT_MODES } from "../lib/tracks";
import type { SortMode } from "../lib/tracks";
import type { PlaylistFile, QueuedLink, Setter, Track } from "../lib/types";

type StartupArgs = {
  setPlatform: Setter<string>;
  setStatus: Setter<string>;
  setDlTarget: Setter<string>;
  setDlPlaylists: Setter<string[]>;
  setSortMode: Setter<SortMode>;
  setLastSync: Setter<number>;
  setShareQueue: Setter<QueuedLink[]>;
  setVolume: Setter<number>;
  settingsLoadedRef: MutableRefObject<boolean>;
  setDevMode: Setter<boolean>;
  setFixtureRoot: Setter<string>;
  setFolder: Setter<string>;
  setAllTracks: Setter<Track[]>;
  setPlaylist: Setter<string>;
  setQuery: Setter<string>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  refreshLastChange: (lib?: string) => Promise<void>;
};

export function useStartup({
  setPlatform,
  setStatus,
  setDlTarget,
  setDlPlaylists,
  setSortMode,
  setLastSync,
  setShareQueue,
  setVolume,
  settingsLoadedRef,
  setDevMode,
  setFixtureRoot,
  setFolder,
  setAllTracks,
  setPlaylist,
  setQuery,
  loadPlaylists,
  refreshLastChange,
}: StartupArgs) {
  // Auto-load last imported library on startup
  useEffect(() => {
    (async () => {
      try {
        const store = await storePromise;

        let os = "";
        try {
          os = await invoke<string>("platform");
          setPlatform(os);
        } catch {
          /* older backend */
        }

        const savedTarget = await store.get<string>(KEY_DOWNLOAD_TARGET);
        if (savedTarget && typeof savedTarget === "string") setDlTarget(savedTarget);

        const savedDlPl = await store.get<string[]>(KEY_DOWNLOAD_PLAYLISTS);
        if (Array.isArray(savedDlPl)) setDlPlaylists(savedDlPl.filter((x) => typeof x === "string"));

        const savedSort = await store.get<string>(KEY_SORT);
        if (savedSort && (SORT_MODES as readonly string[]).includes(savedSort)) setSortMode(savedSort as SortMode);

        const savedSync = await store.get<number>(KEY_LAST_SYNC);
        if (typeof savedSync === "number") setLastSync(savedSync);
        const savedQueue = await store.get<QueuedLink[]>(KEY_SHARE_QUEUE);
        if (Array.isArray(savedQueue)) setShareQueue(savedQueue.filter((q) => q && typeof q.url === "string"));

        const savedVolume = await store.get<number>(KEY_VOLUME);
        if (typeof savedVolume === "number" && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
        settingsLoadedRef.current = true;

        if ((await store.get<boolean>(KEY_DEV_MODE)) === true) setDevMode(true);
        const savedFixtureRoot = await store.get<string>(KEY_FIXTURE_ROOT);
        if (typeof savedFixtureRoot === "string") setFixtureRoot(savedFixtureRoot);

        let saved = await store.get<string>(KEY_LIBRARY_DIR);
        // Android: no folder picker (it returns content URIs, not paths), so start from the standard Music folder.
        if ((!saved || typeof saved !== "string") && os === "android") {
          saved = "/storage/emulated/0/Music";
          await store.set(KEY_LIBRARY_DIR, saved);
          await store.save();
        }
        if (!saved || typeof saved !== "string") return;

        setFolder(saved);
        setStatus("Scanning…");

        const found = await invoke<Track[]>("scan_music_folder", { dir: saved });

        setAllTracks(found);
        setPlaylist("(all)");
        setQuery("");
        setStatus(`Found ${found.length} tracks`);
        await loadPlaylists(saved);
        await refreshLastChange(saved);
      } catch (err) {
        setStatus(`Auto-load failed: ${String(err)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
