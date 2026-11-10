// The app: calls the hooks, hands each one what it needs from the others, and gives the screens all
// of it through AppContext; the shell (AppShell) draws them. The hooks are called in this order on
// purpose: React runs effects in call order, and effects that share state, listeners or settings keep
// the order they had when all of this was one component (see the notes at the calls).
import { useEffect, useMemo, useState } from "react";
import "../design/index.css";
import "./screens.css";
import { ToastProvider } from "../design";
import { useDevMode } from "../hooks/useDevMode";
import { useDialogs } from "../hooks/useDialogs";
import { useDownloads, useYtdlpEvents } from "../hooks/useDownloads";
import { useLibrary } from "../hooks/useLibrary";
import { useCoreBatchLog, useLog } from "../hooks/useLog";
import { useNavigation } from "../hooks/useNavigation";
import { useNotices } from "../hooks/useNotices";
import { usePhoneLayout } from "../hooks/usePhoneLayout";
import { usePlayer } from "../hooks/usePlayer";
import { usePlaylists } from "../hooks/usePlaylists";
import { usePrefs } from "../hooks/usePrefs";
import { useProton } from "../hooks/useProton";
import { useSelection } from "../hooks/useSelection";
import { useStartup } from "../hooks/useStartup";
import { useTrackEdits } from "../hooks/useTrackEdits";
import { forgetCovers } from "../lib/covers";
import type { Track } from "../lib/types";
import { AppShell } from "./AppShell";
import { AppContext, type AppActions, type AppContextValue, type Picker } from "./context";

export default function App() {
  return (
    <ToastProvider>
      <AppRoot />
    </ToastProvider>
  );
}

