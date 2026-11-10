// Button: a 40 px pill (32 px small). Primary is the screen's one aqua fill; danger is destructive;
// text is transparent (Cancel); link is aqua text for the one action of an empty state or a toast.
// A held key is one press: the repeats of a held Enter never press it again (onePress).
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { onePress } from "../lib/dom";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "default" | "primary" | "danger" | "text" | "link";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  /** An icon before the label (18 px). */
  icon?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "default", small, icon, className, type, children, onKeyDown, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("Button", variant !== "default" && `is-${variant}`, small && "is-small", className)}
      onKeyDown={onePress(onKeyDown)}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
