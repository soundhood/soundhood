// Startup: ask the host which platform this is, read every saved setting, decide whether the
// first-launch setup shows (the migration rule, usePrefs.decideOnboarding), then load the last
// imported library. Before Phase 1 a phone with no folder started on the standard Music folder;
// now the setup's Library step offers that folder instead.
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
import {
  EARLIER_KEYS,
  KEY_DOWNLOADER,
  KEY_HELPER_UPDATES,
  KEY_LOOKUPS,
  KEY_ONBOARDED,
  KEY_TEXT_SCALE,
  decideOnboarding,
  type Prefs,
} from "./usePrefs";

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
  prefs: Prefs;
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
  prefs,
}: StartupArgs) {
  // Auto-load last imported library on startup
  useEffect(() => {
    (async () => {
      try {
        const store = await storePromise;

        // Before anything is written: did the app run here before? (The migration rule.)
        let existing = false;
        for (const key of EARLIER_KEYS) {
          const v = await store.get<unknown>(key);
          if (v !== undefined && v !== null) existing = true;
        }

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

        const savedScale = await store.get<number>(KEY_TEXT_SCALE);
        const savedLookups = await store.get<boolean>(KEY_LOOKUPS);
        const savedHelper = await store.get<boolean>(KEY_HELPER_UPDATES);
        let savedDownloader = await store.get<boolean>(KEY_DOWNLOADER);
        // An existing install downloads exactly as before: the downloader is on, and stays on. A new
        // install starts with it off, stored at once, so a setup left half-way never reads as an
        // existing install's "on" later.
        if (typeof savedDownloader !== "boolean") {
          savedDownloader = existing;
          await store.set(KEY_DOWNLOADER, existing);
          await store.save();
        }
        prefs.load({
          textScale: typeof savedScale === "number" ? savedScale : undefined,
          downloader: savedDownloader === true,
          lookups: typeof savedLookups === "boolean" ? savedLookups : undefined,
          helperUpdates: typeof savedHelper === "boolean" ? savedHelper : undefined,
        });

        const saved = await store.get<string>(KEY_LIBRARY_DIR);
        const hasFolder = !!saved && typeof saved === "string";
        const steps = decideOnboarding({ done: (await store.get<boolean>(KEY_ONBOARDED)) === true, existing, hasFolder });
        if (steps.length) prefs.setOnboarding(steps);
        else if (existing) {
          // Nothing to ask on an existing install: never ask later either.
          await store.set(KEY_ONBOARDED, true);
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
