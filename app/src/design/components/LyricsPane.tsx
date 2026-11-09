// LyricsPane: plain or timed lyrics. Timed lines are buttons: the current one in --fg-0, the rest
// --fg-1, all at h3; the pane scrolls to keep the current line a third from the top, and tapping a
// line seeks there. A lilac outline badge "Generated" when no person wrote the lyrics. An empty
// state when there are none. (Data arrives in Phase 5; until then the lyrics buttons are hidden.)
import { useLayoutEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { reducedMotion } from "../lib/dom";
import { Badge } from "./Badge";
import { EmptyState } from "./States";

export interface LyricLine {
  /** Seconds from the start; leave out for plain lyrics. */
  time?: number;
  text: string;
}

export interface LyricsPaneProps {
  lines: readonly LyricLine[] | null;
  /** The playing position in seconds (timed lyrics). */
  position?: number;
  onSeek?: (seconds: number) => void;
  generated?: boolean;
  className?: string;
}

/** Index of the line playing at `position`: the last one that has started, or -1. */
export function currentLine(lines: readonly LyricLine[], position: number): number {
  let at = -1;
  lines.forEach((l, i) => {
    if (l.time !== undefined && l.time <= position) at = i;
  });
  return at;
}

export function LyricsPane({ lines, position = 0, onSeek, generated, className }: LyricsPaneProps) {
  const pane = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const timed = !!lines && lines.length > 0 && lines.every((l) => l.time !== undefined);
  const current = timed && lines ? currentLine(lines, position) : -1;

  useLayoutEffect(() => {
    const p = pane.current;
    const line = p?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!p || !line) return;
    const top = line.offsetTop - p.clientHeight / 3;
    // The first placement jumps; later lines glide (unless motion is reduced).
    p.scrollTo({ top: Math.max(0, top), behavior: placed.current && !reducedMotion() ? "smooth" : "auto" });
    placed.current = true;
  }, [current]);

  if (!lines || lines.length === 0) {
    return (
      <div className={cx("LyricsPane", "is-empty", className)}>
        <EmptyState icon="lyrics" title="No lyrics for this song" text="Lyrics show here when the song has them." />
      </div>
    );
  }

  return (
    <div className={cx("LyricsPane", timed && "is-timed", className)}>
      {generated && (
        <div className="LyricsPane-head">
          <Badge outline>Generated</Badge>
        </div>
      )}
      <div className="LyricsPane-lines" ref={pane}>
        {lines.map((l, i) =>
          timed ? (
            <button
              key={i}
              type="button"
              data-line={i}
              className={cx("LyricsLine", i === current && "is-current", !l.text && "is-break")}
              aria-current={i === current || undefined}
              onClick={() => onSeek?.(l.time ?? 0)}
            >
              {l.text || " "}
            </button>
          ) : (
            <p key={i} className={cx("LyricsLine", !l.text && "is-break")}>
              {l.text || " "}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
