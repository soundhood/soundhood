// SelectModeBar: shown while Select mode is on. Leave Select mode, the count chosen, Select all (or
// none), the actions for the selection as icon buttons (the app's: add to playlist, edit tags,
// remove from the open playlist) and the rarer ones (the app's: move, delete) in a "more" menu. On
// the phone it replaces the screen header; on the desktop it sits above the list (the owner places
// it). Esc leaves Select mode.
// Below the desktop width the bar keeps at most four buttons, so it never reads as a row of glyphs:
// Leave, NARROW_ACTIONS actions and More; Select all and the other actions open from More there
// (shell.css visibility helpers, by width, never by platform). The actions that stay out are the
// first ones the selection can use, in their usual order (Remove from before a disabled Edit tags
// when two songs are chosen); disabled ones only fill the places left. Every action stays reachable.
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
  /** The common actions, most used first: below the desktop width two stay out, enabled ones first. */
  actions: readonly SelectAction[];
  /** The rarer actions, in the "more" menu. */
  more?: readonly SelectAction[];
  className?: string;
}

/** How many of `actions` keep their own button below the desktop width. */
const NARROW_ACTIONS = 2;

/**
 * Which of `actions` keep their own button below the desktop width: the first `room` that are
 * enabled, then disabled ones in order while room is left. Returned as a set; the buttons keep
 * the actions' order.
 */
function narrowPicks(actions: readonly { id: string; enabled: boolean }[], room = NARROW_ACTIONS): Set<string> {
  const ranked = [...actions.filter((a) => a.enabled), ...actions.filter((a) => !a.enabled)];
  return new Set(ranked.slice(0, room).map((a) => a.id));
}

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
  const enabled = (a: SelectAction) => !a.disabled && count > 0;
  const outNarrow = narrowPicks(actions.map((a) => ({ id: a.id, enabled: enabled(a) })));
  const wideMore = more.map(item);
  const narrowMore: MenuItem[] = [
    { id: "select-all", label: selectLabel, icon: "select", disabled: total === 0, onSelect },
    ...actions.filter((a) => !outNarrow.has(a.id)).map(item),
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
        {actions.map((a) => (
          <IconButton
            key={a.id}
            icon={a.icon}
            label={a.label}
            className={outNarrow.has(a.id) ? undefined : "is-wide-only"}
            disabled={!enabled(a)}
            onClick={a.onClick}
          />
        ))}
        {wideMore.length > 0 && <MenuButton label="More actions" className="is-wide-only" items={wideMore} />}
        <MenuButton label="More actions" className="is-narrow-only" items={narrowMore} />
      </div>
    </div>
  );
}
