// List states: Skeleton (placeholder rows while the index builds), ErrorRow (something failed and
// what to do about it) and EmptyState (nothing here yet, and the one action that helps).
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";

export interface SkeletonProps {
  rows?: number;
  /** Read out while it shows ("Loading your library"). */
  label?: string;
  className?: string;
}

/** Thumb and two lines on --bg-2 per row, a slow opacity pulse (still under reduced motion). */
export function Skeleton({ rows = 6, label = "Loading", className }: SkeletonProps) {
  return (
    <div className={cx("SkeletonList", className)} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="Skeleton" key={i} aria-hidden="true">
          <div className="Skeleton-thumb" />
          <div className="Skeleton-lines">
            <div className="Skeleton-line" />
            <div className="Skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ErrorRowProps {
  /** What failed, plainly ("Download stopped"). */
  title: string;
  /** One line saying what to do. */
  detail: string;
  onCopyLog?: () => void;
  onRetry?: () => void;
  className?: string;
}

/** A faint danger wash with a 3 px danger bar, an error icon, the text and Copy log and Retry. */
export function ErrorRow({ title, detail, onCopyLog, onRetry, className }: ErrorRowProps) {
  return (
    <div className={cx("ErrorRow", className)} role="group" aria-label={title}>
      <Icon name="error" size={24} />
      <div className="ErrorRow-text">
        <span className="ErrorRow-title">{title}</span>
        <span className="ErrorRow-detail">{detail}</span>
      </div>
      <div className="ErrorRow-actions">
        {onCopyLog && <IconButton icon="copy" size={20} label="Copy log" onClick={onCopyLog} />}
        {onRetry && <IconButton icon="sync" size={20} label="Retry" onClick={onRetry} />}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  text: ReactNode;
  /** At most one action, drawn as aqua text. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** A 48 px line icon in --fg-1, an h2, one body-sm line and at most one aqua text action. */
export function EmptyState({ icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cx("EmptyState", className)}>
      <Icon name={icon} size={48} />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <Button variant="link" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
