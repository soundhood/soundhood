// Shell: the app's size container and its slots. Its width alone picks the layout (shell.css):
// under 720 px the phone (main, then the bottom block: mini player and tabs); 720 to 1079 the
// tablet (the rail, main, a 72 px player bar); 1080 and wider the desktop (sidebar, main, an
// optional right pane, an 80 px player bar). Overlays (sheets, toasts) sit inside the shell so
// they follow the same container queries; the overlays slot is also the layer every open popover
// is drawn in (OverlayLayer), against its button. The shell also carries the artwork tint (--tint),
// and installs the rule that a held key is one press (heldKeys.ts), the watch on how the user last
// pressed something (lastInput.ts), and Tab from an off-screen heading (mainTab.ts).
//
// RightPane: the desktop's 320 px pane under the artwork tint, holding the queue. It is a surface its
// toggle opens and closes, beside what opened it, by the one rule (useFocusReturn.ts): opened by a
// click on its toggle, the pane takes the focus itself (`tabindex="-1"`, no ring) as the selection
// bar does; closed by one, the focus goes to the screen's heading. So a toggle pressed with the
// pointer never keeps the focus for Space to press again. Q and Enter on the toggle keep theirs.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cssVars, cx } from "../lib/cx";
import { holdKeysAsOnePress } from "../lib/heldKeys";
import { watchInput } from "../lib/lastInput";
import { tabIntoView } from "../lib/mainTab";
import { OverlayLayer } from "../lib/overlayLayer";
import { useFocusReturn } from "../lib/useFocusReturn";

export interface ShellProps {
  main: ReactNode;
  /** Sidebar (rail on a tablet). */
  sidebar?: ReactNode;
  /** Right pane content (desktop only; hidden under 600 px tall). */
  right?: ReactNode;
  /** Player bar (tablet and desktop). */
  bar?: ReactNode;
  /** Phone bottom block: mini player and tabs. */
  bottom?: ReactNode;
  /** Sheets, toasts. */
  overlays?: ReactNode;
  /** The artwork tint as a CSS colour (useArtworkTint); --bg-1 when absent. */
  tint?: string;
  /** "playing" hides the phone's bottom block under the full player. */
  view?: string;
  /** Desktop sidebar width in px (200 to 320). */
  sidebarWidth?: number;
  /** Desktop sidebar collapsed to the rail. */
  sidebarCollapsed?: boolean;
  className?: string;
}

export function Shell({
  main,
  sidebar,
  right,
  bar,
  bottom,
  overlays,
  tint,
  view,
  sidebarWidth,
  sidebarCollapsed,
  className,
}: ShellProps) {
  const width = sidebarCollapsed ? "var(--rail-w)" : sidebarWidth ? `${sidebarWidth}px` : undefined;
  // The overlays slot's element, once it is in the page: the layer popovers are drawn in.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  // On the window in the capture phase: a swallowed repeat reaches no other handler.
  useLayoutEffect(() => holdKeysAsOnePress(), []);
  useLayoutEffect(() => watchInput(), []);
  useLayoutEffect(() => tabIntoView(), []);
  return (
    <OverlayLayer.Provider value={layer}>
      <div className={cx("Shell", className)} data-view={view} style={cssVars({ "--tint": tint })}>
        <div
          className={cx("Shell-frame", "Shell-scope", right != null && "has-right")}
          style={cssVars({ "--sidebar-w": width })}
        >
          {sidebar != null && <div className="Shell-sidebar">{sidebar}</div>}
          <main className="Shell-main">
            <div className="Shell-content">{main}</div>
          </main>
          {right != null && <div className="Shell-right">{right}</div>}
          {bar != null && <div className="Shell-bar">{bar}</div>}
          {bottom != null && <div className="Shell-bottom">{bottom}</div>}
        </div>
        <div ref={setLayer} className="Shell-overlays Shell-scope">
          {overlays}
        </div>
      </div>
    </OverlayLayer.Provider>
  );
}

export interface RightPaneProps {
  /** The pane's name ("Queue"). */
  label: string;
  children: ReactNode;
  className?: string;
}

export function RightPane({ label, children, className }: RightPaneProps) {
  const box = useRef<HTMLElement>(null);
  useFocusReturn(box, true, "pressed");
  return (
    <aside ref={box} className={cx("RightPane", className)} aria-label={label} tabIndex={-1}>
      {children}
    </aside>
  );
}
