// The focus never falls to the page when a surface that held it goes: the full player, the selection
// bar, the first-launch setup. It goes back to what had it when the surface came (the button that
// opened the player, the row that started Select mode) or, when that is gone, hidden or disabled, to
// the main area (focusMainArea). A sheet does the same itself (Sheet.tsx), with the sheet below as a
// step between.
import { useLayoutEffect, type RefObject } from "react";
import { focusIfAble, focusMainArea } from "./dom";

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
