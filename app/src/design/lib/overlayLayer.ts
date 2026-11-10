// The shell's overlay layer (Shell.tsx: the overlays slot) as a context: where an open popover (a
// Dropdown's or MultiSelect's list, a menu, a song row's menu) is drawn, so no sheet body or pane
// that scrolls can clip it. Null outside a shell (a fixture page), where a popover is drawn in place.
import { createContext, useContext } from "react";

export const OverlayLayer = createContext<HTMLElement | null>(null);

/** The overlay layer of the shell this component is in, or null outside one. */
export function useOverlayLayer(): HTMLElement | null {
  return useContext(OverlayLayer);
}
