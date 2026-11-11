// A one-direction touch swipe: down (close a sheet or the full player) or left (remove a queue row).
// The element follows the finger through `offset` (px, set as a CSS variable by the caller); a
// release past `threshold`, or a quick flick, calls onSwipe. Mouse and pen are ignored unless
// touchOnly is false, and a gesture that starts on a button, link or field never becomes a swipe.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isControlTarget } from "./dom";

export interface SwipeOptions {
  /** "down" closes, "left" removes. */
  axis: "down" | "left";
  onSwipe: () => void;
  /** Distance in px that commits the swipe on release. */
  threshold?: number;
  enabled?: boolean;
  touchOnly?: boolean;
}

export interface Swipe {
  /** The current drag distance in px (positive down, negative left); 0 at rest. */
  offset: number;
  dragging: boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

interface Track {
  id: number;
  x: number;
  y: number;
  t: number;
  locked: boolean;
}

const SLOP = 8;
const FLICK = 0.6; // px per ms

export function useSwipe({ axis, onSwipe, threshold = 96, enabled = true, touchOnly = true }: SwipeOptions): Swipe {
  const [offset, setOffset] = useState(0);
  const track = useRef<Track | null>(null);

  const end = (e: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    const t = track.current;
    track.current = null;
    if (!t || !t.locked) return;
    const d = axis === "down" ? Math.max(0, e.clientY - t.y) : Math.max(0, t.x - e.clientX);
    setOffset(0);
    const speed = d / Math.max(1, e.timeStamp - t.t);
    if (commit && (d >= threshold || speed >= FLICK)) onSwipe();
  };

  return {
    offset,
    dragging: offset !== 0,
    handlers: {
      onPointerDown(e) {
        if (!enabled || (touchOnly && e.pointerType !== "touch") || isControlTarget(e.target)) return;
        track.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, locked: false };
      },
      onPointerMove(e) {
        const t = track.current;
        if (!t || t.id !== e.pointerId) return;
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        if (!t.locked) {
          if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
          const ok = axis === "down" ? dy > 0 && dy > Math.abs(dx) : dx < 0 && -dx > Math.abs(dy);
          if (!ok) {
            track.current = null;
            return;
          }
          t.locked = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        setOffset(axis === "down" ? Math.max(0, dy) : Math.min(0, dx));
      },
      onPointerUp(e) {
        end(e, true);
      },
      onPointerCancel(e) {
        end(e, false);
      },
    },
  };
}
