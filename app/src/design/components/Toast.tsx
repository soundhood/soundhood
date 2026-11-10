// Toasts: bottom centre, above the mini player or the player bar, --bg-3, body-sm text and at most
// one text action (Undo, Retry, Cancel, Settings). Each stays 4 s from when it is shown, and keeps
// the clock stopped while it is hovered or focused; persistent ones (a running download, with a
// purple progress line on the bottom edge) stay until dismissed. The stack holds two: at most two
// exist, the newest at the bottom, and a third pushes the oldest out for good (toastList.ts). Every
// toast shown is a toast of its own, the newest, even in the same words: what the user caused is
// said every time. Only a notice sent with a `key` stands for an earlier one of that key (shown
// again as the newest).
// One press guard for every action (usePressGuard): it ignores presses until SETTLE_MS after its
// latest change, and says so (aria-disabled): its own toast came, moved (a toast added under it, the
// one under it gone) or changed its action (a download's Cancel turned Retry); never another toast's
// change, never a download's progress. So a double click or tap aimed at one action never presses
// the one that came or slid under it. One bounded relief, so moves cannot starve it: someone who
// keeps pressing it (deliberate presses it ignored, the first REPRESS_MS ago or more, none more than
// RUN_GAP_MS apart) while it keeps moving (twice or more since the first) is taken at the next
// deliberate press, despite the move; never within SETTLE_MS of its toast coming or its action
// changing. A deliberate press is a click or tap that starts a click sequence, a key, or a later
// click of a sequence that started on this same action; the later clicks of a sequence begun
// elsewhere (a double click on the song row a toast came over) never press it.
// A toast leaves before its action runs, so an action that shows a toast again (an Undo refused while
// another undo runs) pushes nothing out. Once a pointer's press acted on it, the rest of that click
// sequence reaches nothing: its later clicks (detail 2 and on, counted by the system with the user's
// own double-click time) act on no toast and on nothing behind, and any press in its place within
// SETTLE_MS is swallowed too. A sequence whose presses it ignored is not swallowed. When it had the
// focus the focus goes to the sheet or setup on top, else to where the screen starts
// (focusMainArea), never to the page. role="status" (polite).
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
  /** One text action; it ignores presses until SETTLE_MS after its toast came, moved or changed it. */
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
/** The relief: how long someone has kept pressing an action it ignored before a move is let pass (ms). */
export const REPRESS_MS = 500;
/** The relief: presses it ignored further apart than this are not someone pressing it (ms). */
export const RUN_GAP_MS = 2000;
/** The longest double-click time a system allows (Windows caps it at 5 s): a click sequence ends by then. */
const SEQUENCE_MAX_MS = 5000;

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
  // Installed before any shield's listener, so a press inside a shield still starts a sequence.
  useEffect(() => watchSequences(), []);
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
 * The press guard of the action in `box`. Every change arms it again, for SETTLE_MS from that change:
 * its coming, a change of its action, and a move (its place is measured whenever `stack` changes, a
 * toast added or removed, words changed: its top and bottom edges in the window as laid out, the
 * stack's place plus its own in the stack, so its opening animation never counts). The relief takes
 * a deliberate press despite a move when someone has kept pressing it (the presses it ignored began
 * REPRESS_MS ago or more, each within RUN_GAP_MS of the last) while it kept moving (twice or more
 * since the first of them), and its coming and its action's latest change are SETTLE_MS old.
 */
function usePressGuard(box: RefObject<HTMLDivElement | null>, stack: string, action: string | undefined) {
  const seen = useRef({
    at: "",
    action: undefined as string | undefined,
    /** Its latest change of any kind, and its coming or its action's latest change. */
    changedAt: 0,
    fixedAt: 0,
    moves: 0,
    /** The presses it ignored lately: the first and the last, and how many moves it had made then. */
    runFrom: -Infinity,
    runLast: -Infinity,
    runMoves: 0,
  });
  const [armedAt, setArmedAt] = useState(0);
  const [quietAt, setQuietAt] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const list = el?.offsetParent;
    if (!el || !list) return;
    const top = list.getBoundingClientRect().top + el.offsetTop;
    const at = `${Math.round(top)} ${Math.round(top + el.offsetHeight)}`;
    const s = seen.current;
    if (at === s.at && action === s.action) return;
    const now = performance.now();
    if (s.at === "" || action !== s.action) s.fixedAt = now;
    else s.moves++;
    s.at = at;
    s.action = action;
    s.changedAt = now;
    setArmedAt(now);
  }, [box, stack, action]);
  useEffect(() => {
    const t = setTimeout(() => setQuietAt(armedAt), SETTLE_MS);
    return () => clearTimeout(t);
  }, [armedAt]);
  return {
    /** The render that shows the change says so (aria-disabled); a timer ends it. */
    settling: armedAt !== quietAt,
    /** Asked at a deliberate press: true when it may act; a press it ignores is noted. */
    take: () => {
      const now = performance.now();
      const s = seen.current;
      if (now - s.changedAt >= SETTLE_MS) return true;
      const pressing = now - s.runLast <= RUN_GAP_MS;
      if (pressing && now - s.runFrom >= REPRESS_MS && s.moves - s.runMoves >= 2 && now - s.fixedAt >= SETTLE_MS) return true;
      if (!pressing) {
        s.runFrom = now;
        s.runMoves = s.moves;
      }
      s.runLast = now;
      return false;
    },
  };
}

