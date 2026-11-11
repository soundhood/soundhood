// Hidden developer section (brief §5.9 Tools): "Test library", "Run self-test", "Rebuild
// index", at the bottom of the settings sheet. Shown after 7 taps on the version row in Settings,
// About (phone; each tap within 1.5 s of the last) or Ctrl+Alt+Shift+D (desktop); the same gesture
// hides it again; remembered. Results are toasts, and the self-test and rebuild also log their lines.
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChangeSummary, RefreshReport, SelfTestReport } from "../coreIpc";
import { isTestLibrary } from "../testLibrary";
import { KEY_DEV_MODE, KEY_FIXTURE_ROOT, KEY_LIBRARY_DIR, KEY_REAL_LIBRARY_DIR, storePromise } from "../lib/store";
import type { DevBusy, PlaylistFile, Setter, Track } from "../lib/types";
import type { Notices } from "./useNotices";

export type DevMode = ReturnType<typeof useDevMode>;

type DevModeArgs = {
  isMobile: boolean;
  notices: Notices;
  folderRef: MutableRefObject<string>;
  fixtureRoot: string;
  setFixtureRoot: Setter<string>;
  importFolderPath: (path: string) => Promise<void>;
  appendLog: (lines: string[]) => void;
  appendQuietLog: (lines: string[]) => void;
  // What closing the library resets.
  setFolder: Setter<string>;
  setAllTracks: Setter<Track[]>;
  setPlaylistFiles: Setter<PlaylistFile[]>;
  setSelectedPaths: Setter<Set<string>>;
  setPlaylist: Setter<string>;
  setPlView: Setter<string>;
  setArtistView: Setter<string>;
  setLastChange: Setter<ChangeSummary | null>;
  currentPathRef: MutableRefObject<string>;
  stopPlayer: () => void;
};

export function useDevMode({
  isMobile,
  notices,
  folderRef,
  fixtureRoot,
  setFixtureRoot,
  importFolderPath,
  appendLog,
  appendQuietLog,
  setFolder,
  setAllTracks,
  setPlaylistFiles,
  setSelectedPaths,
  setPlaylist,
  setPlView,
  setArtistView,
  setLastChange,
  currentPathRef,
  stopPlayer,
}: DevModeArgs) {
  const [devMode, setDevMode] = useState<boolean>(false);
  const devModeRef = useRef<boolean>(false);
  devModeRef.current = devMode;
  const [devBusy, setDevBusy] = useState<DevBusy>("");
  const versionTapsRef = useRef<{ n: number; at: number }>({ n: 0, at: 0 });
  const notify = notices.notify;

  async function toggleDevMode() {
    const next = !devModeRef.current;
    devModeRef.current = next;
    setDevMode(next);
    notify({ text: next ? "Developer tools on: at the bottom of Settings" : "Developer tools off" });
    try {
      const store = await storePromise;
      await store.set(KEY_DEV_MODE, next);
      await store.save();
    } catch { /* non-fatal: it still applies for this session */ }
  }

  // Seven taps in a row on the version row (Settings, About) on the phone, each within 1.5 s of the
  // previous one.
  function onVersionTap() {
    if (!isMobile) return;
    const now = Date.now();
    const taps = versionTapsRef.current;
    taps.n = now - taps.at < 1500 ? taps.n + 1 : 1;
    taps.at = now;
    if (taps.n >= 7) {
      taps.n = 0;
      toggleDevMode();
    }
  }

  // "Test library": on = remember the real library and point the app at the generated test
  // library (created by the host on first use); off = go back to the remembered library. The state
  // itself is never stored: it follows from the shown library being the fixture root.
  async function switchFixtureRoot(enable: boolean) {
    if (devBusy) return;
    setDevBusy("fixture");
    try {
      const store = await storePromise;
      if (enable) {
        const current = folderRef.current;
        const r = await invoke<{ root: string }>("dev_fixture_root", { enable: true });
        if (!r?.root) throw new Error("the host returned no fixture folder");
        await store.set(KEY_FIXTURE_ROOT, r.root);
        // Only a real library is remembered, never the test library itself.
        if (current && !isTestLibrary(current, r.root)) await store.set(KEY_REAL_LIBRARY_DIR, current);
        await store.save();
        setFixtureRoot(r.root);
        appendQuietLog(["[dev] test library on"]);
        await importFolderPath(r.root);
      } else {
        const saved = await store.get<string>(KEY_REAL_LIBRARY_DIR);
        const real = typeof saved === "string" && saved && !isTestLibrary(saved, fixtureRoot) ? saved : "";
        try {
          await invoke("dev_fixture_root", { enable: false });
        } catch { /* nothing to switch off on the host */ }
        await store.set(KEY_REAL_LIBRARY_DIR, "");
        await store.save();
        appendQuietLog(["[dev] test library off"]);
        if (real) await importFolderPath(real);
        else await closeLibrary("Test library off: choose your library folder again");
      }
    } catch (e) {
      notify({ text: `Test library: ${String(e).slice(0, 120)}` });
    }
    setDevBusy("");
  }

  /** No library shown (the test library was switched off and no real one is known). */
  async function closeLibrary(message: string) {
    if (currentPathRef.current) stopPlayer();
    setFolder("");
    setAllTracks([]);
    setPlaylistFiles([]);
    setSelectedPaths(new Set());
    setPlaylist("(all)");
    setPlView("");
    setArtistView("");
    setLastChange(null);
    notify({ text: message });
    try {
      const store = await storePromise;
      await store.set(KEY_LIBRARY_DIR, "");
      await store.save();
    } catch { /* non-fatal: the library is closed for this session */ }
  }

  async function runSelfTest() {
    if (devBusy) return;
    setDevBusy("selftest");
    try {
      const r = await invoke<SelfTestReport>("self_test");
      const summary = `Self-test: ${r.passed} passed, ${r.failed} failed`;
      appendLog([...(r.lines ?? []), summary]);
      notify({ text: summary });
    } catch (e) {
      appendLog([`[error] self-test: ${String(e)}`]);
      notify({ text: `Self-test failed: ${String(e).slice(0, 120)}` });
    }
    setDevBusy("");
  }

  async function rebuildIndex() {
    const lib = folderRef.current;
    if (devBusy || !lib) return;
    setDevBusy("rebuild");
    try {
      const r = await invoke<RefreshReport>("rebuild_index", { libraryDir: lib });
      const line = `Index rebuilt: ${r.total} tracks in ${(r.millis / 1000).toFixed(1)} s`;
      appendLog([`[index] ${line}`]);
      notify({ text: line });
    } catch (e) {
      appendLog([`[error] rebuild index: ${String(e)}`]);
      notify({ text: `Rebuild failed: ${String(e).slice(0, 120)}` });
    }
    setDevBusy("");
  }

  // Developer section (hidden): Ctrl+Alt+Shift+D on the desktop.
  const toggleDevModeRef = useRef(toggleDevMode);
  toggleDevModeRef.current = toggleDevMode;
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        toggleDevModeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMobile]);

  return { devMode, setDevMode, devBusy, onVersionTap, switchFixtureRoot, runSelfTest, rebuildIndex };
}
