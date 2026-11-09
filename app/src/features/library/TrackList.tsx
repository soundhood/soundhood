// A list of songs (TrackRows in a VirtualList), scrolling with the main area. A tap or a click plays
// the song on every device; with a mouse, Ctrl+click and Shift+click select without playing; in
// Select mode a tap or click ticks the row (Shift+click ticks a range). Enter does what a click does.
import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { TrackRow, VirtualList, type VirtualRowProps } from "../../design";
import { useApp } from "../../app/context";
import { useCover } from "../../hooks/useCovers";
import type { Track } from "../../lib/types";
import { folderLabel, trackArtist, trackLength, trackTitle } from "./trackInfo";

export interface TrackListProps {
  tracks: readonly Track[];
  /** The list's name for assistive tech ("Songs in Late Night"). */
  label: string;
  /** The main area, which scrolls the list with the header above it. */
  scroller: RefObject<HTMLElement | null>;
  /** Rows can be selected (Ctrl+click, Shift+click, Select mode). */
  selectable?: boolean;
  /** Plays a song (a tap or click outside Select mode). */
  onPlay: (t: Track) => void;
}

function TrackItem({ t, row, check, onClick }: { t: Track; row: VirtualRowProps; check: boolean; onClick: (e: MouseEvent, t: Track) => void }) {
  const { player, sel } = useApp();
  const cover = useCover(t.path);
  const playing = t.path === player.currentPath;
  return (
    <TrackRow
      {...row}
      title={trackTitle(t)}
      artist={trackArtist(t)}
      duration={trackLength(t)}
      folder={folderLabel(t.playlist)}
      cover={cover?.url}
      playing={playing}
      paused={playing && !player.isPlaying}
      selected={sel.selectedPaths.has(t.path)}
      check={check}
      onClick={(e) => onClick(e, t)}
    />
  );
}

export function TrackList({ tracks, label, scroller, selectable, onPlay }: TrackListProps) {
  const { sel, phone } = useApp();
  const selectMode = !!selectable && phone.mSelectMode;

  const activate = (e: MouseEvent | KeyboardEvent, t: Track) => {
    if (selectMode) {
      if (e.shiftKey) sel.onRowClick(e as MouseEvent, t);
      else sel.toggleRow(t);
      return;
    }
    if (selectable && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      sel.onRowClick(e as MouseEvent, t);
      return;
    }
    if (sel.selectedPaths.size) sel.setSelectedPaths(new Set());
    onPlay(t);
  };

  return (
    <VirtualList
      items={tracks}
      getKey={(t) => t.path}
      label={label}
      multiselectable={selectable}
      scroller={scroller}
      onKeyDown={(e, i) => {
        if (e.key === "Enter" && tracks[i]) {
          e.preventDefault();
          activate(e, tracks[i]);
        }
      }}
      renderRow={(t, _i, row) => <TrackItem t={t} row={row} check={selectMode} onClick={activate} />}
    />
  );
}
