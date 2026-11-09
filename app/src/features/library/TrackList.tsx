// The track list. Desktop: click selects, Ctrl/Shift extend, double-click plays. Phone: a tap
// plays, or ticks the row in Select mode.
import { displayName } from "../../lib/tracks";
import type { TrackPanelProps } from "./TrackPanel";

export function TrackList({ isMobile, lib, sel, player, phone }: TrackPanelProps) {
  const { filteredTracks } = lib;
  const { selectedPaths } = sel;
  const { currentPath } = player;
  const { mSelectMode } = phone;
  return (
    <div className="list">
      {filteredTracks.map((t) => (
        <div
          key={t.path}
          className={`trackRow ${t.path === currentPath ? "active" : ""} ${selectedPaths.has(t.path) ? "selected" : ""}`}
          onClick={(e) => { if (!isMobile) sel.onRowClick(e, t); else if (mSelectMode) sel.toggleRow(t); else player.loadAndPlay(t); }}
          onDoubleClick={() => { if (!isMobile) player.loadAndPlay(t); }}
          title={isMobile ? undefined : "Click to select · Ctrl+click adds · Shift+click ranges · double-click plays"}
        >
          {isMobile && mSelectMode ? <span className={`rowTick ${selectedPaths.has(t.path) ? "on" : ""}`}>{selectedPaths.has(t.path) ? "✓" : ""}</span> : null}
          <span className="rowMain">
            {displayName(t.name)}
            {isMobile && t.artist ? <div className="rowSub">{t.artist}</div> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
