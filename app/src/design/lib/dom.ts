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

/**
 * Puts the focus somewhere stable in the shell's main area, for when what had it is gone and no
 * sheet is left to take it: the list on screen (the row Tab would reach), else the screen header's
 * first control, else the main area's first one. Never a text field (on a phone that would open the
 * keyboard). True when the focus landed.
 */
export function focusMainArea(doc: Document = document): boolean {
  const main = doc.querySelector<HTMLElement>(".Shell-main");
  if (!main) return false;
  const shown = (el: HTMLElement) => el.getClientRects().length > 0;
  const row = [...main.querySelectorAll<HTMLElement>('[role="listbox"] [tabindex="0"]')].find(shown);
  const header = main.querySelector<HTMLElement>(".ScreenHeader");
  const controls = [...(header ? focusables(header) : []), ...focusables(main)].filter((el) => !isTypingTarget(el));
  return [row, ...controls].some((el) => focusIfAble(el));
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

/**
 * A held key is one press: true for the auto-repeated keydowns of a held Enter or Space, whose
 * browser default (a button's click) it cancels. Every control that acts on these keys ignores them,
 * so holding Enter on Remove removes one link, not every one the focus moves on to.
 */
export function heldRepeat(e: { key: string; repeat: boolean; preventDefault(): void }): boolean {
  if (!e.repeat || (e.key !== "Enter" && e.key !== " ")) return false;
  e.preventDefault();
  return true;
}

/** A button's onKeyDown that ignores a held key's repeats (heldRepeat) and hands every other key on. */
export function onePress<E extends { key: string; repeat: boolean; preventDefault(): void }>(onKeyDown?: (e: E) => void) {
  return (e: E) => {
    if (!heldRepeat(e)) onKeyDown?.(e);
  };
}
