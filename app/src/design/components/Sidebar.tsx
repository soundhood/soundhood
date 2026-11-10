// Sidebar (desktop; the 72 px rail on a tablet): 240 px on --bg-0 with a line on its right. The
// wordmark (aqua mark and "Soundhood"), the search field, four nav items (icon, label, count; the
// current one on --bg-1 with an aqua icon; a disabled one, Playing while nothing plays, greyed and
// inert like the phone's tab), "Playlists" with a new-playlist button and the list of
// playlists (mosaic, name, the equaliser on the playing one), and a footer with Settings and the
// collapse button. Songs dragged onto a playlist here are handed to onDropOnPlaylist.
//
// Width and collapsed are controlled, so the app remembers them: drag the right edge (200 to 320,
// --sidebar-min and --sidebar-max) or use Left and Right on it; the collapse button folds it to
// the rail. The Shell takes the same two values (sidebarWidth, sidebarCollapsed) for its grid.
import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { clamp, cx } from "../lib/cx";
import { cssPx } from "../lib/dom";
import { Equaliser } from "./Equaliser";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { Mosaic } from "./Thumb";

export interface NavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
  count?: string | number;
  disabled?: boolean;
}

export interface SidebarPlaylist {
  id: string;
  name: string;
  covers: readonly (string | null | undefined)[];
  playing?: boolean;
  paused?: boolean;
}

export interface SidebarProps<Id extends string> {
  nav: readonly NavEntry<Id>[];
  current: Id | null;
  onNavigate: (id: Id) => void;
  /** A SearchField. */
  search?: ReactNode;
  playlists?: readonly SidebarPlaylist[];
  currentPlaylist?: string | null;
  onOpenPlaylist?: (id: string) => void;
  onNewPlaylist?: () => void;
  onDropOnPlaylist?: (id: string, e: DragEvent<HTMLElement>) => void;
  onSettings?: () => void;
  width: number;
  onWidthChange?: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

const KEY_STEP = 8;

export function Sidebar<Id extends string>({
  nav,
  current,
  onNavigate,
  search,
  playlists,
  currentPlaylist,
  onOpenPlaylist,
  onNewPlaylist,
  onDropOnPlaylist,
  onSettings,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
  className,
}: SidebarProps<Id>) {
  const root = useRef<HTMLElement>(null);
  const resize = useRef<{ x: number; w: number } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const bounds = () => {
    const el = root.current;
    return el ? [cssPx(el, "--sidebar-min", 200), cssPx(el, "--sidebar-max", 320)] : [200, 320];
  };
  const setWidth = (w: number) => {
    const [min, max] = bounds();
    onWidthChange?.(Math.round(clamp(w, min, max)));
  };

  const onResizeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { x: e.clientX, w: width };
  };
  const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (r) setWidth(r.w + e.clientX - r.x);
  };
  const onResizeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [min, max] = bounds();
    const next = { ArrowLeft: width - KEY_STEP, ArrowRight: width + KEY_STEP, Home: min, End: max }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <nav ref={root} className={cx("Sidebar", collapsed && "is-collapsed", className)} aria-label="Library">
      <div className="Sidebar-top">
        <div className="Wordmark">
          <Icon name="mark" size={26} />
          <span>Soundhood</span>
        </div>
        {search}
      </div>
      <div className="Sidebar-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            className="NavItem"
            aria-current={n.id === current ? "page" : undefined}
            aria-label={n.count != null ? `${n.label}, ${n.count}` : n.label}
            title={n.label}
            disabled={n.disabled}
            aria-disabled={n.disabled || undefined}
            onClick={() => onNavigate(n.id)}
          >
            <Icon name={n.icon} size={24} />
            <span>{n.label}</span>
            {n.count != null && <span className="NavItem-count">{n.count}</span>}
          </button>
        ))}
      </div>
      {playlists && (
        <>
          <div className="Sidebar-section">
            <span className="t-overline">Playlists</span>
            {onNewPlaylist && <IconButton icon="plus" size={20} label="New playlist" onClick={onNewPlaylist} />}
          </div>
          <div className="Sidebar-list" role="list" aria-label="Playlists">
            {playlists.map((p) => (
              <button
                key={p.id}
                type="button"
                role="listitem"
                className={cx("NavItem", p.playing && "is-playing", dropOn === p.id && "is-drop")}
                aria-current={p.id === currentPlaylist ? "page" : undefined}
                onClick={() => onOpenPlaylist?.(p.id)}
                onDragOver={(e) => {
                  if (!onDropOnPlaylist) return;
                  e.preventDefault();
                  if (dropOn !== p.id) setDropOn(p.id);
                }}
                onDragLeave={() => setDropOn((d) => (d === p.id ? null : d))}
                onDrop={(e) => {
                  if (!onDropOnPlaylist) return;
                  e.preventDefault();
                  setDropOn(null);
                  onDropOnPlaylist(p.id, e);
                }}
              >
                <Mosaic covers={p.covers} small />
                <span className="ellipsis">{p.name}</span>
                {p.playing && <Equaliser paused={p.paused} />}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="Sidebar-foot">
        {onSettings && <IconButton icon="settings" label="Settings" onClick={onSettings} />}
        {onCollapsedChange && (
          <IconButton
            icon="sidebar"
            label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            className="is-wide-only"
            onClick={() => onCollapsedChange(!collapsed)}
          />
        )}
      </div>
      {onWidthChange && !collapsed && (
        <div
          className="Sidebar-resize is-wide-only"
          role="separator"
          aria-orientation="vertical"
          aria-label="Sidebar width"
          aria-valuenow={width}
          aria-valuemin={200}
          aria-valuemax={320}
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={() => (resize.current = null)}
          onPointerCancel={() => (resize.current = null)}
          onKeyDown={onResizeKey}
        />
      )}
    </nav>
  );
}
