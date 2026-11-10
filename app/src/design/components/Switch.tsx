// Switch: a 32 x 18 track, purple with a lilac edge and knob when on. role="switch" on a real button, so
// Space and Enter toggle it natively. In a settings row the whole row is the click target
// (SwitchRow in Settings.tsx).
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "role" | "aria-checked"> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  ref?: Ref<HTMLButtonElement>;
}

export function Switch({ checked, onChange, onClick, className, type, ...rest }: SwitchProps) {
  return (
    <button
      type={type ?? "button"}
      role="switch"
      aria-checked={checked}
      className={cx("Switch", className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange?.(!checked);
      }}
      {...rest}
    />
  );
}
