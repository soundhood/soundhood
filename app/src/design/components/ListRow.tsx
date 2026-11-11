// ListRow: the row for artists, folders, playlists and search results: a thumb (Thumb or a small
// Mosaic), the name over a meta line ("Artist, 14 songs"), and a count or a chevron on the right.
// Like TrackRow it is an option for a listbox parent with roving tabindex; activation is the owner's.
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  /** A Thumb, or a small Mosaic for a playlist. */
  thumb: ReactNode;
  name: string;
  meta?: string;
  /** A figure on the right (song count); replaces the chevron. */
  count?: string | number;
  /** Show a chevron on the right (the row opens a screen). */
  chevron?: boolean;
  selected?: boolean;
  ref?: Ref<HTMLDivElement>;
}

export function ListRow({ thumb, name, meta, count, chevron, selected, className, ...rest }: ListRowProps) {
  return (
    <div role="option" aria-selected={!!selected} tabIndex={-1} className={cx("ListRow", className)} {...rest}>
      {thumb}
      <div className="ListRow-text">
        <div className="ListRow-name">{name}</div>
        {meta && <div className="ListRow-meta">{meta}</div>}
      </div>
      {count !== undefined ? (
        <span className="ListRow-count">{count}</span>
      ) : (
        chevron && (
          <span className="ListRow-chevron" aria-hidden="true">
            <Icon name="chevronRight" size={20} />
          </span>
        )
      )}
    </div>
  );
}
