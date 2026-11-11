// A list of songs (TrackRows in a VirtualList), scrolling with the main area. A tap or a click plays
// the song on every device; with a mouse, Ctrl+click and Shift+click select without playing; in
// Select mode a tap or click ticks the row (Shift+click ticks a range). Enter does what a click does,
// and plays the selection when there is one. Each row has a menu (RowMenu: the more button, the
// ContextMenu key, a right click), and with a mouse its song (or the selection it is part of) can
// be dragged onto a playlist in the sidebar (AppSidebar adds it there).
import { useCallback, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { TrackRow, VirtualList, type VirtualRowProps } from "../../design";
import { useApp } from "../../app/context";
import { useCover } from "../../hooks/useCovers";
import { libraryView } from "../../hooks/useNavigation";
import type { Track } from "../../lib/types";
import { usePlayActions } from "../player/usePlayActions";
import { RowMenu, type RowMenuState } from "./RowMenu";
import { SONGS_MIME, dragImageText } from "./songDrag";
import { folderLabel, trackArtist, trackLength, trackTitle } from "./trackInfo";
import "./rowMenu.css";

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

/** Dragging rows onto the sidebar is for a mouse or a pen; on touch a long press opens the menu. */
const canDrag = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

interface ItemProps {
  t: Track;
  row: VirtualRowProps;
  check: boolean;
  onClick: (e: MouseEvent, t: Track) => void;
  onMenu: (t: Track, state: Omit<RowMenuState, "track">) => void;
}

function TrackItem({ t, row, check, onClick, onMenu }: ItemProps) {
  const { player, sel } = useApp();
  const cover = useCover(t.path);
  const playing = t.path === player.currentPath;
  return (
    <TrackRow
      {...row}
      data-path={t.path}
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
      onMore={(e) => {
        const el = e.currentTarget as HTMLElement;
        const button = el.matches("button") ? el : el.querySelector<HTMLElement>(".IconButton");
        onMenu(t, { anchor: { rect: (button ?? el).getBoundingClientRect() }, from: el.closest<HTMLElement>("[data-index]") });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(t, { anchor: { x: e.clientX, y: e.clientY }, from: e.currentTarget });
      }}
      draggable={!check && canDrag()}
      onDragStart={(e) => {
        // The selection travels when the dragged row is part of it.
        const songs = sel.selectedPaths.has(t.path) && sel.selectedTracks.length > 1 ? sel.selectedTracks : [t];
        e.dataTransfer.setData(SONGS_MIME, JSON.stringify(songs.map((s) => s.path)));
        e.dataTransfer.setData("text/plain", dragImageText(songs));
        e.dataTransfer.effectAllowed = "copy";
      }}
    />
  );
}

export function TrackList({ tracks, label, scroller, selectable, onPlay }: TrackListProps) {
  const { sel, phone, nav, lib } = useApp();
  const play = usePlayActions();
  const selectMode = !!selectable && phone.mSelectMode;
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

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
    <>
      <VirtualList
        items={tracks}
        getKey={(t) => t.path}
        label={label}
        multiselectable={selectable}
        scroller={scroller}
        onKeyDown={(e, i) => {
          if (e.key !== "Enter" || !tracks[i]) return;
          e.preventDefault();
          // Enter plays the selection (Ctrl+click or Shift+click chose it), from its first song.
          if (selectable && !selectMode && !e.ctrlKey && !e.shiftKey && sel.selectedTracks.length > 0) {
            play.playSelection(sel.selectedTracks, nav.detail ?? libraryView(lib));
            return;
          }
          activate(e, tracks[i]);
        }}
        renderRow={(t, _i, row) => <TrackItem t={t} row={row} check={selectMode} onClick={activate} onMenu={(track, s) => setMenu({ track, ...s })} />}
      />
      {menu && <RowMenu state={menu} onClose={closeMenu} />}
    </>
  );
}
