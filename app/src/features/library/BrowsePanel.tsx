// The browse panel: the Playlists / Artists / Folders tabs and the open tab's list.
import { renderArtistsTab } from "../artists/artistsTab";
import { renderFoldersTab } from "../folders/foldersTab";
import { renderPlaylistsTab } from "../playlists/playlistsTab";
import type { BrowseTabArgs } from "./browseTypes";

export function BrowsePanel(args: BrowseTabArgs) {
  const { sideTab, setSideTab, playlistFiles, artists } = args.lib;
  return (
    <div className="panel">
      <div className="panelHeader tabs">
        <button className={`tab ${sideTab === "playlists" ? "active" : ""}`} onClick={() => setSideTab("playlists")}>
          Playlists <span className="tabCount">{playlistFiles.length}</span>
        </button>
        <button className={`tab ${sideTab === "artists" ? "active" : ""}`} onClick={() => setSideTab("artists")}>
          Artists <span className="tabCount">{artists.length}</span>
        </button>
        <button className={`tab ${sideTab === "folders" ? "active" : ""}`} onClick={() => setSideTab("folders")} title="Where the files are stored">
          Folders
        </button>
      </div>

      {sideTab === "playlists" ? renderPlaylistsTab(args) : sideTab === "folders" ? renderFoldersTab(args) : renderArtistsTab(args)}
    </div>
  );
}