/** What the newest click sequence's first press (a mousedown of detail 1, a tap's too) landed on. */
let sequenceStart: EventTarget | null = null;
let watchingSequences = 0;
const noteSequence = (e: MouseEvent) => {
  if (e.detail <= 1) sequenceStart = e.target;
};

/** Watches where click sequences start while the toasts are drawn (ToastViewport); returns the stop. */
function watchSequences(): () => void {
  if (watchingSequences++ === 0) window.addEventListener("mousedown", noteSequence, true);
  return () => {
    if (--watchingSequences === 0) window.removeEventListener("mousedown", noteSequence, true);
  };
}

/** True when the click sequence `el` is clicked in started on `el`: its first press landed there. */
function startedOn(el: Element): boolean {
  return sequenceStart instanceof Node && el.contains(sequenceStart);
}

/** The pointer and touch events a shield swallows. */
const SHIELDED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend"];
/** The events that count the clicks of a sequence in `detail` (pointer and touch events carry 0). */
const COUNTED = new Set(["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]);
/** Where toasts closed by their own action were, and until when nothing behind them takes a press. */
const shields: { box: DOMRect; until: number }[] = [];
/**
 * Until when the click sequence that began with a press on a toast's action is still open: its
 * later clicks reach nothing. A press that starts a new sequence (detail 1) closes it.
 */
let sequenceUntil = 0;
let shieldTimer = 0;

function pointOf(e: Event): { x: number; y: number } | null {
  if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
  if (typeof TouchEvent !== "undefined" && e instanceof TouchEvent) {
    const t = e.changedTouches[0] ?? e.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  return null;
}

/**
 * On the window, in the capture phase: the later clicks of a sequence that began on a toast's
 * action, and a press inside a shield, reach no handler and do nothing.
 */
function swallow(e: Event) {
  const now = performance.now();
  const clicks = e instanceof MouseEvent && COUNTED.has(e.type) ? e.detail : 0;
  if (e.type === "mousedown" && clicks <= 1) sequenceUntil = 0;
  const later = clicks >= 2 && sequenceUntil > now;
  const p = pointOf(e);
  const inside = !!p && shields.some((s) => s.until > now && p.x >= s.box.left && p.x <= s.box.right && p.y >= s.box.top && p.y <= s.box.bottom);
  if (!later && !inside) return;
  if (e.cancelable) e.preventDefault();
  e.stopImmediatePropagation();
}

/**
 * A toast closed by a press on its action. The rest of that click sequence (the second click of a
 * double click, a second tap, however long the user's double-click time) reaches nothing, on
 * another toast or behind; and for SETTLE_MS any press where it was reaches nothing behind it, such
 * as the song row it covered.
 */
function shield(box: DOMRect) {
  const now = performance.now();
  shields.push({ box, until: now + SETTLE_MS });
  sequenceUntil = now + SEQUENCE_MAX_MS;
  if (!shieldTimer) for (const type of SHIELDED) window.addEventListener(type, swallow, { capture: true, passive: false });
  clearTimeout(shieldTimer);
  shieldTimer = window.setTimeout(() => {
    shields.length = 0;
    sequenceUntil = 0;
    for (const type of SHIELDED) window.removeEventListener(type, swallow, { capture: true });
    shieldTimer = 0;
  }, SEQUENCE_MAX_MS + 50);
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
            // The later clicks of a click sequence begun elsewhere (a double click on the song row
            // this toast came over) are no press on it. One begun here, on a press it ignored, is.
            if (e.detail >= 2 && !startedOn(e.currentTarget)) return;
            // Pressed within SETTLE_MS of its latest change: aimed at what was there (usePressGuard).
            if (!guard.take()) return;
            // A pointer's press: the rest of its click sequence reaches nothing, here or behind.
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
