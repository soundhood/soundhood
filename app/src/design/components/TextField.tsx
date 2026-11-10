// TextField: a 40 px input on --bg-2 with a 1 px line; the placeholder in --fg-1. Enter is the
// field's alone: where a caller's Enter submits (Create, Save, Download) and the sheet closes, the
// browser would otherwise hand the same press to the control the focus goes back to (the sidebar's
// "+", the Download item), which would open the sheet again; so the field always ends its Enter.
import type { InputHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ className, type, onKeyDown, ...rest }: TextFieldProps) {
  return (
    <input
      type={type ?? "text"}
      className={cx("TextField", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
      }}
      {...rest}
    />
  );
}
