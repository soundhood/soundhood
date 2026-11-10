// Toasts: bottom centre, above the mini player or the player bar, --bg-3, body-sm text and at most
// one text action (Undo for a playlist change). Each stays 4 s, and keeps the clock stopped while
// it is hovered or focused; persistent ones (a running download, with a purple progress line on
// the bottom edge) stay until dismissed. At most two show at once, the newest at the bottom. Every
// toast shown is a toast of its own, the newest, even in the same words: what the user caused is
// said every time. Only a notice sent with a `key` stands for an earlier one of that key (shown
// again as the newest; toastList.ts). role="status" (polite).
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

const ToastContext = createContext<{ api: ToastApi; toasts: readonly Entry[] } | null>(null);

const SHOW_MS = 4000;
const MAX_VISIBLE = 2;

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
  const value = useMemo(() => ({ api, toasts }), [api, toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() needs a <ToastProvider> above it");
  return ctx.api;
}

/** Draws the newest two toasts. Put it in the Shell's overlays slot. */
export function ToastViewport() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div className="Toasts" role="status" aria-live="polite">
      {ctx.toasts.slice(-MAX_VISIBLE).map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={() => ctx.api.dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, dismiss }: { toast: Entry; dismiss: () => void }) {
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
          onClick={() => {
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
