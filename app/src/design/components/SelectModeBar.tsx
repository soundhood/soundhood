// SelectModeBar: shown while Select mode is on. Leave Select mode, the count chosen, Select all (or
// none), the actions for the selection as icon buttons (the app's: add to playlist, edit tags,
// remove from the open playlist) and the rarer ones (the app's: move, delete) in a "more" menu. On
// the phone it replaces the screen header; on the desktop it sits above the list (the owner places
// it). Esc leaves Select mode.
// Below the desktop width the bar keeps at most four buttons, so it never reads as a row of glyphs:
// Leave, two actions and More; Select all and every other action open from More there (shell.css
// visibility helpers, by width, never by platform). Which two keep a button is the owner's choice
// for the screen (`narrow`), never the selection's: a button never turns into another under a
// finger as songs are chosen; it is only disabled while the selection cannot use it. Every action
// stays reachable. When it comes and the control that had the focus is hidden under it (Select,
// where the bar takes the header's place below the desktop width), the bar itself takes the focus
// (no Tab stop, no ring): Tab goes on into its controls, Space still plays and pauses, Esc leaves.
// When it goes with the focus in it, or still on Select a pointer pressed, the focus goes by the one
// rule (useFocusReturn): back to what began Select mode (the row, Select) when the keyboard did,
// else to the screen's heading, so Space never turns Select mode on again.
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { useFocusReturn } from "../lib/useFocusReturn";
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
  /** The common actions, most used first: a button each on the desktop. */
  actions: readonly SelectAction[];
  /** The rarer actions, in the "more" menu on the desktop. */
  more?: readonly SelectAction[];
  /**
   * The ids of the two actions (from `actions` or `more`) that keep a button below the desktop
   * width, picked per screen; the first two `actions` when left out.
   */
  narrow?: readonly string[];
  className?: string;
}

/** How many actions keep their own button below the desktop width. */
const NARROW_ACTIONS = 2;

export function SelectModeBar({ count, total, onSelectAll, onSelectNone, onExit, actions, more = [], narrow, className }: SelectModeBarProps) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) onExit();
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const root = useRef<HTMLDivElement>(null);
  useFocusReturn(root);
  // After useFocusReturn has noted what had the focus: Select, hidden now under 1080 px.
  useLayoutEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body || (at instanceof HTMLElement && at.getClientRects().length === 0)) root.current?.focus({ preventScroll: true });
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
  const keep = new Set((narrow ?? actions.map((a) => a.id)).slice(0, NARROW_ACTIONS));
  const wideMore = more.map(item);
  // A rarer action the screen keeps out below the desktop width: its button shows there only.
  const narrowExtra = more.filter((a) => keep.has(a.id));
  const narrowMore: MenuItem[] = [
    { id: "select-all", label: selectLabel, icon: "select", disabled: total === 0, onSelect },
    ...[...actions, ...more].filter((a) => !keep.has(a.id)).map(item),
  ];
  const button = (a: SelectAction, className?: string) => (
    <IconButton key={a.id} icon={a.icon} label={a.label} className={className} disabled={!enabled(a)} onClick={a.onClick} />
  );

  return (
    <div ref={root} className={cx("SelectModeBar", className)} role="toolbar" aria-label="Selection" tabIndex={-1}>
      <IconButton icon="close" label="Leave Select mode" strong onClick={onExit} />
      <span className="SelectModeBar-count" aria-live="polite">
        {count} chosen
      </span>
      <Button variant="text" small className="is-wide-only" onClick={onSelect}>
        {selectLabel}
      </Button>
      <div className="SelectModeBar-actions">
        {actions.map((a) => button(a, keep.has(a.id) ? undefined : "is-wide-only"))}
        {narrowExtra.map((a) => button(a, "is-narrow-only"))}
        {wideMore.length > 0 && <MenuButton label="More actions" className="is-wide-only" items={wideMore} />}
        <MenuButton label="More actions" className="is-narrow-only" items={narrowMore} />
      </div>
    </div>
  );
}
