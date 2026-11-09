// The desktop download bar: the link, the folder it lands in (or a new one), the playlists it
// joins, Download, Copy log / Clear logs and running the links queue.
import { Dropdown, MultiDropdown } from "../../app/legacy/Dropdown";
import { NEW_FOLDER_SENTINEL } from "../../lib/store";
import type { PlaylistFile } from "../../lib/types";
import type { Downloads } from "../../hooks/useDownloads";
import type { Log } from "../../hooks/useLog";

type DownloadBarProps = {
  dl: Downloads;
  log: Log;
  playlistFiles: PlaylistFile[];
};

export function DownloadBar({ dl, log, playlistFiles }: DownloadBarProps) {
  const { downloadUrl, setDownloadUrl, newFolderMode, setNewFolderMode, newFolderName, setNewFolderName, dlTarget, targetOptions, dlPlaylists, dlBusy, shareQueue } = dl;
  const { dlLogs } = log;
  return (
    <div className="downloadBar">
      <input
        className="downloadInput"
        placeholder="Paste a YouTube URL and hit Download…"
        value={downloadUrl}
        onChange={(e) => setDownloadUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") dl.startManualDownload();
        }}
      />
      <span className="targetLabel">into</span>
      {newFolderMode ? (
        <>
          <input
            className="downloadInput targetNew"
            placeholder="New playlist folder…"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") dl.chooseTarget(newFolderName);
              if (e.key === "Escape") setNewFolderMode(false);
            }}
          />
          <button className="btn" onClick={() => dl.chooseTarget(newFolderName)} disabled={!newFolderName.trim()}>
            OK
          </button>
        </>
      ) : (
        <Dropdown
          value={dlTarget}
          options={targetOptions}
          title="Playlist folder the download lands in"
          extra={{ label: "+ New folder…", value: NEW_FOLDER_SENTINEL }}
          onSelect={(v) => {
            if (v === NEW_FOLDER_SENTINEL) setNewFolderMode(true);
            else dl.chooseTarget(v);
          }}
        />
      )}
      <span className="targetLabel">+ playlists</span>
      <MultiDropdown
        values={dlPlaylists}
        options={playlistFiles.map((p) => p.name)}
        onChange={dl.chooseDlPlaylists}
        placeholder="none"
        title="Playlists the downloaded track is added to (remembered)"
      />
      <button className="btn" onClick={dl.startManualDownload} disabled={dlBusy || !downloadUrl.trim()}>
        {dlBusy ? "Downloading…" : "Download"}
      </button>
      {dlLogs ? (
        <button className="btn" onClick={log.copyLog} title="Copy the whole log to the clipboard, with the app and device details on top">
          Copy log
        </button>
      ) : null}
      <button className="btn" onClick={log.clearLog} disabled={!dlLogs}>
        Clear logs
      </button>
      {shareQueue.length ? (
        <button className="btn primaryBtn" onClick={dl.runQueue} disabled={dlBusy} title="Download every queued link (shared from the phone), each into its chosen folder and playlists">
          Download queue ({shareQueue.length})
        </button>
      ) : null}
    </div>
  );
}
