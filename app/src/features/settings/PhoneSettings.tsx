// The phone's settings sheet: library folder, Undo last change, adding a link, Proton Drive, the
// download in flight, the log, the yt-dlp tools, the links waiting and the developer rows.
import { shownFolder } from "../../testLibrary";
import type { DevMode } from "../../hooks/useDevMode";
import type { Downloads } from "../../hooks/useDownloads";
import type { Library } from "../../hooks/useLibrary";
import type { Log } from "../../hooks/useLog";
import type { Proton } from "../../hooks/useProton";
import type { TrackEdits } from "../../hooks/useTrackEdits";
import { LinksWaiting } from "../ingest/LinksWaiting";
import { PhoneLogPanel } from "../log/LogPanel";
import { ProtonBox } from "../sync/ProtonBox";
import { DevControls } from "./DevControls";

type PhoneSettingsProps = {
  lib: Library;
  log: Log;
  dl: Downloads;
  proton: Proton;
  edits: TrackEdits;
  dev: DevMode;
};

export function PhoneSettings({ lib, log, dl, proton, edits, dev }: PhoneSettingsProps) {
  const { folder, fixtureRoot, fixtureOn, pathInput, setPathInput, lastChange } = lib;
  const { dlLogs } = log;
  const { dlBusy, dlProgress, dlSeconds, queueInput, setQueueInput, shareQueue } = dl;
  const { protonBusy, ytdlpBusy, ytdlpVersion } = proton;
  const { undoBusy } = edits;
  return (
    <div className="mSettings">
      <div className="mFolder">{folder ? `Library: ${shownFolder(folder, fixtureRoot)}` : "Type the folder that holds your music, then tap Use."}</div>
      <input
        className="downloadInput"
        placeholder="/storage/emulated/0/Music"
        value={pathInput}
        onChange={(e) => setPathInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") lib.importFolderPath(pathInput); }}
      />
      <button className="btn" onClick={() => lib.importFolderPath(pathInput)} disabled={!pathInput.trim()}>Use</button>
      {folder ? <button className="btn" onClick={lib.rescanLibrary} title="Re-read the Music folder">Rescan</button> : null}
      {folder ? (
        <div className="queueAdd">
          <button
            className="btn"
            onClick={edits.undoLast}
            disabled={!lastChange || undoBusy || dlBusy || protonBusy !== ""}
            title="Reverse the last tag edit, move, delete or playlist change"
          >
            {undoBusy ? "Undoing…" : "Undo last change"}
          </button>
          <span className="modalHint" style={{ marginTop: 0 }}>
            {lastChange ? lastChange.label : "Nothing to undo"}
          </span>
        </div>
      ) : null}
      <div className="queueAdd">
        <input
          className="downloadInput"
          placeholder="Paste a YouTube link…"
          inputMode="url"
          value={queueInput}
          onChange={(e) => setQueueInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") dl.addQueueInput(); }}
        />
        <button className="btn" onClick={dl.addQueueInput} disabled={!queueInput.trim()}>Add</button>
        <button className="btn" onClick={dl.pasteLink} title="Read the link from the clipboard">Paste</button>
      </div>
      <ProtonBox proton={proton} dlBusy={dlBusy} fixtureOn={fixtureOn} />
      {dlBusy ? (
        <div className="queueBox">
          <div className="queueTitle headerRow">
            <span>Downloading… {dlProgress >= 0 ? `${Math.round(dlProgress)}%` : ""} <span className="tabCount">{dlSeconds}s</span></span>
            <button className="btn" onClick={dl.cancelPhoneDownload}>Cancel</button>
          </div>
          <div className="miniProgress"><div style={{ width: `${dlProgress >= 0 ? dlProgress : 0}%` }} /></div>
        </div>
      ) : null}
      {dlLogs ? <PhoneLogPanel text={dlLogs} /> : null}
      <div className="queueAdd">
        <button className="btn" onClick={proton.updateYtdlp} disabled={ytdlpBusy || dlBusy} title="Fetch the newest yt-dlp inside the app (YouTube changes often)">
          {ytdlpBusy ? "Updating…" : "Update yt-dlp"}
        </button>
        {ytdlpVersion ? <span className="modalHint" style={{ marginTop: 0 }}>yt-dlp {ytdlpVersion}</span> : null}
        <button className="btn" onClick={proton.netcheck} disabled={ytdlpBusy || dlBusy} title="Can the bundled python reach YouTube? (DNS, TCP, HTTPS)">Network check</button>
        {shareQueue.length ? (
          <button className="btn primaryBtn" onClick={dl.runQueue} disabled={dlBusy}>Download queue ({shareQueue.length})</button>
        ) : null}
        {dlLogs ? <button className="btn" onClick={log.copyLog} title="Copy the whole log to the clipboard">Copy log</button> : null}
        {dlLogs ? <button className="btn" onClick={log.clearLog}>Clear log</button> : null}
      </div>
      {shareQueue.length ? <LinksWaiting dl={dl} /> : null}
      {dev.devMode ? <div className="queueAdd"><DevControls lib={lib} dev={dev} dlBusy={dlBusy} protonBusy={protonBusy} undoBusy={undoBusy} /></div> : null}
    </div>
  );
}
