// Toasts: bottom centre, above the mini player or the player bar, --bg-3, body-sm text and at most
// one text action (Undo for a playlist change). Each stays 4 s from when it is shown, and keeps the
// clock stopped while it is hovered or focused; persistent ones (a running download, with a purple
// progress line on the bottom edge) stay until dismissed. The stack holds two: at most two exist,
// the newest at the bottom, and a third pushes the oldest out for good (toastList.ts). Every toast
// shown is a toast of its own, the newest, even in the same words: what the user caused is said
// every time. Only a notice sent with a `key` stands for an earlier one of that key (shown again as
// the newest). For SETTLE_MS after the stack moves (a toast added or removed) the actions ignore
// presses: a double click on an older toast's Undo must not press the newer one's, slid under the
// pointer. role="status" (polite).
//
//   <ToastProvider>              holds the toasts (wrap the app)
//     <Shell overlays={<ToastViewport />} ... />   draws them inside the shell
//   const toast = useToast();  const id = toast.show({ text, action }); toast.update(id, {...}); toast.dismiss(id);
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cssVars } from "../lib/cx";
import { addToast, type ToastEntry } from "../lib/toastList";
import { Button } from "./Button";

export interface ToastOptions {
  text: string;
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

interface ToastState {
  toasts: readonly Entry[];
  /** When the stack last moved (performance.now()): a toast added or removed. */
  movedAt: number;
}

const ToastContext = createContext<(ToastState & { api: ToastApi; lastMove: () => number }) | null>(null);

const SHOW_MS = 4000;
/** After the stack moves, how long its actions ignore presses (ms). */
export const SETTLE_MS = 400;

const sameIds = (a: readonly Entry[], b: readonly Entry[]) => a.length === b.length && a.every((t, i) => t.id === b[i].id);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState>({ toasts: [], movedAt: 0 });
  // The list as the calls left it, so show() can answer with the id of the toast that shows (a new
  // one, or the earlier one of the same key); and when it last moved, which a press asks at once.
  const list = useRef<readonly Entry[]>([]);
  const moved = useRef(0);
  const next = useRef(1);
  const api = useMemo<ToastApi>(() => {
    const set = (to: readonly Entry[]) => {
      if (!sameIds(list.current, to)) moved.current = performance.now();
      list.current = to;
      setState({ toasts: to, movedAt: moved.current });
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
  const value = useMemo(() => ({ ...state, api, lastMove: () => moved.current }), [api, state]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() needs a <ToastProvider> above it");
  return ctx.api;
}

/**
 * True for SETTLE_MS after the stack moved at `movedAt`: the render that shows the move says so, and
 * a timer ends it.
 */
function useSettling(movedAt: number): boolean {
  const [settled, setSettled] = useState(movedAt);
  useEffect(() => {
    const t = setTimeout(() => setSettled(movedAt), SETTLE_MS);
    return () => clearTimeout(t);
  }, [movedAt]);
  return settled !== movedAt;
}

/** Draws the toasts (two at most). Put it in the Shell's overlays slot. */
export function ToastViewport() {
  const ctx = useContext(ToastContext);
  const settling = useSettling(ctx?.movedAt ?? 0);
  if (!ctx) return null;
  // A press within SETTLE_MS of a move was aimed at what was there before it.
  const pressable = () => performance.now() - ctx.lastMove() >= SETTLE_MS;
  return (
    <div className="Toasts" role="status" aria-live="polite">
      {ctx.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} settling={settling} pressable={pressable} dismiss={() => ctx.api.dismiss(t.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Entry;
  /** The stack moved a moment ago: the action says it is not pressable yet (aria-disabled). */
  settling: boolean;
  /** Asked at the press: false while the stack is still settling. */
  pressable: () => boolean;
  dismiss: () => void;
}

function ToastItem({ toast, settling, pressable, dismiss }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expire = useEffectEvent(dismiss);
  const held = hovered || focused || !!toast.persistent;

  // Its 4 s start again when its words change or a notice of its key is shown again (toast.at).
  useEffect(() => {
    if (held) return;
    const t = setTimeout(() => expire(), SHOW_MS);
    return () => clearTimeout(t);
  }, [held, toast.text, toast.at]);

  return (
    <div
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
          aria-disabled={settling || undefined}
          onClick={() => {
            if (!pressable()) return;
            toast.action?.onClick();
            dismiss();
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
