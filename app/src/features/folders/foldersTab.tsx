// The Folders tab: where the files are stored, filtered, each folder openable and shuffle-playable.
import type { BrowseTabArgs } from "../library/browseTypes";

export function renderFoldersTab({ lib, player, goTracks }: BrowseTabArgs) {
  const { playlistQuery, setPlaylistQuery, shownPlaylists, artistView, setArtistView, plView, setPlView, playlist, setPlaylist } = lib;
  return (
    <>
      <div className="searchRow">
        <input
          className="search"
          placeholder="Filter folders…"
          value={playlistQuery}
          onChange={(e) => setPlaylistQuery(e.target.value)}
        />
      </div>
      <div className="list">
        {shownPlaylists.map((p) => (
          <div
            key={p}
            className={`pill ${!artistView && !plView && p === playlist ? "active" : ""}`}
            onClick={() => {
              setArtistView("");
              setPlView("");
              setPlaylist(p);
              goTracks();
            }}
            onDoubleClick={() => player.shufflePlayFolder(p)}
            title="Click to open · double-click to shuffle-play"
          >
            {p}
          </div>
        ))}
      </div>
    </>
  );
}
