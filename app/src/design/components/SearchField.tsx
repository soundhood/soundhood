// SearchField: a 40 px field with a search icon and, while it holds text, a clear button. Esc
// clears it. In an empty field Esc closes what is open over the screen, if anything is (`onEscape`:
// the full player; a list, a menu or a sheet takes its own Esc before the field hears it), and the
// focus goes to where the screen now shown starts (focusMainArea: its heading), never to the page and
// never to the opener of what just closed, where Space would open it again. It is the field's own
// key: it never leaves Select mode and never drops the songs chosen. With `shortcut`, Ctrl+K and "/" focus it from anywhere on the screen it is on,
// except that "/" typed in another text field is a character there, and neither key does anything
// while a sheet, the first-launch setup or a menu is open over the field (topLayer) or another part
// of the app already took the key. Held, either is one press (heldShortcut, heldKeys.ts): "/" held
// focuses the field and types nothing into it.
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from "react";
import { flushSync } from "react-dom";
import { cx } from "../lib/cx";
import { focusMainArea, isTypingTarget } from "../lib/dom";
import { heldShortcut } from "../lib/heldKeys";
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
  /** Esc in the empty field: closes what is open over the screen (the full player), if anything is. */
  onEscape?: () => void;
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
  onEscape,
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
      heldShortcut(e);
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
      // The field's own key either way: Select mode and the songs chosen stay.
      e.preventDefault();
      e.stopPropagation();
      if (value) onChange("");
      else {
        // Nothing to clear: what is open over the screen closes (in this commit, so the screen under
        // it is in the page), then the focus goes to that screen's heading.
        if (onEscape) flushSync(onEscape);
        focusMainArea();
      }
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      // Its own: never a press of what the focus moves to next (TextField).
      e.preventDefault();
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
