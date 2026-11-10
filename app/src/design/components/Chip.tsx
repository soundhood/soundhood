// Chip and ChipRow: 32 px filter pills under a search field. A pressed chip steps up to --bg-3
// (never aqua). The row scrolls sideways without a scrollbar. A held key is one press (onePress).
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import { onePress } from "../lib/dom";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  pressed: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({ pressed, className, type, onKeyDown, ...rest }: ChipProps) {
  return <button type={type ?? "button"} className={cx("Chip", className)} aria-pressed={pressed} onKeyDown={onePress(onKeyDown)} {...rest} />;
}

export interface ChipRowProps {
  /** What the chips filter ("Show"). */
  label: string;
  children: ReactNode;
  className?: string;
}

export function ChipRow({ label, children, className }: ChipRowProps) {
  return (
    <div className={cx("ChipRow", className)} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}
