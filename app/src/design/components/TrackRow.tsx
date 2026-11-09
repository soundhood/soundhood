// TrackRow: one song in a list, --row-h tall (56 phone, 48 desktop). Anatomy: an optional checkbox
// (Select mode) or drag handle (edit mode, the queue), the thumb, title over artist, the folder
// (desktop shell only, a storage hint), the duration, and a "more" button (revealed on hover with a
// mouse, always shown on touch: lists.css). States: playing (3 px aqua bar, aqua title, equaliser),
// selected (aqua-dim wash, ticked checkbox), missing (disabled text, "Missing file"; never dropped).
//
// The row is a role="option" for a role="listbox" parent (VirtualList), with roving tabindex from
// that list. It renders; it does not decide: clicks, modifier clicks, Enter, Space and Delete are the
// list owner's (they arrive through the usual props). The more button is outside the tab order; the
// ContextMenu key or Shift+F10 on the row opens it instead.
import type { HTMLAttributes, KeyboardEvent, MouseEvent, Ref } from "react";
import { cx } from "../lib/cx";
import { Checkbox } from "./Checkbox";
import { Equaliser } from "./Equaliser";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Thumb } from "./Thumb";

export interface TrackRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  artist: string;
  /** Length as shown ("3:41"). */
  duration: string;
  folder?: string;
  cover?: string | null;
  playing?: boolean;
  /** Playing but paused: the equaliser stands still. */
  paused?: boolean;
  selected?: boolean;
  /** A playlist line whose file is gone. */
  missing?: boolean;
  /** Select mode: show the checkbox. */
  check?: boolean;
  /** Edit mode: show the drag handle; its props carry the drag handlers. */
  handle?: boolean;
  handleProps?: HTMLAttributes<HTMLSpanElement>;
  /** Opens the row's menu; also reached with ContextMenu or Shift+F10 on the row. */
  onMore?: (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  ref?: Ref<HTMLDivElement>;
}

export function TrackRow({
  title,
  artist,
  duration,
  folder,
  cover,
  playing,
  paused,
  selected,
  missing,
  check,
  handle,
  handleProps,
  onMore,
  className,
  onKeyDown,
  ...rest
}: TrackRowProps) {
  return (
    <div
      role="option"
      aria-selected={!!selected}
      aria-disabled={missing || undefined}
      aria-current={playing || undefined}
      tabIndex={-1}
      className={cx(
        "TrackRow",
        playing && "is-playing",
        selected && "is-selected",
        missing && "is-missing",
        check && "has-check",
        handle && !check && "has-handle",
        className,
      )}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (onMore && !e.defaultPrevented && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
          e.preventDefault();
          onMore(e);
        }
      }}
      {...rest}
    >
      {check ? (
        <Checkbox checked={!!selected} decorative />
      ) : (
        handle && (
          <span className="TrackRow-handle" aria-hidden="true" {...handleProps}>
            <Icon name="drag" size={20} />
          </span>
        )
      )}
      <Thumb src={cover} />
      <div className="TrackRow-text">
        <div className="TrackRow-title">
          {playing && <Equaliser paused={paused} />}
          <span>{title}</span>
        </div>
        <div className="TrackRow-artist">{missing ? "Missing file" : artist}</div>
      </div>
      <div className="TrackRow-folder">{folder}</div>
      <div className="TrackRow-time">{duration}</div>
      {onMore && (
        <IconButton
          icon="more"
          size={20}
          label={`More for ${title}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onMore(e);
          }}
        />
      )}
    </div>
  );
}
