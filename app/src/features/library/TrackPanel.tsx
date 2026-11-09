// The track panel: what is open (playlist, artist, folder or everything), the toolbar and the list.
import { ChevronIcon, TrashIcon } from "../../app/legacy/icons";
import type { Dialogs } from "../../hooks/useDialogs";
import type { Library } from "../../hooks/useLibrary";
import type { PhoneLayout } from "../../hooks/usePhoneLayout";
import type { Player } from "../../hooks/usePlayer";
import type { Playlists } from "../../hooks/usePlaylists";
import type { Selection } from "../../hooks/useSelection";
import type { TrackEdits } from "../../hooks/useTrackEdits";
import { TrackList } from "./TrackList";
import { TrackToolbar } from "./TrackToolbar";

export type TrackPanelProps = {
  isMobile: boolean;
  lib: Library;
  sel: Selection;
  player: Player;
  playlists: Playlists;
  dialogs: Dialogs;
  edits: TrackEdits;
  phone: PhoneLayout;
  targetOptions: string[];
};

export function TrackPanel(props: TrackPanelProps) {
  const { isMobile, lib, dialogs, phone } = props;
  const { plView, artistView, playlist, currentPlaylistFile } = lib;
  return (
    <div className="panel">
      <div className="panelHeader headerRow">
        {isMobile ? (
          <button className="iconBtn small" onClick={() => phone.setMScreen("browse")} title="Back"><ChevronIcon dir="left" size={16} /></button>
        ) : null}
        <span className="headerTitle">
          {plView ? (
            <>
              <span className="accentText">{plView}</span>
              <span className="dimText"> · playlist · {currentPlaylistFile?.entries.length ?? 0}</span>
            </>
          ) : artistView ? (
            <>
              Tracks · <span className="accentText">{artistView}</span>
              <span className="dimText"> · all folders</span>
            </>
          ) : playlist !== "(all)" ? (
            <>
              <span className="accentText">{playlist}</span>
              <span className="dimText"> · folder</span>
            </>
          ) : (
            "Tracks"
          )}
        </span>
        {plView ? (
          <button
            className="iconBtn danger small"
            title={`Delete the playlist "${plView}" (the songs stay)`}
            onClick={() => dialogs.setConfirmDeletePlaylist(plView)}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
      <TrackToolbar {...props} />
      <TrackList {...props} />
    </div>
  );
}
