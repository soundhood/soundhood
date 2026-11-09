// Shared popover behaviour for Dropdown, MultiSelect and MenuButton: close on a pointer press
// outside, place the popover below its button or flip it up (and right-align it) when the visible
// area has no room, and a type-ahead that finds the option starting with the typed letters.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { clipBox } from "./dom";

/** Calls onOutside for a pointer press outside `root` while `open`. */
export function useOutsidePress(open: boolean, root: RefObject<HTMLElement | null>, onOutside: () => void) {
  const fire = useEffectEvent((e: PointerEvent) => {
    if (root.current && e.target instanceof Node && !root.current.contains(e.target)) onOutside();
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => fire(e);
    document.addEventListener("pointerdown", h, true);
    return () => document.removeEventListener("pointerdown", h, true);
  }, [open]);
}

const GAP = 8;

/**
 * Places `popover` against `anchor` each time it opens: data-up when there is no room below and
 * more room above, data-end when it would overflow the right edge. The attributes are set on the
 * element directly (React never renders them), and controls.css reads them.
 */
export function usePopoverPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const a = anchor.current;
    const p = popover.current;
    if (!open || !a || !p) return;
    const box = clipBox(a);
    const r = a.getBoundingClientRect();
    const below = box.bottom - r.bottom;
    const above = r.top - box.top;
    p.toggleAttribute("data-up", below < p.offsetHeight + GAP && above > below);
    p.toggleAttribute("data-end", r.left + p.offsetWidth > box.right - GAP && r.right - p.offsetWidth >= box.left);
  }, [open, anchor, popover]);
}

/**
 * Type-ahead over option labels: letters typed within 600 ms build a prefix; a single letter
 * repeated cycles through the options that start with it. Returns the index to jump to, or -1.
 */
export function useTypeahead(labels: readonly string[]) {
  const typed = useRef({ text: "", at: 0 });
  return (key: string, from: number, now: number): number => {
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const needle = t.text.toLowerCase();
    const cycling = [...needle].every((c) => c === needle[0]);
    const prefix = cycling ? needle[0] : needle;
    const start = cycling ? from + 1 : Math.max(0, from);
    for (let k = 0; k < labels.length; k++) {
      const i = (start + k) % labels.length;
      if (labels[i].toLowerCase().startsWith(prefix)) return i;
    }
    return -1;
  };
}

/** True for a key that types a character (type-ahead), not for Space or a shortcut. */
export function isPrintable(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}
