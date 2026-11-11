// The layers over the screens, as one list for the whole app: the open sheets (Sheet.tsx puts each
// in while it is open), the first-launch setup (the one modal dialog that is not a sheet, drawn
// above every sheet), and the open lists and menus (popoverStack.ts). The keys heard on the window
// ask which layer is on top (topLayer), and a surface that goes asks where the layer under it starts
// (focusLayerStart, useFocusReturn.ts). No React here.
import type { RefObject } from "react";
import { focusIfAble, focusMainArea } from "./dom";
import { popoverIn, topPopover } from "./popoverStack";
import { createSheetStack } from "./sheetStack";

/**
 * An open sheet, as the stack holds it: its panel, where the focus goes when the one above closes,
 * and what last had the focus inside it, where the focus goes back when something took it away.
 */
export type OpenSheet = { panel: RefObject<HTMLElement | null>; last: RefObject<HTMLElement | null> };

/** Every open sheet in the app, oldest first. */
export const openSheets = createSheetStack<OpenSheet>();

/** The panel of the sheet on top (the newest open one), or null while none is open. */
export function topSheet(): HTMLElement | null {
  return openSheets.top()?.panel.current ?? null;
}

/** The first-launch setup: the one modal dialog that is not a sheet, drawn above every sheet. */
export function setupDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-modal="true"]:not(.Sheet)');
}

/** Puts the focus back in `sheet`: on what last had it inside, while that can take it, else the panel. */
export function refocus(sheet: OpenSheet) {
  const box = sheet.panel.current;
  const last = sheet.last.current;
  if (last && last !== box && box?.contains(last) && focusIfAble(last)) return;
  box?.focus({ preventScroll: true });
}

/**
 * Gives the focus back to the layer on top after it fell to the page (a toast that had it left):
 * the first-launch setup, else the sheet on top (to what had the focus in it). False when neither
 * is open, for the caller to put it where the screen starts.
 */
export function refocusTopLayer(): boolean {
  const setup = setupDialog();
  if (setup) {
    setup.focus({ preventScroll: true });
    return true;
  }
  const top = openSheets.top();
  if (!top?.panel.current) return false;
  refocus(top);
  return true;
}

/**
 * Puts the focus where the layer on top starts, never on a control in it: the first-launch setup,
 * else the sheet on top (its panel, which draws no ring), else the screen's heading (focusMainArea).
 * Where a surface that goes leaves the focus when it was opened with a pointer.
 */
export function focusLayerStart(): void {
  const setup = setupDialog();
  if (setup) {
    setup.focus({ preventScroll: true });
    return;
  }
  const sheet = topSheet();
  if (sheet) sheet.focus({ preventScroll: true });
  else focusMainArea();
}

/**
 * What is open over the screens and takes the keys: an open list or menu (a Dropdown's or
 * MultiSelect's list, a menu: popoverStack.ts), else a modal dialog that is not a sheet (the
 * first-launch setup, drawn above every sheet), else the sheet on top; null when nothing is. The
 * keys heard on the window (Ctrl+K, "/", the tab digits, Ctrl+A, the list keys) ask it before they
 * act (docs/SHORTCUTS.md).
 */
export function topLayer(): HTMLElement | null {
  const popover = topPopover();
  const setup = setupDialog();
  if (popover?.panel.current && (!setup || popoverIn(setup, popover))) return popover.panel.current;
  return setup ?? topSheet();
}

/** True when a key heard on the window must leave `el` alone: something is open over it. */
export function behindLayer(el: Element | null): boolean {
  const top = topLayer();
  return !!top && !(el && top.contains(el));
}

/**
 * True when a sheet may open now (Ctrl+comma, a pasted or shared link): always, on top of the
 * screens or of another sheet, except under the first-launch setup, which is drawn above every
 * sheet. An open list or menu is no reason to wait: the sheet closes it as it opens.
 */
export function sheetMayOpen(): boolean {
  return !setupDialog();
}
