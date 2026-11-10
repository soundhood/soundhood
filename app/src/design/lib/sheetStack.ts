// The sheets that are open, oldest first (Sheet.tsx keeps one list for the whole app). The newest is
// drawn on top: an open sheet's layer is its place in this list, whatever order the overlays slot
// mounts the sheets in, so a sheet opened from another one (New playlist from the queue sheet,
// "Where should this go?" from Settings) always covers it. Only the newest takes the focus and the
// keys, and when it closes the sheet below is the next one up. No React and no DOM here.

export interface SheetStack<T> {
  /** Puts `entry` on top (a sheet that opens is the newest). */
  open(entry: T): void;
  /** Takes `entry` out, wherever it is; the sheets above it move down a layer. */
  close(entry: T): void;
  /** `entry`'s layer, 0 for the oldest open sheet; a sheet not open yet is about to be the newest. */
  layer(entry: T): number;
  /** The newest open sheet. */
  top(): T | undefined;
  /** Every open sheet, oldest first. */
  list(): readonly T[];
  /** Calls `listener` after every change; returns the call that stops it. */
  subscribe(listener: () => void): () => void;
}

export function createSheetStack<T>(): SheetStack<T> {
  let entries: readonly T[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    open(entry) {
      entries = [...entries.filter((e) => e !== entry), entry];
      changed();
    },
    close(entry) {
      if (!entries.includes(entry)) return;
      entries = entries.filter((e) => e !== entry);
      changed();
    },
    layer(entry) {
      const i = entries.indexOf(entry);
      return i < 0 ? entries.length : i;
    },
    top() {
      return entries[entries.length - 1];
    },
    list() {
      return entries;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
