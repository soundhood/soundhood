// Toasts: bottom centre, above the mini player or the player bar, --bg-3, body-sm text and at most
// one text action (Undo, Retry, Cancel, Settings). Each stays 4 s from when it is shown, and keeps
// the clock stopped while it is hovered or focused; persistent ones (a running download, with a
// purple progress line on the bottom edge) stay until dismissed. The stack holds two: at most two
// exist, the newest at the bottom, and a third pushes the oldest out for good (toastList.ts). Every
// toast shown is a toast of its own, the newest, even in the same words: what the user caused is
// said every time. Only a notice sent with a `key` stands for an earlier one of that key (shown
// again as the newest).
// One press guard for every action: it ignores presses for SETTLE_MS (and says so, aria-disabled)
// after its own toast came, moved (a toast added under it, the one under it gone) or changed its
// action (a download's Cancel turned Retry), never because another toast changed. A double click or
// tap aimed at one action never presses the one that came or slid under it. A download's progress
// is no change. A toast leaves before its action runs, so an action that shows a toast again (an
// Undo refused while another undo runs) pushes nothing out; a second press in its place within
// SETTLE_MS (the rest of a double click) reaches nothing behind it, and when it had the focus the
// focus goes to the sheet or setup on top, else to where the screen starts (focusMainArea), never
// to the page. role="status" (polite).
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
import { focusMainArea } from "../lib/dom";
import { addToast, type ToastEntry } from "../lib/toastList";
import { Button } from "./Button";
import { refocusTopLayer } from "./Sheet";

export interface ToastOptions {
  text: string;
  /** One text action; it ignores presses for SETTLE_MS after its toast came, moved or changed it. */
  action?: { label: string; onClick: () => void };
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
/** After its toast comes, moves or changes its action, how long the action ignores presses (ms). */
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
 * When the toast in `box` last came, moved or changed its action, and whether that was under
 * SETTLE_MS ago. Its place is measured whenever `stack` changes (a toast added or removed, words
 * changed): its top and bottom edges in the window as laid out (the stack's place plus its own in
 * the stack), so its opening animation never counts as a move. Its first measure is its coming.
 */
function usePressGuard(box: RefObject<HTMLDivElement | null>, stack: string, action: string | undefined) {
  const seen = useRef({ at: "", action: undefined as string | undefined, changedAt: 0 });
  const [changedAt, setChangedAt] = useState(0);
  const [quietAt, setQuietAt] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const list = el?.offsetParent;
    if (!el || !list) return;
    const top = list.getBoundingClientRect().top + el.offsetTop;
    const at = `${Math.round(top)} ${Math.round(top + el.offsetHeight)}`;
    if (at === seen.current.at && action === seen.current.action) return;
    seen.current = { at, action, changedAt: performance.now() };
    setChangedAt(seen.current.changedAt);
  }, [box, stack, action]);
  useEffect(() => {
    const t = setTimeout(() => setQuietAt(changedAt), SETTLE_MS);
    return () => clearTimeout(t);
  }, [changedAt]);
  return {
    /** The render that shows the change says so (aria-disabled); a timer ends it. */
    settling: changedAt !== quietAt,
    /** Asked at the press. */
    settled: () => performance.now() - seen.current.changedAt >= SETTLE_MS,
  };
}

/** The pointer and touch events a shield swallows. */
const SHIELDED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend"];
/** Where toasts closed by their own action were, and until when nothing behind them takes a press. */
const shields: { box: DOMRect; until: number }[] = [];
let shieldTimer = 0;

function pointOf(e: Event): { x: number; y: number } | null {
  if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
  if (typeof TouchEvent !== "undefined" && e instanceof TouchEvent) {
    const t = e.changedTouches[0] ?? e.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  return null;
}

/** On the window, in the capture phase: a press inside a shield reaches no handler and does nothing. */
function swallow(e: Event) {
  const p = pointOf(e);
  const now = performance.now();
  if (!p || !shields.some((s) => s.until > now && p.x >= s.box.left && p.x <= s.box.right && p.y >= s.box.top && p.y <= s.box.bottom)) return;
  if (e.cancelable) e.preventDefault();
  e.stopImmediatePropagation();
}

/**
 * A toast closed by a press on its action: for SETTLE_MS a press where it was (the second click of
 * a double click, a second tap) reaches nothing behind it, such as the song row it covered.
 */
function shield(box: DOMRect) {
  shields.push({ box, until: performance.now() + SETTLE_MS });
  if (!shieldTimer) for (const type of SHIELDED) window.addEventListener(type, swallow, { capture: true, passive: false });
  clearTimeout(shieldTimer);
  shieldTimer = window.setTimeout(() => {
    shields.length = 0;
    for (const type of SHIELDED) window.removeEventListener(type, swallow, { capture: true });
    shieldTimer = 0;
  }, SETTLE_MS + 50);
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
  const guard = usePressGuard(box, stack, toast.action?.label);
  const expire = useEffectEvent(dismiss);
  const held = hovered || focused || !!toast.persistent;

  // Gone with the focus in it (its action pressed): the focus goes to the sheet or setup on top,
  // else to where the screen starts, never to the page. The clean-up runs before its element
  // leaves the page, so the focus is still inside then.
  useLayoutEffect(() => {
    const el = box.current;
    return () => {
      if (!el?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        // Still in the page: not gone (React's StrictMode runs an effect's cleanup once at mount).
        if (el.isConnected) return;
        const now = document.activeElement;
        if (now && now !== document.body) return;
        if (!refocusTopLayer()) focusMainArea();
      });
    };
  }, []);

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
          aria-disabled={guard.settling || undefined}
          onClick={(e) => {
            // Pressed within SETTLE_MS of its toast coming, moving or changing it: aimed at what was there.
            if (!guard.settled()) return;
            // A pointer's press: the rest of a double click or tap reaches nothing behind the toast.
            if (e.detail > 0 && box.current) shield(box.current.getBoundingClientRect());
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
