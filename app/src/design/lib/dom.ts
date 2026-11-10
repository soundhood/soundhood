// DOM helpers for focus, keyboard and placement. No React here.

/** True when keys typed now go into a text field (single-key shortcuts must stay quiet). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "range", "button", "submit", "reset"].includes(target.type);
  }
  return false;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that Tab can reach, in document order, visible ones only. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/**
 * Moves the focus to `el` when it can still take it (in the page, shown, not disabled, not inert);
 * true when the focus is there afterwards.
 */
export function focusIfAble(el: HTMLElement | null | undefined): boolean {
  if (!el?.isConnected || el === el.ownerDocument.body) return false;
  if (el.matches(":disabled") || el.closest("[inert]") || el.getClientRects().length === 0) return false;
  el.focus({ preventScroll: true });
  return el.ownerDocument.activeElement === el;
}

/** A screen's heading, which takes the focus where the screen starts (tabindex -1: no Tab stop). */
const SCREEN_HEADING = ':is(h1, h2)[tabindex="-1"]';

/**
 * Puts the focus where the screen in the shell's main area starts, for when what had it is gone (the
 * card, row or Back pressed; a sheet's opener) and no sheet is left to take it: the screen's heading
 * (ScreenHeader's, the full player's on Playing), else the main area itself while it holds the focus.
 * Never a control, so nothing the user did not choose is pressed or acted on: Space stays play and
 * pause, Ctrl+E edits the playing song, no row's More shows, and Tab leads into the screen. Without
 * scrolling: a grid scrolled back to keeps its place. True when the focus landed.
 */
export function focusMainArea(doc: Document = document): boolean {
  const main = doc.querySelector<HTMLElement>(".Shell-main");
  if (!main) return false;
  const heading = [...main.querySelectorAll<HTMLElement>(SCREEN_HEADING)].find((el) => el.getClientRects().length > 0);
  if (focusIfAble(heading)) return true;
  // No heading on screen (the selection bar in its place on a narrow shell): the main area, which is
  // no Tab stop and takes no click focus once it lets the focus go.
  if (main.hasAttribute("tabindex")) return focusIfAble(main);
  main.tabIndex = -1;
  if (focusIfAble(main)) {
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
    return true;
  }
  main.removeAttribute("tabindex");
  return false;
}

export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The part of the viewport where `el` can be seen: the viewport cut by every clipping ancestor. */
export function clipBox(el: HTMLElement): Box {
  const box: Box = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) {
      const r = p.getBoundingClientRect();
      box.top = Math.max(box.top, r.top);
      box.left = Math.max(box.left, r.left);
      box.bottom = Math.min(box.bottom, r.bottom);
      box.right = Math.min(box.right, r.right);
    }
  }
  return box;
}

/** A length custom property of `el` in px (e.g. --row-h), or `fallback` when it is not a px length. */
export function cssPx(el: Element, name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** True when the user asked for reduced motion. */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True when the target sits inside a control that handles its own pointer (buttons, fields, sliders). */
export function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("button, a, input, textarea, [role='slider']");
}
