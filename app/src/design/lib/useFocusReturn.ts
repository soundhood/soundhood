// The focus never falls to the page when a surface that held it goes: the full player, the selection
// bar, the first-launch setup. It goes back to what had it when the surface came (the button that
// opened the player, the row that started Select mode) or, when that is gone, hidden or disabled, to
// where the screen starts (focusMainArea: its heading). A sheet does the same itself (Sheet.tsx),
// with the sheet below as a step between. Nor when the screen in the main area changes under it
// (useScreenFocus): Enter on a card or a row, Back, a tab digit, Playing, a click on a card, on Back
// or on a navigation item.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { focusIfAble, focusMainArea, isTypingTarget } from "./dom";

/**
 * While `active`, `box` is a surface that may hold the focus. When it goes with the focus inside it
 * (or with the focus already fallen to the page), the focus goes back to what had it when it came,
 * else to the main area; a focus that is somewhere else by then (a sheet that opened) stays there.
 */
export function useFocusReturn(box: RefObject<HTMLElement | null>, active = true) {
  useLayoutEffect(() => {
    if (!active) return;
    const el = box.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const at = document.activeElement;
      if (at && at !== document.body && !el?.contains(at)) return;
      // Once the surface is out of the page and the page shows what comes back with it (the mini
      // player under the full player): the commit has finished by then.
      queueMicrotask(() => {
        // Still in the page: not gone (React's StrictMode runs an effect's cleanup once at mount).
        if (el?.isConnected) return;
        const now = document.activeElement;
        if (now && now !== document.body) return;
        if (!focusIfAble(opener)) focusMainArea();
      });
    };
  }, [active, box]);
}

/**
 * A navigation control of the shell's frame (a sidebar item, a bottom tab, the player bar's button)
 * pressed with the pointer: no keyboard user put the focus there (it does not match :focus-visible).
 * One reached with the keyboard, the arrows in the bottom tabs among them, keeps it: that is where
 * the user is.
 */
function pointerPressedNav(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el.closest(".Shell-main") || !el.closest(".Shell-frame")) return false;
  return !isTypingTarget(el) && !el.matches(":focus-visible");
}

/**
 * `screen` names what the main area shows (a tab, an opened list, Playing). When it changes, the
 * focus goes to where the new screen starts (focusMainArea: its heading, the full player's on
 * Playing), never to a control, if it went with the old screen (the card, row or Back that had it is
 * gone, so it is on the page) or stayed on the frame's navigation item a click or tap pressed. It
 * runs once the commit has finished, after any surface that gives the focus back itself (the full
 * player) has done so. A focus that is somewhere (the search field typed in, a sidebar item reached
 * with the keyboard, a sheet) stays there.
 */
export function useScreenFocus(screen: string) {
  const seen = useRef(screen);
  useLayoutEffect(() => {
    if (seen.current === screen) return;
    seen.current = screen;
    // What had the focus as the screen changed: the control that changed it, if it is still there.
    const pressed = document.activeElement;
    queueMicrotask(() => {
      // A sheet or the setup holds the focus and gives it back itself.
      if (document.querySelector('[aria-modal="true"]')) return;
      const now = document.activeElement;
      if (!now || now === document.body || (now === pressed && pointerPressedNav(now))) focusMainArea();
    });
  }, [screen]);
}
