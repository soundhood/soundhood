// The app shell: calls the hooks, hands each one what it needs from the others, and renders the
// feature views. The hooks are called in this order on purpose: React runs effects in call order,
// and effects that share state, listeners or settings keep the order they had when all of this
// was one component (see the notes at the calls).
import { useState } from "react";
import type { CSSProperties } from "react";
import { shownFolder } from "../testLibrary";
import { useDevMode } from "../hooks/useDevMode";
import { useDialogs } from "../hooks/useDialogs";
import { useDownloads, useYtdlpEvents } from "../hooks/useDownloads";
import { useLibrary } from "../hooks/useLibrary";
import { useCoreBatchLog, useLog } from "../hooks/useLog";
import { usePhoneLayout } from "../hooks/usePhoneLayout";
import { usePlayer } from "../hooks/usePlayer";
import { usePlaylists } from "../hooks/usePlaylists";
import { useProton } from "../hooks/useProton";
import { useSelection } from "../hooks/useSelection";
import { useStartup } from "../hooks/useStartup";
import { useTrackEdits } from "../hooks/useTrackEdits";
import { DeletePlaylistDialog } from "../features/dialogs/DeletePlaylistDialog";
import { DeleteTracksDialog } from "../features/dialogs/DeleteTracksDialog";
import { DownloadBar } from "../features/ingest/DownloadBar";
import { QueueDraftDialog } from "../features/ingest/QueueDraftDialog";
import { BrowsePanel } from "../features/library/BrowsePanel";
import { TrackPanel } from "../features/library/TrackPanel";
import { LogPanel } from "../features/log/LogPanel";
import { PhoneBottom } from "../features/player/PhoneBottom";
import { PhonePlayer } from "../features/player/PhonePlayer";
import { PlayerBar } from "../features/player/PlayerBar";
import { DevControls } from "../features/settings/DevControls";
import { PhoneSettings } from "../features/settings/PhoneSettings";
import { TopBar } from "../features/settings/TopBar";
import { EditTagsDialog } from "../features/tags/EditTagsDialog";
import { LEGACY_STYLES } from "./legacyStyles";

export default function App() {
  // "windows" | "linux" | "macos" | "android" | "ios" (from Rust). Phones: no folder picker, no Recycle Bin.
  const [platform, setPlatform] = useState<string>("");
  const isMobile = platform === "android" || platform === "ios";
  const [status, setStatus] = useState<string>("Idle");

  // Library first: its effect keeps folderRef current, which every later hook reads.
  const lib = useLibrary({ setStatus });
  const log = useLog({ folderRef: lib.folderRef, isMobile, platform, setStatus });
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
  const phone = usePhoneLayout({ isMobile, currentPath: player.currentPath });
  // The phone's plugin listeners stay in their old order: download progress here, Proton sync below.
  const dl = useDownloads({
    isMobile,
    setStatus,
    folder: lib.folder,
    folderRef: lib.folderRef,
    allTracks: lib.allTracks,
    setAllTracks: lib.setAllTracks,
    loadPlaylists: lib.loadPlaylists,
    refreshLastChange: lib.refreshLastChange,
    setDlLogs: log.setDlLogs,
    appendLog: log.appendLog,
    setMSettings: phone.setMSettings,
  });
  const playlists = usePlaylists({
    isMobile,
    setStatus,
    folderRef: lib.folderRef,
    playlistFiles: lib.playlistFiles,
    setPlaylistFiles: lib.setPlaylistFiles,
    plView: lib.plView,
    setPlView: lib.setPlView,
    openPlaylistView: lib.openPlaylistView,
    refreshLastChange: lib.refreshLastChange,
    setConfirmDeletePlaylist: dialogs.setConfirmDeletePlaylist,
  });
  const edits = useTrackEdits({
    isMobile,
    setStatus,
    folderRef: lib.folderRef,
    setAllTracks: lib.setAllTracks,
    loadPlaylists: lib.loadPlaylists,
    refreshLastChange: lib.refreshLastChange,
    lastChange: lib.lastChange,
    plView: lib.plView,
    setPlView: lib.setPlView,
    setSelectedPaths: sel.setSelectedPaths,
    appendLog: log.appendLog,
    currentPath: player.currentPath,
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
    setStatus,
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
    setStatus,
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
  });
  useYtdlpEvents({
    noteDlOutput: dl.noteDlOutput,
    setDlLogs: log.setDlLogs,
    lastDownloadRef: dl.lastDownloadRef,
    finishDownloadRef: dl.finishDownloadRef,
  });
  useCoreBatchLog(log.appendQuietLog);

  return (
    <div className={`app ${isMobile ? "mobile" : ""}`} style={{ "--mBottomH": `${phone.mBottomH}px` } as CSSProperties}>
      <audio ref={player.audioRef} preload="metadata" />
      <style>{LEGACY_STYLES}</style>

      <TopBar isMobile={isMobile} status={status} lib={lib} edits={edits} dev={dev} phone={phone} />

      {dev.devMode && !isMobile ? (
        <div className="devBar">
          <DevControls lib={lib} dev={dev} dlBusy={dl.dlBusy} protonBusy={proton.protonBusy} undoBusy={edits.undoBusy} />
        </div>
      ) : null}

      {isMobile && phone.mSettings ? <PhoneSettings lib={lib} log={log} dl={dl} proton={proton} edits={edits} dev={dev} /> : null}

      <div className="pathLine">
        {lib.folder ? `Folder: ${shownFolder(lib.folder, lib.fixtureRoot)}` : "Pick a folder to begin."}
      </div>

      {!isMobile ? <DownloadBar dl={dl} log={log} playlistFiles={lib.playlistFiles} /> : null}

      {log.dlLogs && !isMobile ? <LogPanel text={log.dlLogs} /> : null}

      <div className="content">
        {!isMobile || phone.mScreen === "browse" ? (
          <BrowsePanel isMobile={isMobile} lib={lib} playlists={playlists} player={player} goTracks={phone.goTracks} />
        ) : null}

        {!isMobile || phone.mScreen === "tracks" ? (
          <TrackPanel
            isMobile={isMobile}
            lib={lib}
            sel={sel}
            player={player}
            playlists={playlists}
            dialogs={dialogs}
            edits={edits}
            phone={phone}
            targetOptions={dl.targetOptions}
          />
        ) : null}
      </div>

      {!isMobile ? <PlayerBar lib={lib} player={player} playlists={playlists} /> : null}

      {isMobile ? <PhoneBottom lib={lib} player={player} phone={phone} /> : null}

      {isMobile && phone.mScreen === "player" ? <PhonePlayer lib={lib} player={player} playlists={playlists} phone={phone} /> : null}

      {dl.queueDraft ? <QueueDraftDialog dl={dl} queueDraft={dl.queueDraft} playlistFiles={lib.playlistFiles} /> : null}

      {dialogs.editTags ? <EditTagsDialog editTags={dialogs.editTags} dialogs={dialogs} edits={edits} /> : null}

      {dialogs.confirmDeletePlaylist ? (
        <DeletePlaylistDialog isMobile={isMobile} name={dialogs.confirmDeletePlaylist} dialogs={dialogs} playlists={playlists} />
      ) : null}

      {dialogs.confirmDelete ? <DeleteTracksDialog isMobile={isMobile} tracks={dialogs.confirmDelete} dialogs={dialogs} edits={edits} /> : null}
    </div>
  );
}
