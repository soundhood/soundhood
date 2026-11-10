// SelectModeBar: shown while Select mode is on. Leave Select mode, the count chosen, Select all (or
// none), the actions for the selection as icon buttons (the app's: add to playlist, edit tags,
// remove from the open playlist) and the rarer ones (the app's: move, delete) in a "more" menu. On
// the phone it replaces the screen header; on the desktop it sits above the list (the owner places
// it). Esc leaves Select mode.
// Below the desktop width the bar keeps at most four buttons, so it never reads as a row of glyphs:
// Leave, the first NARROW_ACTIONS actions and More; Select all and the other actions open from More
// there (shell.css visibility helpers, by width, never by platform). Every action stays reachable.
import { useEffect, useEffectEvent } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import type { IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { MenuButton, type MenuItem } from "./Menu";

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
  /** The common actions, most used first: below the desktop width only the first two stay out. */
  actions: readonly SelectAction[];
  /** The rarer actions, in the "more" menu. */
  more?: readonly SelectAction[];
  className?: string;
}

/** How many of `actions` keep their own button below the desktop width. */
const NARROW_ACTIONS = 2;

export function SelectModeBar({ count, total, onSelectAll, onSelectNone, onExit, actions, more = [], className }: SelectModeBarProps) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) onExit();
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const all = total > 0 && count >= total;
  const selectLabel = all ? "Select none" : "Select all";
  const onSelect = all ? onSelectNone : onSelectAll;
  const item = (a: SelectAction): MenuItem => ({
    id: a.id,
    label: a.label,
    icon: a.icon,
    danger: a.danger,
    disabled: a.disabled || count === 0,
    onSelect: a.onClick,
  });
  const wideMore = more.map(item);
  const narrowMore: MenuItem[] = [
    { id: "select-all", label: selectLabel, icon: "select", disabled: total === 0, onSelect },
    ...actions.slice(NARROW_ACTIONS).map(item),
    ...wideMore,
  ];

  return (
    <div className={cx("SelectModeBar", className)} role="toolbar" aria-label="Selection">
      <IconButton icon="close" label="Leave Select mode" strong onClick={onExit} />
      <span className="SelectModeBar-count" aria-live="polite">
        {count} chosen
      </span>
      <Button variant="text" small className="is-wide-only" onClick={onSelect}>
        {selectLabel}
      </Button>
      <div className="SelectModeBar-actions">
        {actions.map((a, i) => (
          <IconButton
            key={a.id}
            icon={a.icon}
            label={a.label}
            className={i >= NARROW_ACTIONS ? "is-wide-only" : undefined}
            disabled={a.disabled || count === 0}
            onClick={a.onClick}
          />
        ))}
        {wideMore.length > 0 && <MenuButton label="More actions" className="is-wide-only" items={wideMore} />}
        <MenuButton label="More actions" className="is-narrow-only" items={narrowMore} />
      </div>
    </div>
  );
}
