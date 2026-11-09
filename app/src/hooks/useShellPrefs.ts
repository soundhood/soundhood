// What the shell remembers between starts: the desktop sidebar's width and whether it is folded to
// the rail. Read once at start; written a moment after the last change (dragging the edge changes
// the width many times a second).
import { useEffect, useRef, useState } from "react";
import { KEY_SIDEBAR_COLLAPSED, KEY_SIDEBAR_WIDTH, storePromise } from "../lib/store";

export type ShellPrefs = ReturnType<typeof useShellPrefs>;

const DEFAULT_WIDTH = 240;

export function useShellPrefs() {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Nothing is written before the saved values were read, or the defaults would overwrite them.
  const loaded = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const store = await storePromise;
        const w = await store.get<number>(KEY_SIDEBAR_WIDTH);
        const c = await store.get<boolean>(KEY_SIDEBAR_COLLAPSED);
        if (!live) return;
        if (typeof w === "number" && Number.isFinite(w)) setSidebarWidth(Math.min(320, Math.max(200, Math.round(w))));
        if (typeof c === "boolean") setSidebarCollapsed(c);
      } catch {
        /* non-fatal: the defaults stay */
      }
      loaded.current = true;
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(async () => {
      try {
        const store = await storePromise;
        await store.set(KEY_SIDEBAR_WIDTH, sidebarWidth);
        await store.set(KEY_SIDEBAR_COLLAPSED, sidebarCollapsed);
        await store.save();
      } catch {
        /* non-fatal */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [sidebarWidth, sidebarCollapsed]);

  return { sidebarWidth, setSidebarWidth, sidebarCollapsed, setSidebarCollapsed };
}
