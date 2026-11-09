// A song row's menu: Play next, Add to queue, Add to playlist, Go to artist, Edit tags, Remove from
// the playlist being shown, Delete. It opens from the row's "more" button, the ContextMenu key or
// Shift+F10 on the row, and a right click (or a long press on touch). It acts on the row's song,
// or on the whole selection when the row is part of it. The existing actions and dialogs do the work.
//
// It is the MenuButton's popover (the same .Popover, .Option and .Menu styles and keys: Up, Down,
// Home, End, Enter or Space, typed letters, Esc and Tab close), drawn in the shell's overlay layer
// against the button or the pointer, because a row in a virtual list cannot hold a popover.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, cx, type MenuItem } from "../../design";
import { isPrintable, useOutsidePress, useTypeahead } from "../../design/lib/usePopover";
import { useApp } from "../../app/context";
import { splitArtists } from "../../lib/tracks";
import type { Track } from "../../lib/types";
import { usePlaylistEdits } from "../playlists/usePlaylistEdits";
import { useQueueEdits } from "../queue/useQueueEdits";
import { songCount } from "./trackInfo";

/** Where the menu opens: under a button, or at the pointer. */
export type MenuAnchor = { rect: DOMRect } | { x: number; y: number };

export interface RowMenuState {
  track: Track;
  anchor: MenuAnchor;
  /** Where the focus goes back to when the menu closes. */
  from: HTMLElement | null;
}

const GAP = 4;
const EDGE = 8;

/** The actions for a song (or the selection it is part of). */
function useRowItems(track: Track): MenuItem[] {
  const { lib, nav, sel, dialogs, edits, actions } = useApp();
  const queue = useQueueEdits();
  const playlistEdits = usePlaylistEdits();
  const chosen = sel.selectedPaths.has(track.path) && sel.selectedTracks.length > 1 ? sel.selectedTracks : [track];
  const many = chosen.length > 1;
  const pl = nav.screen === "detail" && nav.detail?.kind === "playlist" ? lib.currentPlaylistFile : null;
  const inPl = pl ? chosen.filter((t) => lib.inPlaylist(pl, t)) : [];
  const artist = splitArtists(track.artist)[0];
  const atArtist = nav.screen === "detail" && nav.detail?.kind === "artist" && nav.detail.name === artist;

  const items: MenuItem[] = [
    { id: "next", label: many ? `Play ${songCount(chosen.length)} next` : "Play next", icon: "next", onSelect: () => queue.playNext(chosen) },
    { id: "queue", label: many ? `Add ${songCount(chosen.length)} to queue` : "Add to queue", icon: "queue", onSelect: () => queue.add(chosen) },
    { id: "playlist", label: "Add to playlist", icon: "playlistAdd", onSelect: () => actions.addToPlaylist(chosen) },
  ];
  if (!many) {
    items.push({ id: "artist", label: "Go to artist", icon: "artists", disabled: atArtist, onSelect: () => nav.openDetail({ kind: "artist", name: artist }) });
    items.push({ id: "tags", label: "Edit tags", icon: "edit", onSelect: () => edits.openTagEditor(track) });
  }
  if (pl && inPl.length > 0) {
    items.push({ id: "remove", label: `Remove from ${pl.name}`, icon: "close", onSelect: () => void playlistEdits.remove(pl.name, inPl) });
  }
  items.push({
    id: "delete",
    label: many ? `Delete ${songCount(chosen.length)}` : "Delete song",
    icon: "trash",
    danger: true,
    onSelect: () => dialogs.setConfirmDelete(chosen),
  });
  return items;
}

export function RowMenu({ state, onClose }: { state: RowMenuState; onClose: () => void }) {
  const items = useRowItems(state.track);
  const host = state.from?.closest(".Shell")?.querySelector<HTMLElement>(".Shell-overlays") ?? null;
  if (!host) return null;
  return createPortal(<RowMenuPopover state={state} items={items} onClose={onClose} />, host);
}

function RowMenuPopover({ state, items, onClose }: { state: RowMenuState; items: readonly MenuItem[]; onClose: () => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const typeahead = useTypeahead(items.map((i) => i.label));
  const last = items.length - 1;

  const close = (refocus: boolean) => {
    onClose();
    if (refocus && state.from?.isConnected) state.from.focus({ preventScroll: true });
  };
  const run = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  };

  useOutsidePress(true, root, () => close(false));

  // Placed against the button (right-aligned, below or, without room, above) or at the pointer,
  // inside the shell; then the menu takes the focus.
  useLayoutEffect(() => {
    const el = root.current;
    const shell = el?.closest(".Shell");
    const pop = menu.current;
    if (!el || !shell || !pop) return;
    const box = shell.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const a = state.anchor;
    const r = "rect" in a ? a.rect : { left: a.x, right: a.x, top: a.y, bottom: a.y };
    let x = "rect" in a ? r.right - w : r.left;
    let y = r.bottom + GAP;
    if (y + h > box.bottom - EDGE && r.top - GAP - h >= box.top + EDGE) y = r.top - GAP - h;
    x = Math.max(box.left + EDGE, Math.min(x, box.right - EDGE - w));
    y = Math.max(box.top + EDGE, Math.min(y, box.bottom - EDGE - h));
    el.style.left = `${x - box.left}px`;
    el.style.top = `${y - box.top}px`;
    pop.focus({ preventScroll: true });
  }, [state.anchor]);

  // The list scrolls or the window changes size: the menu would point at nothing, so it closes.
  useLayoutEffect(() => {
    const away = () => onClose();
    window.addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("resize", away);
      document.removeEventListener("scroll", away, true);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The menu's keys are its own: nothing behind it (a list, a shortcut) sees them.
    e.stopPropagation();
    const k = e.key;
    if (k === "ArrowDown") setActive((n) => (n >= last ? 0 : n + 1));
    else if (k === "ArrowUp") setActive((n) => (n <= 0 ? last : n - 1));
    else if (k === "Home") setActive(0);
    else if (k === "End") setActive(last);
    else if (k === "Enter" || k === " ") run(active);
    else if (k === "Escape" || k === "Tab") close(true);
    else if (isPrintable(e)) {
      const i = typeahead(k, active, e.timeStamp);
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="Menu RowMenu" ref={root} onClick={(e) => e.stopPropagation()}>
      <div
        ref={menu}
        id={`${id}-menu`}
        className="Popover"
        role="menu"
        aria-label={`More for ${state.track.title || state.track.name}`}
        tabIndex={-1}
        aria-activedescendant={`${id}-item-${active}`}
        onKeyDown={onKeyDown}
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            id={`${id}-item-${i}`}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            className={cx("Option", i === active && "is-active", item.danger && "is-danger")}
            onMouseMove={() => active !== i && setActive(i)}
            onClick={() => run(i)}
          >
            {item.icon && <Icon name={item.icon} size={18} />}
            <span className="Option-label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
