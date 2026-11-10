// Shared popover behaviour for Dropdown, MultiSelect, MenuButton and the row menu: a layer while it
// is open (usePopoverLayer), close on a pointer press outside, placed against its button and kept
// there (usePopoverPlacement: drawn in the shell's overlay layer, so nothing that scrolls clips it,
// and its height capped to the room on the side it opens to), and a type-ahead that finds the
// option starting with the typed letters.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clipBox } from "./dom";
import { placePopover } from "./placement";
import { openPopovers, type OpenPopover } from "./popoverStack";

/**
 * Makes an open popover a layer (popoverStack.ts): the keys heard on the window leave what is behind
 * it alone (topLayer, Sheet.tsx), a sheet that opens closes it first, and Esc closes it, wherever the
 * focus is, before anything else hears the key (the sheet it is in, the selection, the search).
 * `anchor` is the control that opened it; `close(true)` puts the focus back there.
 */
export function usePopoverLayer(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  anchor: () => HTMLElement | null,
  close: (refocus: boolean) => void,
) {
  const latest = useRef({ anchor, close });
  useLayoutEffect(() => {
    latest.current = { anchor, close };
  });
  const [self] = useState<OpenPopover>(() => ({
    panel,
    anchor: () => latest.current.anchor(),
    close: (refocus) => latest.current.close(refocus),
  }));
  useLayoutEffect(() => {
    if (!open) return;
    openPopovers.open(self);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || openPopovers.top() !== self) return;
      e.preventDefault();
      e.stopPropagation();
      self.close(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      openPopovers.close(self);
    };
  }, [open, self]);
}

/**
 * Calls onOutside for a pointer press outside every one of `inside` while `open` (a popover's control
 * and the popover, which the overlay layer holds apart from it).
 */
export function useOutsidePress(open: boolean, inside: readonly RefObject<HTMLElement | null>[], onOutside: () => void) {
  const fire = useEffectEvent((e: PointerEvent) => {
    const t = e.target;
    if (!(t instanceof Node) || !inside.some((r) => r.current)) return;
    if (!inside.some((r) => r.current?.contains(t))) onOutside();
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => fire(e);
    document.addEventListener("pointerdown", h, true);
    return () => document.removeEventListener("pointerdown", h, true);
  }, [open]);
}

/**
 * Places the open `popover` against `anchor` (placePopover) and keeps it there: once it is drawn,
 * then whenever the anchor moves (a scroll, a resize, a sheet still sliding in) or the popover's
 * options change, checked every frame while it is open and written only when something changed.
 * Its left, top and max-height are set on the element directly (React never renders them; it is
 * absolutely positioned, in the shell's overlay layer or in place), and data-up / data-end say how
 * it was placed. The area it can be seen in is the window cut by whatever clips the popover (in the
 * overlay layer, only the shell). When the anchor itself has scrolled out of sight, `onLost` runs.
 */
export function usePopoverPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  { align = "start", onLost }: { align?: "start" | "end"; onLost?: () => void } = {},
) {
  const lost = useEffectEvent(() => onLost?.());
  useLayoutEffect(() => {
    if (!open) return;
    let seen = "";
    const place = () => {
      const a = anchor.current;
      const p = popover.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const now = `${r.left} ${r.top} ${r.right} ${r.bottom} ${innerWidth} ${innerHeight} ${p.childElementCount}`;
      if (now === seen) return;
      seen = now;
      const view = clipBox(a);
      if (r.bottom <= view.top || r.top >= view.bottom || r.right <= view.left || r.left >= view.right) {
        lost();
        return;
      }
      // Measured at the corner of the box it is placed in: its own size, and where that corner is.
      const scrolled = p.scrollTop;
      p.style.left = "0px";
      p.style.top = "0px";
      p.style.maxHeight = "";
      const corner = p.getBoundingClientRect();
      const at = placePopover({ anchor: r, width: corner.width, height: corner.height, area: clipBox(p), align });
      p.style.left = `${at.left - corner.left}px`;
      p.style.top = `${at.top - corner.top}px`;
      if (at.maxHeight !== null) p.style.maxHeight = `${at.maxHeight}px`;
      p.scrollTop = scrolled;
      p.toggleAttribute("data-up", at.up);
      p.toggleAttribute("data-end", at.end);
    };
    place();
    let frame = requestAnimationFrame(function follow() {
      place();
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, anchor, popover, align]);
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
