// ScreenHeader: the title of a screen (h1 on the phone, display size on the desktop) with a meta
// line (counts) and up to two icon actions; on the phone the search field and, while searching,
// the chips under it. The desktop searches from the sidebar, so the field hides there (shell.css).
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ScreenHeaderProps {
  title: string;
  /** "10 playlists", "8 results for neon". */
  meta?: ReactNode;
  /** Up to two IconButtons (or a small Button on the desktop). */
  actions?: ReactNode;
  /** A SearchField (phone only). */
  search?: ReactNode;
  /** A ChipRow under the field while searching. */
  chips?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, meta, actions, search, chips, className }: ScreenHeaderProps) {
  return (
    <header className={cx("ScreenHeader", className)}>
      <div className="ScreenHeader-row">
        <h1>{title}</h1>
        {meta != null && <span className="ScreenHeader-meta">{meta}</span>}
        {actions != null && <div className="ScreenHeader-actions">{actions}</div>}
      </div>
      {search}
      {chips}
    </header>
  );
}
