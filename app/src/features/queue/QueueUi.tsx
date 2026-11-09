// Where the queue shows and whether it is open. On a shell wide and tall enough for the right pane
// (desktop: 1080 px wide and 600 px tall, the same limits as shell.css) the queue is the right pane,
// toggled by the player bar's queue button and Q; open or closed is remembered (store key
// "queue_pane_open"). Anywhere else (the phone, the tablet, a short window) it is a 92 % sheet, opened
// from the queue buttons of the mini player, the player bar and the full player. Ctrl+L asks before
// clearing it (a small sheet). The provider sits inside the app's shell (AppShell.tsx).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { storePromise } from "../../lib/store";

/** The settings store key: the right pane is open (the desktop). */
export const KEY_QUEUE_PANE_OPEN = "queue_pane_open";

/** Mirrors shell.css: the right pane exists from 1080 px wide and hides under 600 px tall. */
const PANE_FITS = "(min-width: 1080px) and (min-height: 600px)";

export interface QueueUi {
  /** The right pane can show (a desktop shell, tall enough). */
  paneFits: boolean;
  /** The right pane is open (remembered; shown only where it fits). */
  paneOpen: boolean;
  /** The queue sheet is open (narrower or shorter shells). */
  sheetOpen: boolean;
  /** The queue is on screen, in the pane or the sheet: the queue buttons are on. */
  shown: boolean;
  /** The queue buttons and Q: the pane where it fits, else the sheet. */
  toggle: () => void;
  closeSheet: () => void;
  /** Ctrl+L: the "Clear the queue?" sheet. */
  clearAsked: boolean;
  askClear: () => void;
  cancelClear: () => void;
}

const QueueUiContext = createContext<QueueUi | null>(null);

function matches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

export function QueueUiProvider({ children }: { children: ReactNode }) {
  const [paneFits, setPaneFits] = useState(() => matches(PANE_FITS));
  const [paneOpen, setPaneOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clearAsked, setClearAsked] = useState(false);
  // Nothing is written before the saved value was read, or the default would overwrite it.
  const loaded = useRef(false);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(PANE_FITS);
    const onChange = () => setPaneFits(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // A window grown to fit the pane takes the open sheet into the pane.
  useEffect(() => {
    if (paneFits && sheetOpen) {
      setSheetOpen(false);
      setPaneOpen(true);
    }
  }, [paneFits, sheetOpen]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const store = await storePromise;
        const open = await store.get<boolean>(KEY_QUEUE_PANE_OPEN);
        if (live && typeof open === "boolean") setPaneOpen(open);
      } catch {
        /* non-fatal: closed */
      }
      loaded.current = true;
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    void (async () => {
      try {
        const store = await storePromise;
        await store.set(KEY_QUEUE_PANE_OPEN, paneOpen);
        await store.save();
      } catch {
        /* non-fatal */
      }
    })();
  }, [paneOpen]);

  const value: QueueUi = {
    paneFits,
    paneOpen,
    sheetOpen,
    shown: paneFits ? paneOpen : sheetOpen,
    toggle: () => (paneFits ? setPaneOpen((o) => !o) : setSheetOpen((o) => !o)),
    closeSheet: () => setSheetOpen(false),
    clearAsked,
    askClear: () => setClearAsked(true),
    cancelClear: () => setClearAsked(false),
  };
  return <QueueUiContext.Provider value={value}>{children}</QueueUiContext.Provider>;
}

export function useQueueUi(): QueueUi {
  const ctx = useContext(QueueUiContext);
  if (!ctx) throw new Error("useQueueUi() needs the QueueUiProvider in AppShell");
  return ctx;
}