function AppRoot() {
  // "windows" | "linux" | "macos" | "android" | "ios" (from Rust). Phones: no folder picker, no Recycle Bin.
  // It decides what the host can do (Proton sync, the bin), never the layout: that is the shell's width.
  const [platform, setPlatform] = useState<string>("");
  const isMobile = platform === "android" || platform === "ios";
  // No status line: messages go to toasts, reports and the log (useNotices). The hooks that still
  // report in status lines get setStatus, which routes each line.
  const notices = useNotices();
  const setStatus = notices.setStatus;
  const prefs = usePrefs();

  // Library first: its effect keeps folderRef current, which every later hook reads.
  const lib = useLibrary({ setStatus });
  const log = useLog({ folderRef: lib.folderRef, isMobile, platform, notices });
  // The player's effects (volume, autoplay, audio listeners, cover, Media Session) keep their own order.
  const player = usePlayer({
    isMobile,
    setStatus,
    allTracks: lib.allTracks,
    filteredTracks: lib.filteredTracks,
    openPlaylistView: lib.openPlaylistView,
    setPlView: lib.setPlView,
    setPlaylist: lib.setPlaylist,
    setArtistView: lib.setArtistView,
  });
  // Document keydown listeners stay in their old order: selection (Ctrl+A, Escape), then the boxes
  // (Escape), then the developer shortcut in useDevMode.
  const sel = useSelection({ filteredTracks: lib.filteredTracks });
  const dialogs = useDialogs();
  const phone = usePhoneLayout();
  // The phone's plugin listeners stay in their old order: download progress here, Proton sync below.
  const dl = useDownloads({
    isMobile,
    notices,
    downloader: prefs.downloader,
    openSettings: () => phone.setMSettings(true),
    folder: lib.folder,
    folderRef: lib.folderRef,
    allTracks: lib.allTracks,
    setAllTracks: lib.setAllTracks,
    loadPlaylists: lib.loadPlaylists,
    refreshLastChange: lib.refreshLastChange,
    setDlLogs: log.setDlLogs,
    appendLog: log.appendLog,
  });
  const playlists = usePlaylists({
    isMobile,
    setStatus,
    notices,
    folderRef: lib.folderRef,
    setPlaylistFiles: lib.setPlaylistFiles,
    plView: lib.plView,
    setPlView: lib.setPlView,
    openPlaylistView: lib.openPlaylistView,
    refreshLastChange: lib.refreshLastChange,
    setConfirmDeletePlaylist: dialogs.setConfirmDeletePlaylist,
  });
  const edits = useTrackEdits({
    isMobile,
    notices,
    folderRef: lib.folderRef,
    setAllTracks: lib.setAllTracks,
    loadPlaylists: lib.loadPlaylists,
    refreshLastChange: lib.refreshLastChange,
    plView: lib.plView,
    setPlView: lib.setPlView,
    setSelectedPaths: sel.setSelectedPaths,
    appendLog: log.appendLog,
    currentPathRef: player.currentPathRef,
    setCurrentPath: player.setCurrentPath,
    setCurrentPlaylist: player.setCurrentPlaylist,
    releasePlayingTrack: player.releasePlayingTrack,
    reloadHeldTrack: player.reloadHeldTrack,
    stopPlayer: player.stopPlayer,
    editTags: dialogs.editTags,
    setEditTags: dialogs.setEditTags,
    setConfirmDelete: dialogs.setConfirmDelete,
  });
  const proton = useProton({
    isMobile,
    mSettings: phone.mSettings,
    notices,
    folderRef: lib.folderRef,
    fixtureRoot: lib.fixtureRoot,
    setDlLogs: log.setDlLogs,
    setAllTracks: lib.setAllTracks,
    loadPlaylists: lib.loadPlaylists,
    loadQueueFromLibrary: dl.loadQueueFromLibrary,
    refreshLastChange: lib.refreshLastChange,
  });
  const dev = useDevMode({
    isMobile,
    notices,
    folderRef: lib.folderRef,
    fixtureRoot: lib.fixtureRoot,
    setFixtureRoot: lib.setFixtureRoot,
    importFolderPath: lib.importFolderPath,
    appendLog: log.appendLog,
    appendQuietLog: log.appendQuietLog,
    setFolder: lib.setFolder,
    setAllTracks: lib.setAllTracks,
    setPlaylistFiles: lib.setPlaylistFiles,
    setSelectedPaths: sel.setSelectedPaths,
    setPlaylist: lib.setPlaylist,
    setPlView: lib.setPlView,
    setArtistView: lib.setArtistView,
    setLastChange: lib.setLastChange,
    currentPathRef: player.currentPathRef,
    stopPlayer: player.stopPlayer,
  });
  // Startup reads the settings after the volume effect has run (it never writes before they are
  // read), and before the yt-dlp and core:batch listeners, as it always did.
  useStartup({
    setPlatform,
    setStatus,
    setDlTarget: dl.setDlTarget,
    setDlPlaylists: dl.setDlPlaylists,
    setSortMode: lib.setSortMode,
    setLastSync: proton.setLastSync,
    setShareQueue: dl.setShareQueue,
    setVolume: player.setVolume,
    settingsLoadedRef: player.settingsLoadedRef,
    setDevMode: dev.setDevMode,
    setFixtureRoot: lib.setFixtureRoot,
    setFolder: lib.setFolder,
    setAllTracks: lib.setAllTracks,
    setPlaylist: lib.setPlaylist,
    setQuery: lib.setQuery,
    loadPlaylists: lib.loadPlaylists,
    refreshLastChange: lib.refreshLastChange,
    prefs,
  });
  useYtdlpEvents({
    noteDlOutput: dl.noteDlOutput,
    setDlLogs: log.setDlLogs,
    lastDownloadRef: dl.lastDownloadRef,
    finishDownloadRef: dl.finishDownloadRef,
  });
  useCoreBatchLog(log.appendQuietLog);

  // Where the user is (tabs, the open list, Playing, search). A new list on screen ends the selection.
  const nav = useNavigation({
    lib,
    hasTrack: !!player.currentPath,
    onListChange: () => {
      sel.setSelectedPaths(new Set());
      phone.setMSelectMode(false);
    },
  });

  // Another library: the covers read from the old one go.
  useEffect(() => forgetCovers(), [lib.folder]);

  // The sheets the screens open (Overlays.tsx).
  const [picker, setPicker] = useState<Picker | null>(null);
  const openSettings = phone.setMSettings;
  const actions = useMemo<AppActions>(
    () => ({
      addToPlaylist: (tracks: Track[]) => tracks.length && setPicker({ kind: "add", tracks }),
      newPlaylist: (tracks: Track[] = []) => setPicker({ kind: "new", tracks }),
      moveToFolder: (tracks: Track[]) => tracks.length && setPicker({ kind: "move", tracks }),
      openSettings: () => openSettings(true),
    }),
    [openSettings],
  );

  const ctx: AppContextValue = { isMobile, lib, player, sel, dialogs, playlists, edits, dl, log, proton, dev, phone, nav, actions, notices, prefs };

  return (
    <AppContext.Provider value={ctx}>
      <audio ref={player.audioRef} preload="metadata" />
      <AppShell picker={picker} closePicker={() => setPicker(null)} />
    </AppContext.Provider>
  );
}
