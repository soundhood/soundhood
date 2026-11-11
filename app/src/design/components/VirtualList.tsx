// VirtualList: renders only the rows in view, plus `overscan` above and below, for any list that can
// be long (the whole library is about 2,400 songs). No dependency.
//
// - Fixed row height: the computed --row-h of the list (56 phone, 48 desktop); rows are placed by
//   CSS from --vl-i and --row-h (lists.css), so they never animate in.
// - Scrolls inside itself, or with an ancestor (`scroller`) when the list sits under a header that
//   scrolls away with it.
// - Roving tabindex: one row is in the tab order; Up, Down, Home, End, PageUp and PageDown move it
//   (without Ctrl, Alt or Meta, which stay the app's). The active row is always rendered, even
//   when scrolled away, so focus never falls out of the list.
// - When `items` changes, the row that had the keyboard keeps it (found by key), and the first row
//   in view stays where it was on screen (rows removed or added above it shift the scroll).
// - `ref.scrollToIndex(i, align)` and `ref.focusIndex(i)` for the owner.
import {
  Fragment,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { clamp, cssVars, cx } from "../lib/cx";
import { cssPx } from "../lib/dom";

export interface VirtualRowProps {
  "data-index": number;
  tabIndex: number;
  style: CSSProperties;
  "aria-setsize": number;
  "aria-posinset": number;
  onFocus: () => void;
}

export type ScrollAlign = "start" | "center" | "nearest";

export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: ScrollAlign) => void;
  /** Moves the keyboard position to `index`, scrolls it into view and focuses it. */
  focusIndex: (index: number) => void;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  /** Spread `row` on the row's root element (TrackRow and ListRow accept it as is). */
  renderRow: (item: T, index: number, row: VirtualRowProps) => ReactNode;
  /** The list's name for assistive tech. */
  label: string;
  multiselectable?: boolean;
  overscan?: number;
  /** An ancestor that scrolls instead of the list itself. */
  scroller?: RefObject<HTMLElement | null>;
  /** Keys pressed on a row (Enter, Space, Delete, Alt+Up...), before the list's own navigation. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onActiveChange?: (index: number) => void;
  className?: string;
  ref?: Ref<VirtualListHandle>;
}

interface RowWindow {
  first: number;
  last: number;
  rowH: number;
}

export function VirtualList<T>({
  items,
  getKey,
  renderRow,
  label,
  multiselectable,
  overscan = 6,
  scroller,
  onKeyDown,
  onActiveChange,
  className,
  ref,
}: VirtualListProps<T>) {
  const outer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const n = items.length;
  const [win, setWin] = useState<RowWindow>({ first: 0, last: Math.min(n, 24) - 1, rowH: 56 });
  const [active, setActive] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const anchor = useRef<{ key: string; index: number } | null>(null);
  const activeKey = useRef<string | null>(null);
  const seenItems = useRef(items);
  /** The row element that last had focus, to notice when a change removes it. */
  const focusedRow = useRef<HTMLElement | null>(null);

  const scrollEl = (): HTMLElement | null => (scroller ? scroller.current : outer.current);
  const offsetIn = (sc: HTMLElement, b: HTMLElement) =>
    scroller ? b.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop : 0;

  const measure = useEffectEvent(() => {
    const sc = scrollEl();
    const b = body.current;
    if (!sc || !b) return;
    const rowH = cssPx(b, "--row-h", 56);
    const top = sc.scrollTop - offsetIn(sc, b);
    const firstVisible = clamp(Math.floor(top / rowH), 0, Math.max(0, n - 1));
    const lastVisible = Math.min(n - 1, Math.ceil((top + sc.clientHeight) / rowH) - 1);
    const first = Math.max(0, firstVisible - overscan);
    const last = Math.min(n - 1, lastVisible + overscan);
    anchor.current = n > 0 ? { key: getKey(items[firstVisible], firstVisible), index: firstVisible } : null;
    setWin((w) => (w.first === first && w.last === last && w.rowH === rowH ? w : { first, last, rowH }));
  });

  useLayoutEffect(() => {
    measure();
    const sc = scroller ? scroller.current : outer.current;
    if (!sc) return;
    const onScroll = () => measure();
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure());
    ro.observe(sc);
    if (body.current) ro.observe(body.current);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scroller]);

  // New items: keep the first row in view steady on screen and the keyboard on the same row.
  const itemsChanged = useEffectEvent(() => {
    if (seenItems.current === items) return;
    seenItems.current = items;
    const keys = items.map(getKey);
    const sc = scrollEl();
    const a = anchor.current;
    if (a && sc) {
      const now = keys.indexOf(a.key);
      if (now >= 0 && now !== a.index) sc.scrollTop += (now - a.index) * win.rowH;
    }
    if (activeKey.current !== null) {
      const now = keys.indexOf(activeKey.current);
      const next = now >= 0 ? now : clamp(active, 0, Math.max(0, n - 1));
      setActive(next);
      // The focused row was removed (Delete in the queue): the keyboard goes to the row now there.
      const gone = focusedRow.current && !focusedRow.current.isConnected;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (gone && lost && n > 0) pendingFocus.current = next;
    }
    measure();
  });
  useLayoutEffect(() => itemsChanged(), [items]);

  const act = clamp(active, 0, Math.max(0, n - 1));
  useLayoutEffect(() => {
    activeKey.current = n > 0 ? getKey(items[act], act) : null;
  });

  // Focus the row the keyboard moved to, once it is rendered.
  useLayoutEffect(() => {
    const i = pendingFocus.current;
    if (i === null) return;
    const el = body.current?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: true });
    }
  });

  const scrollToIndex = (index: number, align: ScrollAlign = "nearest") => {
    const sc = scrollEl();
    const b = body.current;
    if (!sc || !b || n === 0) return;
    const rowH = cssPx(b, "--row-h", win.rowH);
    const top = offsetIn(sc, b) + clamp(index, 0, n - 1) * rowH;
    const st = sc.scrollTop;
    const h = sc.clientHeight;
    let next = st;
    if (align === "start") next = top;
    else if (align === "center") next = top - (h - rowH) / 2;
    else if (top < st) next = top;
    else if (top + rowH > st + h) next = top + rowH - h;
    if (next !== st) sc.scrollTop = Math.max(0, next);
  };

  const focusIndex = (index: number) => {
    if (n === 0) return;
    const i = clamp(index, 0, n - 1);
    setActive(i);
    onActiveChange?.(i);
    scrollToIndex(i);
    const el = body.current?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (el) el.focus({ preventScroll: true });
    else pendingFocus.current = i;
  };

  useImperativeHandle(ref, () => ({ scrollToIndex, focusIndex }));

  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-index]") : null;
    const index = row ? Number(row.dataset.index) : act;
    onKeyDown?.(e, index);
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const page = Math.max(1, Math.floor((scrollEl()?.clientHeight ?? win.rowH) / win.rowH) - 1);
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: n - 1,
      PageDown: index + page,
      PageUp: index - page,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    focusIndex(moves[e.key]);
  };

  const first = Math.max(0, win.first);
  const last = Math.min(win.last, n - 1);
  const indices: number[] = [];
  for (let i = first; i <= last; i++) indices.push(i);
  if (n > 0 && act < first) indices.unshift(act);
  if (n > 0 && act > last) indices.push(act);

  const rowProps = (i: number): VirtualRowProps => ({
    "data-index": i,
    tabIndex: i === act ? 0 : -1,
    style: cssVars({ "--vl-i": i }),
    "aria-setsize": n,
    "aria-posinset": i + 1,
    onFocus: () => {
      if (i !== active) {
        setActive(i);
        onActiveChange?.(i);
      }
    },
  });

  return (
    <div ref={outer} className={cx("VirtualList", scroller && "is-inline", className)}>
      <div
        ref={body}
        className="VirtualList-body"
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiselectable || undefined}
        style={cssVars({ "--vl-count": n })}
        onKeyDown={onBodyKeyDown}
        onFocus={(e) => {
          const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-index]") : null;
          if (row) focusedRow.current = row;
        }}
      >
        {indices.map((i) => (
          <Fragment key={getKey(items[i], i)}>{renderRow(items[i], i, rowProps(i))}</Fragment>
        ))}
      </div>
    </div>
  );
}
