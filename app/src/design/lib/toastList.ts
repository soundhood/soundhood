// The toasts' list, without React (Toast.tsx holds it). Every toast shown is a toast of its own,
// added as the newest: what the user caused is said every time, even in the same words (A pressed
// twice queues twice and says so twice). Only a notice that asks for it with a key stands for an
// earlier one of the same key (two starts of the app that fail the same way say it once): that one
// is shown again, with its clock started again, and moves to the newest place, where it is drawn.

export interface ToastEntry {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
  progress?: number;
  persistent?: boolean;
  /** One notice, however often it is sent: a toast with the same key stands for it. */
  key?: string;
  /** When it was last shown (ms): its 4 s count from then. */
  at: number;
}

/**
 * The list with `toast` added as the newest, as `id`, shown at `now`. When it has a key and a toast
 * of that key is in the list, that one is taken out and comes back as the newest, with the new
 * words and its clock started again; its id stays, and is the one returned.
 */
export function addToast<T extends ToastEntry>(
  list: readonly T[],
  toast: Omit<T, "id" | "at">,
  id: number,
  now: number,
): { list: readonly T[]; id: number } {
  const same = toast.key === undefined ? undefined : list.find((t) => t.key === toast.key);
  const keep = same ? same.id : id;
  return { list: [...list.filter((t) => t !== same), { ...toast, id: keep, at: now } as T], id: keep };
}
