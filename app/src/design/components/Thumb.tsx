// Thumb and Mosaic: artwork in lists. A Thumb is 40 px (--r-xs; round for artists; a folder icon
// on --bg-2 for folders), lazy-loaded, --bg-2 until the image arrives, an icon if there is none or
// it fails. A Mosaic is a square of four different covers (2 x 2, no gap, --r-md), one cover when a
// playlist has fewer than four, a playlist icon when it has none; full width in cards, 40 px small.
import { useState } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";

export interface ThumbProps {
  src?: string | null;
  /** An artist: a round thumb. */
  round?: boolean;
  /** A folder: the folder icon instead of artwork. */
  folder?: boolean;
  /** Artwork is decorative next to its title; give alt text only when it stands alone. */
  alt?: string;
  className?: string;
}

export function Thumb({ src, round, folder, alt = "", className }: ThumbProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (folder || !src || failed === src) {
    return (
      <span className={cx("Thumb", "is-icon", round && "is-round", className)} aria-hidden="true">
        <Icon name={folder ? "folders" : round ? "artists" : "music"} size={20} />
      </span>
    );
  }
  return (
    <img
      className={cx("Thumb", round && "is-round", className)}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
}

export interface MosaicProps {
  /** Cover URLs of the playlist's songs, in order; duplicates count once. */
  covers: readonly (string | null | undefined)[];
  /** 40 px, for rows and the sidebar. */
  small?: boolean;
  className?: string;
}

export function Mosaic({ covers, small, className }: MosaicProps) {
  const unique = [...new Set(covers.filter((c): c is string => !!c))];
  if (unique.length === 0) {
    return (
      <span className={cx("Mosaic", "is-empty", small && "is-small", className)} aria-hidden="true">
        <Icon name="playlists" size={small ? 20 : 32} />
      </span>
    );
  }
  const shown = unique.length >= 4 ? unique.slice(0, 4) : unique.slice(0, 1);
  return (
    <span className={cx("Mosaic", shown.length === 1 && "is-single", small && "is-small", className)} aria-hidden="true">
      {shown.map((src) => (
        <img key={src} src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      ))}
    </span>
  );
}
