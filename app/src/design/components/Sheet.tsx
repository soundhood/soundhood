// Sheet: every dialog is this one component. On a phone shell a bottom sheet (rounded top, a grabber;
// swipe down on the grabber or the title on touch, or tap the backdrop, to close); on wider shells a
// centred panel at most 640 px wide. The switch is the shell's container query (overlays.css), never
// a prop. A title (h2) and a close button, a body that scrolls, a footer with the actions
// right-aligned (primary aqua pill, danger pill, Cancel as a text button).
// Focus moves into the sheet and is trapped there; Esc closes; focus returns to what opened it, or,
// when that is gone or disabled, to the sheet below.
// A sheet opened while another is open goes on top of it, with its own backdrop, whatever order the
// overlays slot mounts them in: the newest open sheet is the one drawn on top, the one Tab and Esc
// work in, and the one the app's shortcuts ask about (topSheet). role="dialog", aria-modal, labelled
// by its title. Place it in the Shell's overlays slot.
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
import { focusIfAble, focusables } from "../lib/dom";
import { createSheetStack } from "../lib/sheetStack";
import { useSwipe } from "../lib/useSwipe";
import { IconButton } from "./IconButton";

/** An open sheet, as the stack holds it: its panel, where the focus goes when the one above closes. */
type OpenSheet = { panel: RefObject<HTMLElement | null> };

/** Every open sheet in the app, oldest first. */
const openSheets = createSheetStack<OpenSheet>();

/**
 * Layers a sheet may climb above the first one's (z-index 30 + layer, overlays.css): the row menu
 * and the first-launch setup (40) and the toasts (50) stay above every sheet.
 */
const MAX_LAYER = 9;

/** The panel of the sheet on top (the newest open one), or null while none is open. */
export function topSheet(): HTMLElement | null {
  return openSheets.top()?.panel.current ?? null;
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

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = panel.current;
    openSheets.open(self);
    (initialFocus?.current ?? box)?.focus({ preventScroll: true });
    return () => {
      const wasTop = openSheets.top() === self;
      const at = document.activeElement;
      const focusInside = !at || at === document.body || !!box?.contains(at);
      openSheets.close(self);
      // A sheet closing under the one on top leaves the focus where it is, in that one.
      if (!wasTop && !focusInside) return;
      // What opened it, unless it is gone or disabled now (Settings' Add, once its link is taken);
      // then the sheet below, so Tab stays in it and Esc closes it next.
      if (!focusIfAble(opener)) openSheets.top()?.panel.current?.focus({ preventScroll: true });
    };
  }, [initialFocus, self]);

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
