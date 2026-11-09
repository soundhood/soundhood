// The track toolbar: search, sort, the selection's actions (add to / remove from a playlist, move
// files, edit tags, delete), the phone's Select mode and shuffle.
import { Dropdown } from "../../app/legacy/Dropdown";
import { PencilIcon, ShuffleIcon, TrashIcon } from "../../app/legacy/icons";
import { NEW_PLAYLIST_SENTINEL, SORT_MODES, displayName } from "../../lib/tracks";
import type { SortMode } from "../../lib/tracks";
import type { TrackPanelProps } from "./TrackPanel";

export function TrackToolbar({ isMobile, lib, sel, player, playlists, dialogs, edits, phone, targetOptions }: TrackPanelProps) {
  const { query, setQuery, sortMode, playlistFiles, inPlaylist, plView, currentPlaylistFile, sideTab, setSideTab } = lib;
  const { selectedTracks, selectedTrack, setSelectedPaths } = sel;
  const { shuffle, setShuffle } = player;
  const { mSelectMode, setMSelectMode } = phone;
  return (
    <div className="searchRow">
      <input
        className="search"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Dropdown
        className="sortDd"
        value={sortMode}
        options={[...SORT_MODES]}
        title="Sort the track list"
        onSelect={(v) => lib.chooseSort(v as SortMode)}
      />
      {selectedTracks.length > 1 ? (
        <span className="selCount" title="Esc clears the selection">
          {selectedTracks.length} selected
          <button className="linkBtn" onClick={() => setSelectedPaths(new Set())}>clear</button>
        </span>
      ) : null}
      {selectedTracks.length > 0 ? (
        <Dropdown
          value=""
          placeholder={selectedTracks.length > 1 ? `Add ${selectedTracks.length} to playlist…` : "Add to playlist…"}
          title="Add the selected track(s) to a playlist"
          options={playlistFiles
            .filter((p) => !selectedTracks.every((t) => inPlaylist(p, t)))
            .map((p) => p.name)}
          extra={{ label: "+ New playlist…", value: NEW_PLAYLIST_SENTINEL }}
          onSelect={(v) => {
            if (v === NEW_PLAYLIST_SENTINEL) {
              setSideTab("playlists");
              playlists.setNewPlaylistMode(true);
            } else playlists.addToPlaylist(v, selectedTracks);
          }}
        />
      ) : null}
      {selectedTracks.length > 0 && plView && currentPlaylistFile && selectedTracks.some((t) => inPlaylist(currentPlaylistFile, t)) ? (
        <button
          className="btn"
          title={`Remove the selected track(s) from ${plView} (the files stay)`}
          onClick={() => playlists.removeFromPlaylist(plView, selectedTracks)}
        >
          Remove{selectedTracks.length > 1 ? ` ${selectedTracks.length}` : ""} from playlist
        </button>
      ) : null}
      {selectedTracks.length > 0 && sideTab === "folders" ? (
        <Dropdown
          value=""
          placeholder={selectedTracks.length > 1 ? `Move ${selectedTracks.length} files to…` : "Move file to…"}
          title="Move the selected file(s) to another folder (playlists follow)"
          options={targetOptions.filter((name) => !selectedTracks.every((t) => (t.playlist || "(root)") === name))}
          onSelect={(target) => edits.moveTracksTo(selectedTracks, target)}
        />
      ) : null}
      {selectedTrack ? (
        <button
          className="iconBtn"
          title={`Edit the tags of "${displayName(selectedTrack.name)}"`}
          onClick={() => edits.openTagEditor(selectedTrack)}
        >
          <PencilIcon />
        </button>
      ) : null}
      {selectedTracks.length > 0 ? (
        <button
          className="iconBtn danger"
          title={`${selectedTracks.length > 1 ? `Delete ${selectedTracks.length} tracks` : `Delete "${displayName(selectedTracks[0].name)}"`} (to ${isMobile ? "the bin" : "the Recycle Bin"}; Undo brings ${selectedTracks.length > 1 ? "them" : "it"} back)`}
          onClick={() => dialogs.setConfirmDelete(selectedTracks)}
        >
          <TrashIcon />
        </button>
      ) : null}
      {isMobile ? (
        <button
          className={`btn ${mSelectMode ? "primaryBtn" : ""}`}
          title="Tick songs instead of playing them"
          onClick={() => { if (mSelectMode) setSelectedPaths(new Set()); setMSelectMode((v) => !v); }}
        >
          {mSelectMode ? "Done" : "Select"}
        </button>
      ) : null}
      <button
        className={`shuffleBtn ${shuffle ? "on" : ""}`}
        onClick={() => setShuffle((s) => !s)}
        title={shuffle ? "Shuffle is on; click to play in order" : "Shuffle is off; click to shuffle"}
        aria-pressed={shuffle}
      >
        <ShuffleIcon on={shuffle} />
      </button>
    </div>
  );
}
