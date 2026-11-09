// Shell: the app's size container and its slots. Its width alone picks the layout (shell.css):
// under 720 px the phone (main, then the bottom block: mini player and tabs); 720 to 1079 the
// tablet (the rail, main, a 72 px player bar); 1080 and wider the desktop (sidebar, main, an
// optional right pane, an 80 px player bar). Overlays (sheets, toasts) sit inside the shell so
// they follow the same container queries. The shell also carries the artwork tint (--tint).
//
// RightPane: the desktop's 320 px pane under the artwork tint, holding the queue.
import type { ReactNode } from "react";
import { cssVars, cx } from "../lib/cx";

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
  return (
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
      <div className="Shell-overlays Shell-scope">{overlays}</div>
    </div>
  );
}

export interface RightPaneProps {
  /** The pane's name ("Queue"). */
  label: string;
  children: ReactNode;
  className?: string;
}

export function RightPane({ label, children, className }: RightPaneProps) {
  return (
    <aside className={cx("RightPane", className)} aria-label={label}>
      {children}
    </aside>
  );
}
