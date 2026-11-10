// The toasts' list, without React (Toast.tsx holds it). A toast identical to one shown a moment ago
// (the same words, no action, not a running download's) is that toast again, with its clock started
// again, never a second copy: two starts of the app that fail the same way, or a refusal pressed
// twice, say it once.

export interface ToastEntry {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
  progress?: number;
  persistent?: boolean;
  /** When it was last shown (ms): its 4 s count from then. */
  at: number;
}

/** How long a toast counts as just shown, for one with the same words. */
export const SAME_TOAST_MS = 2000;

/** A toast that can stand for another with the same words: no action, nothing running. */
const plain = (t: Omit<ToastEntry, "id" | "at">) => !t.action && !t.persistent && t.progress === undefined;

/**
 * The list with `toast` added as `id`, shown at `now`; or, when an identical one was shown less than
 * SAME_TOAST_MS ago, the list with that one shown again (its id is the one returned).
 */
export function addToast<T extends ToastEntry>(
  list: readonly T[],
  toast: Omit<T, "id" | "at">,
  id: number,
  now: number,
): { list: readonly T[]; id: number } {
  if (plain(toast)) {
    const same = list.find((t) => t.text === toast.text && plain(t) && now - t.at < SAME_TOAST_MS);
    if (same) return { list: list.map((t) => (t === same ? { ...t, at: now } : t)), id: same.id };
  }
  return { list: [...list, { ...toast, id, at: now } as T], id };
}
