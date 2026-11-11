// Queue: the play queue. A sticky "Now playing" row, then sections ("Next in queue" for songs added
// with Play next or Add to queue, "Next from <source>"), each a VirtualList scrolling with the queue.
// Footer: Save as playlist, and Clear, which asks first. On the phone it lives in a 92 % sheet, on
// the desktop in the right pane.
//
// Reordering: drag the handle with a mouse or pen, long-press a row on touch, or Alt+Up and Alt+Down
// with the keyboard (Ctrl+Up and Ctrl+Down stay volume). Removing: swipe a row left on touch, or
// Delete (or X) with the keyboard. Enter or a tap plays the row. The owner applies every change
// (onMove, onRemove, onPlay); the queue only draws the gesture.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { clamp, cssVars, cx } from "../lib/cx";
import { isControlTarget } from "../lib/dom";
import { Button } from "./Button";
import { TrackRow } from "./TrackRow";
import { VirtualList, type VirtualRowProps } from "./VirtualList";

export interface QueueItem {
  key: string;
  title: string;
  artist: string;
  duration: string;
  cover?: string | null;
  missing?: boolean;
}

export interface QueueSection {
  id: string;
  /** "Next in queue", "Next from Late Night Drive". */
  label: string;
  items: readonly QueueItem[];
}

export interface QueueProps {
  now?: (QueueItem & { paused?: boolean }) | null;
  sections: readonly QueueSection[];
  onPlay?: (section: string, index: number) => void;
  onMove?: (section: string, from: number, to: number) => void;
  onRemove?: (section: string, index: number) => void;
  onSaveAsPlaylist?: () => void;
  /** Called after the user confirmed. */
  onClear?: () => void;
  /** Show the "Queue" heading (the right pane); a sheet brings its own title. */
  heading?: boolean;
  headActions?: ReactNode;
  className?: string;
}

interface DragState {
  section: string;
  from: number;
  to: number;
  dy: number;
}

interface DragTrack extends DragState {
  y0: number;
  rowH: number;
  count: number;
}

interface Gestures {
  start: (section: string, index: number, y: number, count: number, rowH: number) => void;
  move: (y: number) => void;
  end: (commit: boolean) => void;
}

const LONG_PRESS = 400;
const SLOP = 8;

