// TextField: a 40 px input on --bg-2 with a 1 px line; the placeholder in --fg-1.
import type { InputHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ className, type, ...rest }: TextFieldProps) {
  return <input type={type ?? "text"} className={cx("TextField", className)} {...rest} />;
}
