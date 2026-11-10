// PlaylistCard and CardGrid. A card is a mosaic with the name (body-strong) and "N songs, duration"
// (body-sm) under it; the playing playlist's name is aqua with the equaliser. The name is the
// card's button and covers the whole card (lists.css), so the "more" button can sit beside it
// without a button inside a button. Cards fill a grid of columns at least 150 px wide.
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Equaliser } from "./Equaliser";
import { Mosaic } from "./Thumb";

export interface PlaylistCardProps {
  name: string;
  /** "12 songs, 47 min". */
  meta: string;
  covers: readonly (string | null | undefined)[];
  playing?: boolean;
  paused?: boolean;
  onOpen?: () => void;
  /** The card's menu (Play, Shuffle, Delete playlist), usually a MenuButton. */
  more?: ReactNode;
  className?: string;
}

export function PlaylistCard({ name, meta, covers, playing, paused, onOpen, more, className }: PlaylistCardProps) {
  return (
    <div className={cx("PlaylistCard", playing && "is-playing", className)} role="listitem">
      <Mosaic covers={covers} />
      <div className="PlaylistCard-foot">
        <div className="PlaylistCard-text">
          <button type="button" className="PlaylistCard-open" onClick={onOpen}>
            {playing && <Equaliser paused={paused} />}
            <span className="PlaylistCard-name">{name}</span>
          </button>
          <span className="PlaylistCard-meta">{meta}</span>
        </div>
        {more && <div className="PlaylistCard-more">{more}</div>}
      </div>
    </div>
  );
}

export interface CardGridProps {
  /** What the cards are ("Playlists"). */
  label: string;
  children: ReactNode;
  className?: string;
}

export function CardGrid({ label, children, className }: CardGridProps) {
  return (
    <div className={cx("CardGrid", className)} role="list" aria-label={label}>
      {children}
    </div>
  );
}
