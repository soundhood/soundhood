// Sheet: every dialog is this one component. On a phone shell a bottom sheet (rounded top, a grabber;
// swipe down on the grabber or the title on touch, or tap the backdrop, to close); on wider shells a
// centred panel at most 640 px wide. The switch is the shell's container query (overlays.css), never
// a prop. A title (h2) and a close button, a body that scrolls, a footer with the actions
// right-aligned (primary aqua pill, danger pill, Cancel as a text button).
// Focus moves into the sheet and is trapped there; Esc closes; focus returns to what opened it.
// role="dialog", aria-modal, labelled by its title. Place it in the Shell's overlays slot.
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cssVars, cx } from "../lib/cx";
import { focusables } from "../lib/dom";
import { useSwipe } from "../lib/useSwipe";
import { IconButton } from "./IconButton";

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

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);

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
      <div className="Backdrop" aria-hidden="true" onClick={dismissible ? onClose : undefined} />
      <section
        ref={panel}
        className={cx("Sheet", tall && "is-tall", swipe.dragging && "is-dragging", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={cssVars({ "--drag-y": `${swipe.offset}px` })}
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
