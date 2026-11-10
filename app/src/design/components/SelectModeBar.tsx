// SelectModeBar: shown while Select mode is on. Leave Select mode, the count chosen, Select all (or
// none), the actions for the selection as icon buttons (the app's: add to playlist, remove from the
// open playlist, edit tags) and the rarer ones (the app's: move, delete) in a "more" menu. On the
// phone it replaces the screen header; on the desktop it sits above the list (the owner places it).
// Esc leaves Select mode.
import { useEffect, useEffectEvent } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import type { IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { MenuButton } from "./Menu";

export interface SelectAction {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface SelectModeBarProps {
  count: number;
  total: number;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onExit: () => void;
  actions: readonly SelectAction[];
  /** The rarer actions, in the "more" menu. */
  more?: readonly SelectAction[];
  className?: string;
}

export function SelectModeBar({ count, total, onSelectAll, onSelectNone, onExit, actions, more, className }: SelectModeBarProps) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) onExit();
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const all = total > 0 && count >= total;
  return (
    <div className={cx("SelectModeBar", className)} role="toolbar" aria-label="Selection">
      <IconButton icon="close" label="Leave Select mode" strong onClick={onExit} />
      <span className="SelectModeBar-count" aria-live="polite">
        {count} chosen
      </span>
      {/* Words where there is room, the select icon on narrower shells (shell.css visibility). */}
      <Button variant="text" small className="is-wide-only" onClick={all ? onSelectNone : onSelectAll}>
        {all ? "Select none" : "Select all"}
      </Button>
      <IconButton
        icon="select"
        label={all ? "Select none" : "Select all"}
        className="is-narrow-only"
        onClick={all ? onSelectNone : onSelectAll}
      />
      <div className="SelectModeBar-actions">
        {actions.map((a) => (
          <IconButton key={a.id} icon={a.icon} label={a.label} disabled={a.disabled || count === 0} onClick={a.onClick} />
        ))}
        {more && more.length > 0 && (
          <MenuButton
            label="More actions"
            items={more.map((a) => ({
              id: a.id,
              label: a.label,
              icon: a.icon,
              danger: a.danger,
              disabled: a.disabled || count === 0,
              onSelect: a.onClick,
            }))}
          />
        )}
      </div>
    </div>
  );
}
