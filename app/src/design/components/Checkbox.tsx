// Checkbox: a 20 px rounded square used in Select mode and Tidy: a --fg-1 outline when off, aqua
// with an ink tick when on. Interactive by default (a button with role="checkbox"); `decorative`
// draws the same box hidden from assistive tech, for rows whose own role carries the state
// (a TrackRow option's aria-selected).
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "role" | "aria-checked"> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  decorative?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Checkbox({ checked, onChange, decorative, onClick, className, type, ...rest }: CheckboxProps) {
  if (decorative) {
    return (
      <span className={cx("Checkbox", className)} role="checkbox" aria-checked={checked} aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
    );
  }
  return (
    <button
      type={type ?? "button"}
      role="checkbox"
      aria-checked={checked}
      className={cx("Checkbox", className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange?.(!checked);
      }}
      {...rest}
    >
      <Icon name="check" size={16} />
    </button>
  );
}
