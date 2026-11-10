// Toasts: bottom centre, above the mini player or the player bar, --bg-3, body-sm text and at most
// one text action (Undo for a playlist change). Each stays 4 s from when it is shown, and keeps the
// clock stopped while it is hovered or focused; persistent ones (a running download, with a purple
// progress line on the bottom edge) stay until dismissed. The stack holds two: at most two exist,
// the newest at the bottom, and a third pushes the oldest out for good (toastList.ts). Every toast
// shown is a toast of its own, the newest, even in the same words: what the user caused is said
// every time. Only a notice sent with a `key` stands for an earlier one of that key (shown again as
// the newest). An Undo ignores presses for SETTLE_MS after its own toast moved or came (a toast
// added under it, or the one under it gone): a double click on an older toast's Undo must not press
// the newer one's, slid under the pointer. A toast that did not move takes a press at once, and a
// download's Cancel and Retry always do. A toast leaves before its action runs, so an action that
// shows a toast again (an Undo refused while another undo runs) pushes nothing out. role="status"
// (polite).
//
//   <ToastProvider>              holds the toasts (wrap the app)
//     <Shell overlays={<ToastViewport />} ... />   draws them inside the shell
//   const toast = useToast();  const id = toast.show({ text, action }); toast.update(id, {...}); toast.dismiss(id);
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cssVars } from "../lib/cx";
import { addToast, type ToastEntry } from "../lib/toastList";
import { Button } from "./Button";

export interface ToastOptions {
  text: string;
  /**
   * One text action. `guarded`: an Undo, whose presses are ignored for SETTLE_MS after its toast
   * moved or came (a press aimed at the toast that was there must not undo this change). Never on a
   * download's Cancel or Retry.
   */
  action?: { label: string; onClick: () => void; guarded?: boolean };
  /** 0..1: draws the progress line (a download). */
  progress?: number;
  /** Stays until dismissed (or updated to persistent: false). */
  persistent?: boolean;
  /**
   * One notice however often it is sent (the unreadable settings at startup): a toast with the same
   * key stands for the earlier one, which comes back as the newest. Never for what the user caused.
   */
  key?: string;
}

export interface ToastApi {
  show: (toast: ToastOptions) => number;
  update: (id: number, patch: Partial<ToastOptions>) => void;
  dismiss: (id: number) => void;
}

type Entry = ToastEntry & ToastOptions;

const ToastContext = createContext<{ toasts: readonly Entry[]; api: ToastApi } | null>(null);

const SHOW_MS = 4000;
/** After its toast moves or comes, how long an Undo ignores presses (ms). */
export const SETTLE_MS = 400;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Entry[]>([]);
  // The list as the calls left it, so show() can answer with the id of the toast that shows (a new
  // one, or the earlier one of the same key).
  const list = useRef<readonly Entry[]>([]);
  const next = useRef(1);
  const api = useMemo<ToastApi>(() => {
    const set = (to: readonly Entry[]) => {
      list.current = to;
      setToasts(to);
    };
    return {
      show(toast) {
        const out = addToast<Entry>(list.current, toast, next.current++, Date.now());
        set(out.list);
        return out.id;
      },
      update(id, patch) {
        set(list.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      },
      dismiss(id) {
        set(list.current.filter((x) => x.id !== id));
      },
    };
  }, []);
  const value = useMemo(() => ({ toasts, api }), [api, toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() needs a <ToastProvider> above it");
  return ctx.api;
}

/** Draws the toasts (two at most). Put it in the Shell's overlays slot. */
export function ToastViewport() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  // What places a toast: the toasts in the stack, in order, and their words (their height).
  const stack = ctx.toasts.map((t) => `${t.id} ${t.text}`).join(" | ");
  return (
    <div className="Toasts" role="status" aria-live="polite">
      {ctx.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} stack={stack} dismiss={() => ctx.api.dismiss(t.id)} />
      ))}
    </div>
  );
}

/**
 * When the toast in `box` last moved or came, and whether that was under SETTLE_MS ago. Its place
 * is measured whenever `stack` changes (a toast added or removed, words changed): its top and
 * bottom edges in the window as laid out (the stack's place plus its own in the stack), so its
 * opening animation never counts as a move.
 */
function usePlaceChange(box: RefObject<HTMLDivElement | null>, stack: string) {
  const place = useRef({ at: "", movedAt: 0 });
  const [movedAt, setMovedAt] = useState(0);
  const [quietAt, setQuietAt] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const stack = el?.offsetParent;
    if (!el || !stack) return;
    const top = stack.getBoundingClientRect().top + el.offsetTop;
    const at = `${Math.round(top)} ${Math.round(top + el.offsetHeight)}`;
    if (at === place.current.at) return;
    place.current = { at, movedAt: performance.now() };
    setMovedAt(place.current.movedAt);
  }, [box, stack]);
  useEffect(() => {
    const t = setTimeout(() => setQuietAt(movedAt), SETTLE_MS);
    return () => clearTimeout(t);
  }, [movedAt]);
  return {
    /** The render that shows the move says so (aria-disabled); a timer ends it. */
    settling: movedAt !== quietAt,
    /** Asked at the press. */
    settled: () => performance.now() - place.current.movedAt >= SETTLE_MS,
  };
}

interface ToastItemProps {
  toast: Entry;
  /** The stack as it is now (ToastViewport): a change of it may move this toast. */
  stack: string;
  dismiss: () => void;
}

function ToastItem({ toast, stack, dismiss }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const place = usePlaceChange(box, stack);
  const expire = useEffectEvent(dismiss);
  const held = hovered || focused || !!toast.persistent;
  const guarded = !!toast.action?.guarded;

  // Its 4 s start again when its words change or a notice of its key is shown again (toast.at).
  useEffect(() => {
    if (held) return;
    const t = setTimeout(() => expire(), SHOW_MS);
    return () => clearTimeout(t);
  }, [held, toast.text, toast.at]);

  return (
    <div
      ref={box}
      className="Toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <Button
          variant="link"
          small
          aria-disabled={(guarded && place.settling) || undefined}
          onClick={() => {
            // An Undo pressed within SETTLE_MS of its toast moving was aimed at what was there before.
            if (guarded && !place.settled()) return;
            // The toast leaves first: an action that shows it again (a refused Undo) pushes nothing out.
            const run = toast.action?.onClick;
            dismiss();
            run?.();
          }}
        >
          {toast.action.label}
        </Button>
      )}
      {toast.progress !== undefined && (
        <div className="Toast-progress" aria-hidden="true" style={cssVars({ "--progress": toast.progress })} />
      )}
    </div>
  );
}
