// The top bar: brand, Import / settings gear, Rescan and Undo (desktop), the test-library note and
// the status pill (seven taps on the phone open the developer section).
import { GearIcon } from "../../app/legacy/icons";
import type { DevMode } from "../../hooks/useDevMode";
import type { Library } from "../../hooks/useLibrary";
import type { PhoneLayout } from "../../hooks/usePhoneLayout";
import type { TrackEdits } from "../../hooks/useTrackEdits";

type TopBarProps = {
  isMobile: boolean;
  status: string;
  lib: Library;
  edits: TrackEdits;
  dev: DevMode;
  phone: PhoneLayout;
};

export function TopBar({ isMobile, status, lib, edits, dev, phone }: TopBarProps) {
  const { folder, fixtureOn, lastChange } = lib;
  const { undoBusy } = edits;
  const { mSettings, setMSettings } = phone;
  return (
    <div className="topbar">
      <div className="brand">
        <div>Soundhood</div>
        {isMobile ? (
          <button className={`iconBtn ${mSettings ? "primaryBtn" : ""}`} onClick={() => setMSettings((v) => !v)} title="Library folder · rescan">
            <GearIcon />
          </button>
        ) : (
          <button className="btn" onClick={lib.importFolder}>Import</button>
        )}
        {folder && !isMobile ? (
          <button className="btn" onClick={lib.rescanLibrary} title="Re-read the Music folder">
            Rescan
          </button>
        ) : null}
        {folder && !isMobile ? (
          <button
            className="btn"
            onClick={edits.undoLast}
            disabled={!lastChange || undoBusy}
            title={lastChange ? `Undo: ${lastChange.label}` : "Nothing to undo"}
          >
            {undoBusy ? "Undoing…" : "Undo"}
          </button>
        ) : null}
        {fixtureOn ? (
          <span
            className="modalHint testLibraryNote"
            title="The app shows the generated test library, not your music. Switch it off under Developer."
          >
            Test library
          </span>
        ) : null}
      </div>
      <div className="status" onClick={dev.onStatusTap}>{isMobile ? status : `Status: ${status}`}</div>
    </div>
  );
}
