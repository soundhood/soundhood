// IconButton: a round hit target (--hit) around one icon. The label is required by the type,
// because an icon alone says nothing to a screen reader. `pressed` makes it a toggle (aria-pressed)
// and paints it aqua while on (shuffle, repeat, the queue pane open). A held key is one press: the
// repeats of a held Enter never press it again (onePress).
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { onePress } from "../lib/dom";
import { Icon, type IconName, type IconSize } from "./Icon";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-pressed"> {
  icon: IconName;
  /** What the button does, said in plain words ("Next", "More for Glass Tides"). */
  label: string;
  /** Icon size: 20 or 24 (default 24). */
  size?: IconSize;
  /** A toggle: true or false sets aria-pressed; true also paints it aqua. */
  pressed?: boolean;
  /** Resting colour --fg-0 instead of --fg-1. */
  strong?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, size = 24, pressed, strong, className, type, title, onKeyDown, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("IconButton", pressed && "is-on", strong && "is-strong", className)}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      onKeyDown={onePress(onKeyDown)}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
