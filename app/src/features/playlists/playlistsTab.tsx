// The Playlists tab: filter or new-playlist field, the "create from folders" box when there are no
// playlist files yet, "(all)" and every playlist file with its count.
import type { BrowseTabArgs } from "../library/browseTypes";

export function renderPlaylistsTab({ isMobile, lib, playlists, player, goTracks }: BrowseTabArgs) {
  const { folder, playlistFiles, plView, setPlView, artistView, setArtistView, playlist, setPlaylist, openPlaylistView } = lib;
  const { newPlaylistMode, setNewPlaylistMode, newPlaylistName, setNewPlaylistName, plQuery, setPlQuery, shownPlaylistFiles } = playlists;
  return (
    <>
      <div className="searchRow">
        {newPlaylistMode ? (
          <>
            <input
              className="search"
              placeholder="New playlist name…"
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") playlists.createPlaylist(newPlaylistName);
                if (e.key === "Escape") setNewPlaylistMode(false);
              }}
            />
            <button className="btn" onClick={() => playlists.createPlaylist(newPlaylistName)} disabled={!newPlaylistName.trim()}>OK</button>
          </>
        ) : (
          <>
            <input
              className="search"
              placeholder="Filter playlists…"
              value={plQuery}
              onChange={(e) => setPlQuery(e.target.value)}
            />
            <button className="btn" title="New playlist" onClick={() => setNewPlaylistMode(true)} disabled={!folder}>+</button>
          </>
        )}
      </div>
      <div className="list">
        {playlistFiles.length === 0 && folder ? (
          <div className="migrateBox">
            <div className="modalTrack">No playlist files yet</div>
            <div className="modalHint" style={{ margin: "6px 0 10px" }}>
              Playlists now live as small <code>.m3u8</code> files in <code>{folder}\_Playlists</code>, so a song can be in several at once.
              Create one per existing folder to start from what you have. Nothing moves on disk.
            </div>
            <button className="btn primaryBtn" onClick={playlists.createPlaylistsFromFolders}>Create playlists from folders</button>
          </div>
        ) : null}
        <div
          className={`pill ${!plView && !artistView && playlist === "(all)" ? "active" : ""}`}
          onClick={() => { setPlView(""); setArtistView(""); setPlaylist("(all)"); goTracks(); }}
          onDoubleClick={() => player.shufflePlayFolder("(all)")}
          title="Everything · double-click to shuffle-play the whole library"
        >
          (all)
        </div>
        {shownPlaylistFiles.map((p) => (
          <div
            key={p.name}
            className={`pill artistPill ${p.name === plView ? "active" : ""}`}
            onClick={() => { if (isMobile) { openPlaylistView(p.name); goTracks(); } else if (plView === p.name) setPlView(""); else openPlaylistView(p.name); }}
            onDoubleClick={() => player.shufflePlayPlaylist(p.name)}
            title="Click to open · double-click to shuffle-play"
          >
            <span className="artistName">{p.name}</span>
            <span className="artistCount">{p.entries.length}</span>
          </div>
        ))}
      </div>
    </>
  );
}
