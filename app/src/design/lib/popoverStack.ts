// The popovers that are open (a Dropdown's or MultiSelect's list, a MenuButton's menu, a song row's
// menu), oldest first. They are layers like the sheets (Sheet.tsx: topLayer): while one is open the
// keys heard on the window leave what is behind it alone, Esc closes it first, and a sheet that
// opens closes every one of them first, so a popover is never drawn over a newer sheet. No React
// here; usePopoverLayer (usePopover.ts) puts a popover in the list while it is open.
import { createSheetStack } from "./sheetStack";

export interface OpenPopover {
  /** The list or the menu. */
  panel: { readonly current: HTMLElement | null };
  /** The control that opened it: where the focus goes when it closes. */
  anchor: () => HTMLElement | null;
  /** Closes it; `refocus` puts the focus back on its control. */
  close: (refocus: boolean) => void;
}

/** Every open popover in the app, oldest first. */
export const openPopovers = createSheetStack<OpenPopover>();

/** The newest open popover's element, or null while none is open. */
export function topPopover(): HTMLElement | null {
  return openPopovers.top()?.panel.current ?? null;
}

/**
 * Closes every open popover outside `sheet` (a sheet is opening over them; one of its own, opened
 * with it, stays) and returns the control that opened the one the focus was in, or on, so the sheet
 * gives the focus back there when it closes; else null.
 */
export function closePopovers(sheet: HTMLElement | null): HTMLElement | null {
  const at = document.activeElement;
  let held: HTMLElement | null = null;
  const under = (p: OpenPopover) => !(sheet && p.panel.current && sheet.contains(p.panel.current));
  for (const p of [...openPopovers.list()].reverse().filter(under)) {
    const anchor = p.anchor();
    if (at && (p.panel.current?.contains(at) || anchor === at)) held ??= anchor;
    openPopovers.close(p);
    p.close(false);
  }
  return held;
}