export function Queue({
  now,
  sections,
  onPlay,
  onMove,
  onRemove,
  onSaveAsPlaylist,
  onClear,
  heading,
  headActions,
  className,
}: QueueProps) {
  const list = useRef<HTMLDivElement>(null);
  const track = useRef<DragTrack | null>(null);
  const lastGesture = useRef(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [confirming, setConfirming] = useState(false);

  // While a row is dragged on touch, the finger moves the row, not the list.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (track.current) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const gestures: Gestures = {
    start(section, index, y, count, rowH) {
      track.current = { section, from: index, to: index, dy: 0, y0: y, rowH, count };
      setDrag({ section, from: index, to: index, dy: 0 });
    },
    move(y) {
      const t = track.current;
      if (!t) return;
      t.dy = y - t.y0;
      t.to = clamp(t.from + Math.round(t.dy / t.rowH), 0, t.count - 1);
      setDrag({ section: t.section, from: t.from, to: t.to, dy: t.dy });
    },
    end(commit) {
      const t = track.current;
      track.current = null;
      lastGesture.current = performance.now();
      setDrag(null);
      if (commit && t && t.to !== t.from) onMove?.(t.section, t.from, t.to);
    },
  };

  return (
    <div className={cx("Queue", className)}>
      {heading && (
        <div className="Queue-head">
          <h2>Queue</h2>
          {headActions}
        </div>
      )}
      <div className="Queue-list" ref={list}>
        {now && (
          <>
            <div className="Queue-label t-overline">Now playing</div>
            <div className="Queue-now" role="listbox" aria-label="Now playing">
              <TrackRow
                title={now.title}
                artist={now.artist}
                duration={now.duration}
                cover={now.cover}
                missing={now.missing}
                playing
                paused={now.paused}
              />
            </div>
          </>
        )}
        {sections.map((s) => (
          <QueueSectionList
            key={s.id}
            section={s}
            scroller={list}
            drag={drag}
            gestures={gestures}
            lastGesture={lastGesture}
            onPlay={onPlay}
            onMove={onMove}
            onRemove={onRemove}
          />
        ))}
        {sections.every((s) => s.items.length === 0) && (
          <p className="Queue-empty">Songs you add with Play next or Add to queue show here.</p>
        )}
      </div>
      {(onSaveAsPlaylist || onClear) && (
        <div className="Queue-foot">
          {confirming ? (
            <>
              <span className="Queue-confirm">Clear the queue?</span>
              <Button small variant="text" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                small
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  onClear?.();
                }}
              >
                Clear
              </Button>
            </>
          ) : (
            <>
              {onSaveAsPlaylist && (
                <Button small onClick={onSaveAsPlaylist}>
                  Save as playlist
                </Button>
              )}
              {onClear && (
                <Button small variant="text" onClick={() => setConfirming(true)}>
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface SectionListProps {
  section: QueueSection;
  scroller: RefObject<HTMLDivElement | null>;
  drag: DragState | null;
  gestures: Gestures;
  lastGesture: RefObject<number>;
  onPlay?: QueueProps["onPlay"];
  onMove?: QueueProps["onMove"];
  onRemove?: QueueProps["onRemove"];
}

function QueueSectionList({ section, scroller, drag, gestures, lastGesture, onPlay, onMove, onRemove }: SectionListProps) {
  const { id, items } = section;
  if (items.length === 0) return null;
  // After a removal the list moves the keyboard to the row that takes the removed one's place.
  const remove = (index: number) => onRemove?.(id, index);
  return (
    <>
      <div className="Queue-label t-overline">{section.label}</div>
      <VirtualList
        items={items}
        label={section.label}
        scroller={scroller}
        getKey={(item) => item.key}
        onKeyDown={(e, index) => {
          const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
          if (e.key === "Enter" && plain) onPlay?.(id, index);
          else if (onRemove && plain && (e.key === "Delete" || e.key.toLowerCase() === "x")) remove(index);
          else if (onMove && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            const to = index + (e.key === "ArrowUp" ? -1 : 1);
            if (to >= 0 && to < items.length) onMove(id, index, to);
          } else return;
          e.preventDefault();
        }}
        renderRow={(item, index, row) => (
          <QueueRow
            item={item}
            index={index}
            section={id}
            count={items.length}
            row={row}
            drag={drag}
            gestures={gestures}
            canMove={!!onMove}
            onRemove={onRemove ? () => remove(index) : undefined}
            onPlay={() => {
              if (performance.now() - lastGesture.current > 300) onPlay?.(id, index);
            }}
          />
        )}
      />
    </>
  );
}

interface QueueRowProps {
  item: QueueItem;
  index: number;
  section: string;
  count: number;
  row: VirtualRowProps;
  drag: DragState | null;
  gestures: Gestures;
  canMove: boolean;
  onRemove?: () => void;
  onPlay: () => void;
}

interface Touch {
  id: number;
  x: number;
  y: number;
  mode: "pending" | "swipe" | "drag";
  timer: number;
}

function QueueRow({ item, index, section, count, row, drag, gestures, canMove, onRemove, onPlay }: QueueRowProps) {
  const el = useRef<HTMLDivElement>(null);
  const touch = useRef<Touch | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const rowH = () => el.current?.offsetHeight || 56;

  const mine = drag?.section === section ? drag : null;
  const dragged = mine?.from === index;
  let shift = 0;
  if (mine && !dragged) {
    if (mine.from < index && index <= mine.to) shift = -1;
    else if (mine.to <= index && index < mine.from) shift = 1;
  }

  const finishTouch = (commit: boolean, x: number) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.mode === "swipe") {
      setSwipeX(0);
      if (commit && t.x - x > (el.current?.offsetWidth ?? 320) * 0.35) onRemove?.();
    } else if (t.mode === "drag") gestures.end(commit);
  };

  return (
    <TrackRow
      {...row}
      ref={el}
      title={item.title}
      artist={item.artist}
      duration={item.duration}
      cover={item.cover}
      missing={item.missing}
      handle={canMove}
      className={cx(dragged && "is-dragging", shift < 0 && "is-shift-up", shift > 0 && "is-shift-down", swipeX < 0 && "is-swiping")}
      style={{
        ...row.style,
        ...cssVars({ "--drag-y": dragged ? `${mine?.dy ?? 0}px` : undefined, "--swipe-x": swipeX ? `${swipeX}px` : undefined }),
      }}
      onClick={onPlay}
      onContextMenu={(e) => {
        if (touch.current) e.preventDefault();
      }}
      handleProps={{
        onPointerDown(e) {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          gestures.start(section, index, e.clientY, count, rowH());
        },
        onPointerMove(e) {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) gestures.move(e.clientY);
        },
        onPointerUp(e) {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) gestures.end(true);
        },
        onPointerCancel() {
          gestures.end(false);
        },
        onClick(e) {
          e.stopPropagation();
        },
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" || isControlTarget(e.target)) return;
        const t: Touch = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: "pending", timer: 0 };
        if (canMove) {
          t.timer = window.setTimeout(() => {
            if (touch.current !== t || t.mode !== "pending") return;
            t.mode = "drag";
            el.current?.setPointerCapture(t.id);
            gestures.start(section, index, t.y, count, rowH());
          }, LONG_PRESS);
        }
        touch.current = t;
      }}
      onPointerMove={(e) => {
        const t = touch.current;
        if (!t || t.id !== e.pointerId) return;
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        if (t.mode === "pending") {
          if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
          clearTimeout(t.timer);
          if (!onRemove || dx >= 0 || -dx <= Math.abs(dy)) {
            touch.current = null;
            return;
          }
          t.mode = "swipe";
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (t.mode === "swipe") setSwipeX(Math.min(0, dx));
        else gestures.move(e.clientY);
      }}
      onPointerUp={(e) => finishTouch(true, e.clientX)}
      onPointerCancel={(e) => finishTouch(false, e.clientX)}
    />
  );
}
