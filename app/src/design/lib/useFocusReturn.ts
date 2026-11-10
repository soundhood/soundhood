// Where the focus goes when a surface that opened over a screen goes: one rule for every sheet,
// list or menu, mode, pane and screen that has an opener (Sheet.tsx, usePopover.ts, the selection
// bar, the queue pane, the full player, the first-launch setup), by how it was opened and how it was
// closed (lastInput.ts). Opened and closed with the keyboard, the focus goes back to what opened it
// (the button, the row), while that can take it. Opened or closed with a pointer (a click, a tap, a
// pen), or when its opener is gone, hidden or disabled, it goes to where the layer under it starts
// (focusLayerStart): the sheet below, else the screen's heading, never to a control, so Space stays
// play and pause instead of pressing the opener (or the toggle that closed it) again. A song row or a
// card is no control: a pointer's action on one (Ctrl+click, Shift+click, a row's own choice in
// Select mode) leaves the focus on it, so the arrows go on from there. Never to the page. Nor when
// the screen in the main area changes under it (useScreenFocus): Enter on a card or a row, Back, a
// tab digit, Playing, a click on a card, on Back or on a navigation item.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { focusIfAble, focusMainArea, isControlTarget, isTypingTarget } from "./dom";
import { focusLayerStart } from "./layers";
import { lastInput, pointerPressed } from "./lastInput";

/** How a surface was opened: what had the focus then, and whether a pointer pressed. */
export interface Opening {
  opener: HTMLElement | null;
  pointer: boolean;
}

/** Notes, as a surface opens, what opened it (`opener`: what had the focus) and with what. */
export function noteOpening(opener: Element | null): Opening {
  const el = opener instanceof HTMLElement && opener !== opener.ownerDocument.body ? opener : null;
  return { opener: el, pointer: lastInput() === "pointer" };
}

/**
 * The opener a surface that just went left the focus on by the rule: opened and closed with the
 * keyboard, by a press on that same control (the player bar's button, Enter again). A screen change
 * in that commit leaves it there (useScreenFocus), where the keyboard user is.
 */
let kept: Element | null = null;

/** Puts the focus back by the rule, for a surface opened as `o` that is going now. */
export function giveFocusBack(o: Opening): void {
  if (!o.pointer && lastInput() === "keyboard" && focusIfAble(o.opener)) return;
  focusLayerStart();
}

/**
 * While `active`, `box` is a surface that may hold the focus (or leave it on its opener: a click
 * keeps the focus on the button pressed). When it goes with the focus inside it, fallen to the page,
 * on its opener a pointer pressed (or the keyboard pressed, and a pointer closed it), or on the
 * control a pointer just pressed to close it (a toggle), the focus goes back by the rule
 * (giveFocusBack). A focus that is somewhere else by then stays there: a sheet that opened, a field
 * clicked, a song row or card a pointer chose (the opener of Select mode a Ctrl+click began).
 * `take`: a surface that stays beside what opened it and can hold the focus itself (the selection
 * bar, the queue pane; `tabindex="-1"`, no ring). As it comes it takes the focus when that sits on a
 * control a pointer pressed (Select or Queue clicked), so Space plays and pauses and never presses
 * that control again; an opener the keyboard pressed keeps it. With `take` true (the selection bar)
 * it also takes a focus fallen to the page or on an opener hidden under it.
 */
export function useFocusReturn(box: RefObject<HTMLElement | null>, active = true, take: boolean | "pressed" = false) {
  const noted = useRef<Opening>({ opener: null, pointer: false });
  useLayoutEffect(() => {
    if (!active) return;
    const el = box.current;
    const had = document.activeElement;
    // What had the focus as the surface came. StrictMode runs this twice at mount, the second time
    // after the surface may have taken the focus itself (the selection bar): that is not its opener.
    if (!(had && el?.contains(had))) noted.current = noteOpening(had);
    const opening = noted.current;
    if (take && el && !(had && el.contains(had))) {
      const gone = !had || had === document.body || (had instanceof HTMLElement && had.getClientRects().length === 0);
      // The control a click or tap just pressed to open it (not one a pointer pressed long ago, met
      // by a window resize that shows the pane).
      const pressed = !!had && isControlTarget(had) && pointerPressed(had);
      if (pressed || (take === true && gone)) el.focus({ preventScroll: true });
    }
    const ours = (at: Element | null) => {
      if (!at || at === document.body || !!el?.contains(at)) return true;
      // A song row or a card a pointer chose keeps it; so does anything else that is not a control.
      if (!isControlTarget(at)) return false;
      if (at === opening.opener) return opening.pointer || lastInput() === "pointer";
      return pointerPressed(at);
    };
    return () => {
      const at = document.activeElement;
      if (!ours(at)) {
        if (at && !opening.pointer && lastInput() === "keyboard" && at === opening.opener) {
          kept = at;
          setTimeout(() => {
            if (kept === at) kept = null;
          });
        }
        return;
      }
      // Once the surface is out of the page and the page shows what comes back with it (the mini
      // player under the full player): the commit has finished by then.
      queueMicrotask(() => {
        // Still in the page: not gone (React's StrictMode runs an effect's cleanup once at mount).
        if (el?.isConnected) return;
        if (!ours(document.activeElement)) return;
        giveFocusBack(opening);
      });
    };
  }, [active, box, take]);
}

/**
 * A navigation control of the shell's frame (a sidebar item, a bottom tab, the player bar's button)
 * pressed with a pointer: a click or tap leaves the focus there, even on one a keyboard user had
 * reached before. One pressed with the keyboard, the arrows in the bottom tabs among them, keeps it:
 * that is where the user is.
 */
function pointerPressedNav(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el.closest(".Shell-main") || !el.closest(".Shell-frame")) return false;
  return !isTypingTarget(el) && lastInput() === "pointer";
}

/**
 * `screen` names what the main area shows (a tab, an opened list, Playing). When it changes, the
 * focus goes to where the new screen starts (focusMainArea: its heading, the full player's on
 * Playing), never to a control, if it went with the old screen (the card, row or Back that had it is
 * gone, so it is on the page) or stayed on the frame's navigation item a click or tap pressed. It
 * runs once the commit has finished, after any surface that gives the focus back itself (the full
 * player) has done so. A focus that is somewhere (the search field typed in, a sidebar item reached
 * with the keyboard, a sheet, the button a keyboard-opened Playing was closed with) stays there.
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
      if (now && now === kept) return;
      if (!now || now === document.body || (now === pressed && pointerPressedNav(now))) focusMainArea();
    });
  }, [screen]);
}
