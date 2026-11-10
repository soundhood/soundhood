// SearchField: a 40 px field with a search icon and, while it holds text, a clear button. Esc
// clears it; a second Esc leaves it. With `shortcut`, Ctrl+K and "/" focus it from anywhere on the
// screen it is on, except that "/" typed in another text field is a character there, and neither key
// does anything while a sheet, the first-launch setup or a menu is open over the field (topLayer) or
// another part of the app already took the key.
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from "react";
import { cx } from "../lib/cx";
import { isTypingTarget } from "../lib/dom";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import { behindLayer } from "./Sheet";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The field's name for assistive tech. */
  label?: string;
  /** Listen for Ctrl+K and "/" while the field is on screen. */
  shortcut?: boolean;
  onSubmit?: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search your library",
  label = "Search",
  shortcut,
  onSubmit,
  inputRef,
  className,
}: SearchFieldProps) {
  const own = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => own.current as HTMLInputElement, []);

  const onGlobalKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const el = own.current;
    if (!el || el.getClientRects().length === 0 || e.defaultPrevented || behindLayer(el)) return;
    const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target);
    if (ctrlK || slash) {
      e.preventDefault();
      el.focus();
      el.select();
    }
  });
  useEffect(() => {
    if (!shortcut) return;
    const h = (e: globalThis.KeyboardEvent) => onGlobalKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [shortcut]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (value) onChange("");
      else e.currentTarget.blur();
    } else if (e.key === "Enter") {
      onSubmit?.(value);
    }
  };

  return (
    <label className={cx("SearchField", className)}>
      <Icon name="search" size={20} />
      <input
        ref={own}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {value && (
        <IconButton
          icon="close"
          size={18}
          label="Clear search"
          onClick={() => {
            onChange("");
            own.current?.focus();
          }}
        />
      )}
    </label>
  );
}
