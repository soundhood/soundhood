// Links shared into the phone from another app: MainActivity.kt hands each one to
// window.__soundhoodShare (retrying until the app has defined it). A link opens "Where should this
// go?" at once when nothing stands in the way; it waits, and goes on by itself, while startup has not
// read the stored downloader switch yet (until then the switch is only a default nobody chose) and
// while the first-launch setup is up (a sheet never opens under the setup: sheetMayOpen). An open
// list or menu is no reason to wait: the sheet that opens closes it first (Sheet.tsx).
import { useEffect, useLayoutEffect, useRef } from "react";
import { sheetMayOpen } from "../design";

type SharedLinksArgs = {
  /** Startup has read the stored settings. */
  prefsLoaded: boolean;
  /** The first-launch setup is up (or about to be: startup decides it with the settings). */
  setupOpen: boolean;
  /** Takes a link (useDownloads.queueLink): false when it refused it, with a toast saying why. */
  take: (text: string) => boolean;
};

declare global {
  interface Window {
    __soundhoodShare?: (text: string) => boolean;
  }
}

export function useSharedLinks({ prefsLoaded, setupOpen, take }: SharedLinksArgs) {
  // As they are now, for the hand-over, which MainActivity calls from outside React.
  const now = useRef({ ready: false, take });
  useLayoutEffect(() => {
    now.current = { ready: prefsLoaded && !setupOpen, take };
  });
  // The newest link that is waiting (a second share while one waits replaces it, as a second
  // "Where should this go?" would).
  const held = useRef<string | null>(null);

  useEffect(() => {
    window.__soundhoodShare = (text: string) => {
      if (now.current.ready && sheetMayOpen()) return now.current.take(text);
      held.current = text;
      return true;
    };
    return () => {
      delete window.__soundhoodShare;
    };
  }, []);

  // Startup has read the settings and the setup is closed (or never showed): the waiting link goes on.
  useEffect(() => {
    const text = held.current;
    if (!prefsLoaded || setupOpen || text === null) return;
    held.current = null;
    now.current.take(text);
  }, [prefsLoaded, setupOpen]);
}
