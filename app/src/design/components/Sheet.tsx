// Sheet: every dialog is this one component. On a phone shell a bottom sheet (rounded top, a grabber;
// swipe down on the grabber or the title on touch, or tap the backdrop, to close); on wider shells a
// centred panel at most 640 px wide. The switch is the shell's container query (overlays.css), never
// a prop. A title (h2) and a close button, a body that scrolls, a footer with the actions
// right-aligned (primary aqua pill, danger pill, Cancel as a text button).
// Focus moves into the sheet once, when it opens (to `initialFocus`, read then and never again, so
// typing into a field can never rerun the opening), and is trapped there; Esc closes. When the focus
// falls to the page (what had it inside went away, a toast that had it left) or anything gives it to
// the screens or the player behind (a focus given back in the full player), the sheet takes it back,
// to what had it inside when that is still there, else to the sheet itself. On close the focus goes
// back by the one rule for every surface (giveFocusBack, useFocusReturn.ts): opened and closed with
// the keyboard, to what opened it; opened or closed with a pointer, or when its opener is gone or
// disabled, to where the layer under it starts (the sheet below, else the screen's heading): never
// to the page.
// A sheet opened while another is open goes on top of it, with its own backdrop, whatever order the
// overlays slot mounts them in: the newest open sheet is the one drawn on top, the one Tab and Esc
// work in, and the one the app's shortcuts ask about (topSheet, topLayer). A list or menu still open
// when a sheet opens, by any path, closes first (closePopovers), so nothing floats over the newer
// sheet; the control that opened that list or menu counts as the sheet's opener.
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
import { trapTab } from "../lib/dom";
import { openSheets, refocus, type OpenSheet } from "../lib/layers";
import { closePopovers } from "../lib/popoverStack";
import { giveFocusBack, noteOpening } from "../lib/useFocusReturn";
import { useSwipe } from "../lib/useSwipe";
import { IconButton } from "./IconButton";

// The layer queries live with the sheet stack (layers.ts); the app asks them from here, as before.
export { behindLayer, refocusTopLayer, sheetMayOpen, topLayer, topSheet } from "../lib/layers";

/**
 * Layers a sheet may climb above the first one's (z-index 30 + layer, overlays.css): the row menu
 * and the first-launch setup (40) and the toasts (50) stay above every sheet. (A list or menu open
 * when a sheet opens closes first, so the row menu is above a sheet only when opened from it.)
 */
const MAX_LAYER = 9;

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
  const last = useRef<HTMLElement>(null);
  const [self] = useState<OpenSheet>(() => ({ panel, last }));
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
    const opening = noteOpening(held ?? document.activeElement);
    const box = panel.current;
    openSheets.open(self);
    last.current = null;
    // What has the focus inside (from the field it opens in on), so a focus taken away comes back to it.
    const onInside = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) last.current = e.target;
    };
    box?.addEventListener("focusin", onInside);
    (openFocus?.current ?? box)?.focus({ preventScroll: true });
    // The focus fell to the page from anywhere (the control that had it inside went away, a toast
    // that had it left): once the browser has settled where it went, the sheet on top takes it back,
    // so Tab and Esc keep working in it. A native listener on the document: the focusout of a node
    // React is removing never reaches React's own handlers.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      requestAnimationFrame(() => {
        const at = document.activeElement;
        if ((!at || at === document.body) && openSheets.top() === self) refocus(self);
      });
    };
    document.addEventListener("focusout", onFocusOut);
    // The sheet on top keeps the focus against anything that gives it to the screens or the player
    // behind it (a focus given back in the full player, a late focus() from anywhere): it takes it
    // back, to what had it inside. The layers drawn above sheets live in the overlays with it (a list
    // or menu opened from it, the toasts, the setup) and may have it.
    const overlays = box?.closest(".Shell-overlays");
    const onFocusIn = (e: FocusEvent) => {
      if (openSheets.top() !== self || !overlays || !(e.target instanceof Node) || overlays.contains(e.target)) return;
      refocus(self);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      box?.removeEventListener("focusin", onInside);
      const wasTop = openSheets.top() === self;
      const at = document.activeElement;
      const focusInside = !at || at === document.body || !!box?.contains(at);
      openSheets.close(self);
      // A sheet closing under the one on top leaves the focus where it is, in that one.
      if (!wasTop && !focusInside) return;
      // Opened and closed with the keyboard: what opened it, unless it is gone or disabled now
      // (Settings' Add, once its link is taken). Opened or closed with a pointer, or with its opener
      // gone: the sheet below, so Tab stays in it and Esc closes it next; with none below, the
      // screen's heading (a report whose opener went with the songs it deleted), so Space never
      // presses the opener again.
      giveFocusBack(opening);
    };
  }, [openFocus, self, last]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (panel.current) trapTab(e, panel.current);
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
