// Tab from where a screen starts, when that place is out of sight. After Back, "1" or closing
// Playing onto a grid or a list scrolled down, the focus is on the screen's heading (focusMainArea),
// given without scrolling so the screen stays where it was: the heading is then above what shows.
// Tab from there would go to the header's first control and scroll the screen back to the top.
// Instead it goes to the first card, row or control in view, as if the user started from what they
// see. Tab from a heading in view, and Shift+Tab, go as usual. The Shell installs it (Shell.tsx),
// once however many mount. No React here.
import { focusables } from "./dom";

/** A screen's heading, where focusMainArea puts the focus (dom.ts). */
const START = ':is(h1, h2)[tabindex="-1"]';

/** A list's rows: one of them is in the tab order (roving tabindex), any of them may take the focus. */
const ROWS = '[role="listbox"] [role="option"][data-index]';

/** How much of `el` shows inside `box`: 2 whole, 1 in part, 0 not at all. */
function shows(el: Element, box: DOMRect): number {
  const r = el.getBoundingClientRect();
  if (r.height === 0 || r.bottom <= box.top || r.top >= box.bottom) return 0;
  return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 ? 2 : 1;
}

/**
 * The element Tab should reach from `at` (the heading or the main area itself) when the next stop
 * in the main area is out of sight: the first card, row or control after it that shows whole (else
 * in part); null when Tab may go as usual.
 */
export function tabTargetInView(main: HTMLElement, at: HTMLElement): HTMLElement | null {
  const box = main.getBoundingClientRect();
  if (at !== main && shows(at, box) === 2) return null;
  const after = (el: Element) => at === main || !!(at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const stops = focusables(main).filter(after);
  if (stops.length === 0 || shows(stops[0], box) === 2) return null;
  const rows = [...main.querySelectorAll<HTMLElement>(ROWS)].filter(after);
  const all = [...new Set([...stops, ...rows])].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return all.find((el) => shows(el, box) === 2) ?? all.find((el) => shows(el, box) === 1) ?? null;
}

let installed = 0;
let remove: (() => void) | null = null;

/** Installs the rule on the window (the first call; later ones count); the return takes it away. */
export function tabIntoView(): () => void {
  if (installed++ === 0) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const at = document.activeElement;
      const main = document.querySelector<HTMLElement>(".Shell-main");
      if (!main || !(at instanceof HTMLElement) || !(at === main || (main.contains(at) && at.matches(START)))) return;
      const target = tabTargetInView(main, at);
      if (!target) return;
      e.preventDefault();
      target.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    remove = () => window.removeEventListener("keydown", onKey);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--installed === 0) {
      remove?.();
      remove = null;
    }
  };
}
