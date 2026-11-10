// Sheet: every dialog is this one component. On a phone shell a bottom sheet (rounded top, a grabber;
// swipe down on the grabber or the title on touch, or tap the backdrop, to close); on wider shells a
// centred panel at most 640 px wide. The switch is the shell's container query (overlays.css), never
// a prop. A title (h2) and a close button, a body that scrolls, a footer with the actions
// right-aligned (primary aqua pill, danger pill, Cancel as a text button).
// Focus moves into the sheet once, when it opens (to `initialFocus`, read then and never again, so
// typing into a field can never rerun the opening), and is trapped there; Esc closes. When what has
// the focus inside goes away (a removed row), the sheet takes it back. On close the focus returns to
// what opened it or, when that is gone or disabled, to the sheet below, else to the main area (the
// list on screen, or the screen header's first control): never to the page.
// A sheet opened while another is open goes on top of it, with its own backdrop, whatever order the
// overlays slot mounts them in: the newest open sheet is the one drawn on top, the one Tab and Esc
// work in, and the one the app's shortcuts ask about (topSheet, topLayer). A list or menu still open
// when a sheet opens, by any path, closes first (closePopovers), so nothing floats over the newer
// sheet, and the focus comes back to the control that opened it when the sheet closes.
// role="dialog", aria-modal, labelled by its title. Place it in the Shell's overlays slot.
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cssVars, cx } from "../lib/cx";
import { focusIfAble, focusMainArea, focusables } from "../lib/dom";
import { closePopovers, topPopover } from "../lib/popoverStack";
import { createSheetStack } from "../lib/sheetStack";
import { useSwipe } from "../lib/useSwipe";
import { IconButton } from "./IconButton";

/** An open sheet, as the stack holds it: its panel, where the focus goes when the one above closes. */
type OpenSheet = { panel: RefObject<HTMLElement | null> };

/** Every open sheet in the app, oldest first. */
const openSheets = createSheetStack<OpenSheet>();

/**
 * Layers a sheet may climb above the first one's (z-index 30 + layer, overlays.css): the row menu
 * and the first-launch setup (40) and the toasts (50) stay above every sheet. (A list or menu open
 * when a sheet opens closes first, so the row menu is above a sheet only when opened from it.)
 */
const MAX_LAYER = 9;

/** The panel of the sheet on top (the newest open one), or null while none is open. */
export function topSheet(): HTMLElement | null {
  return openSheets.top()?.panel.current ?? null;
}

/** The first-launch setup: the one modal dialog that is not a sheet, drawn above every sheet. */
function setupDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-modal="true"]:not(.Sheet)');
}

/**
 * What is open over the screens and takes the keys: an open list or menu (a Dropdown's or
 * MultiSelect's list, a menu: popoverStack.ts), else a modal dialog that is not a sheet (the
 * first-launch setup, drawn above every sheet), else the sheet on top; null when nothing is. The
 * keys heard on the window (Ctrl+K, "/", the tab digits, Ctrl+A, the list keys) ask it before they
 * act (docs/SHORTCUTS.md).
 */
export function topLayer(): HTMLElement | null {
  const popover = topPopover();
  const setup = setupDialog();
  if (popover && (!setup || setup.contains(popover))) return popover;
  return setup ?? topSheet();
}

/** True when a key heard on the window must leave `el` alone: something is open over it. */
export function behindLayer(el: Element | null): boolean {
  const top = topLayer();
  return !!top && !(el && top.contains(el));
}

/**
 * True when a sheet may open now (Ctrl+comma, a pasted or shared link): always, on top of the
 * screens or of another sheet, except under the first-launch setup, which is drawn above every
 * sheet. An open list or menu is no reason to wait: the sheet closes it as it opens.
 */
export function sheetMayOpen(): boolean {
  return !setupDialog();
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** The action buttons, primary last. */
  footer?: ReactNode;
  /** Full height (92 % on the phone): queue, settings. */
  tall?: boolean;
  closeLabel?: string;
  /** Close on a backdrop tap (default). A batch report turns it off. */
  dismissible?: boolean;
  /** Where focus goes on open; the sheet itself by default (its title is read out). */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

export function Sheet(props: SheetProps) {
  return props.open ? <SheetPanel {...props} /> : null;
}

function SheetPanel({
  onClose,
  title,
  children,
  footer,
  tall,
  closeLabel = "Close",
  dismissible = true,
  initialFocus,
  className,
}: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const swipe = useSwipe({ axis: "down", onSwipe: onClose });
  const [self] = useState<OpenSheet>(() => ({ panel }));
  const layer = Math.min(
    useSyncExternalStore(openSheets.subscribe, () => openSheets.layer(self)),
    MAX_LAYER,
  );

  // Where the focus goes on open, as it was when the sheet opened: a caller may pass another value
  // later ("Where should this go?" passes its link field only while the link is empty), and the
  // opening must not run again for it (it would move the focus out of the field being typed in).
  const [openFocus] = useState(() => initialFocus);

  useLayoutEffect(() => {
    // A list or menu still open closes first (it would float over this sheet); the control that
    // opened the one the focus was in is what opened this sheet, as far as the focus goes.
    const held = closePopovers(panel.current);
    const opener = held ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const box = panel.current;
    openSheets.open(self);
    (openFocus?.current ?? box)?.focus({ preventScroll: true });
    // The control that had the focus went away (a removed row) or the focus fell out of the sheet
    // some other way: once the browser has settled where it went, the sheet on top takes it back
    // from the page, so Tab and Esc keep working in it. A native listener: the focusout of a node
    // React is removing never reaches React's own handlers.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      requestAnimationFrame(() => {
        const at = document.activeElement;
        if ((!at || at === document.body) && openSheets.top() === self) box?.focus({ preventScroll: true });
      });
    };
    box?.addEventListener("focusout", onFocusOut);
    return () => {
      box?.removeEventListener("focusout", onFocusOut);
      const wasTop = openSheets.top() === self;
      const at = document.activeElement;
      const focusInside = !at || at === document.body || !!box?.contains(at);
      openSheets.close(self);
      // A sheet closing under the one on top leaves the focus where it is, in that one.
      if (!wasTop && !focusInside) return;
      // What opened it, unless it is gone or disabled now (Settings' Add, once its link is taken);
      // then the sheet below, so Tab stays in it and Esc closes it next; with none below, the main
      // area (a report whose opener went with the songs it deleted).
      if (focusIfAble(opener)) return;
      const below = openSheets.top()?.panel.current;
      if (below) below.focus({ preventScroll: true });
      else focusMainArea();
    };
  }, [openFocus, self]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div
        className="Backdrop"
        aria-hidden="true"
        style={cssVars({ "--sheet-layer": layer })}
        onClick={dismissible ? onClose : undefined}
      />
      <section
        ref={panel}
        className={cx("Sheet", tall && "is-tall", swipe.dragging && "is-dragging", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={cssVars({ "--drag-y": `${swipe.offset}px`, "--sheet-layer": layer })}
        onKeyDown={onKeyDown}
      >
        <div className="Sheet-top" {...swipe.handlers}>
          <div className="Sheet-grabber" aria-hidden="true" />
          <div className="Sheet-head">
            <h2 id={titleId}>{title}</h2>
            <IconButton icon="close" label={closeLabel} onClick={onClose} />
          </div>
        </div>
        <div className="Sheet-body">{children}</div>
        {footer && <div className="Sheet-foot">{footer}</div>}
      </section>
    </>
  );
}
