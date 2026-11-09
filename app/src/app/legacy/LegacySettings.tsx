// The settings sheet's content until Settings is rebuilt: the old controls, unchanged, inside a
// `.legacy` box (the old stylesheet only applies there; scopeCss.ts). On a phone: the old top bar's
// status line (seven taps show the developer rows) and the old settings panel. On a PC: the old top
// bar (Import, Rescan, Undo, status), the developer row, the folder line, the download bar and the
// log. Which set shows follows the host, as it did before the rebuild.
import { shownFolder } from "../../testLibrary";
import { DownloadBar } from "../../features/ingest/DownloadBar";
import { LogPanel } from "../../features/log/LogPanel";
import { DevControls } from "../../features/settings/DevControls";
import { PhoneSettings } from "../../features/settings/PhoneSettings";
import { TopBar } from "../../features/settings/TopBar";
import { useApp } from "../context";

export function LegacySettings() {
  const { isMobile, status, lib, log, dl, proton, edits, dev, phone } = useApp();
  return (
    <div className={`legacy legacySettings${isMobile ? " mobile" : ""}`}>
      <TopBar isMobile={isMobile} status={status} lib={lib} edits={edits} dev={dev} phone={phone} />
      {isMobile ? (
        <PhoneSettings lib={lib} log={log} dl={dl} proton={proton} edits={edits} dev={dev} />
      ) : (
        <>
          {dev.devMode && (
            <div className="devBar">
              <DevControls lib={lib} dev={dev} dlBusy={dl.dlBusy} protonBusy={proton.protonBusy} undoBusy={edits.undoBusy} />
            </div>
          )}
          <div className="pathLine">{lib.folder ? `Folder: ${shownFolder(lib.folder, lib.fixtureRoot)}` : "Pick a folder to begin."}</div>
          <DownloadBar dl={dl} log={log} playlistFiles={lib.playlistFiles} />
          {log.dlLogs && <LogPanel text={log.dlLogs} />}
        </>
      )}
    </div>
  );
}
