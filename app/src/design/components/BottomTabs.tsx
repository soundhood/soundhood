// BottomTabs (phone): four tabs, 56 px plus the bottom inset, on --bg-0 with a line on top. Icon
// over a caption label; the active tab aqua, with a short aqua bar on the top edge that slides to it
// (--tab-index). No pills. A tab can be disabled (Playing while nothing plays).
// ARIA tabs: role="tablist", role="tab" with aria-selected and roving tabindex; Left and Right move,
// Home and End. Keys 1 to 4 switch tabs from a hardware keyboard while the tabs are on screen and
// no text field has the keyboard.
import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from "react";
import { cssVars, cx } from "../lib/cx";
import { isTypingTarget } from "../lib/dom";
import { Icon, type IconName } from "./Icon";

export interface Tab<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
  disabled?: boolean;
}

export interface BottomTabsProps<Id extends string> {
  tabs: readonly Tab<Id>[];
  /** The current tab; null when the screen is none of them (search). */
  current: Id | null;
  onChange: (id: Id) => void;
  /** Listen for 1 to 4 (default on). */
  numberKeys?: boolean;
  className?: string;
}

export function BottomTabs<Id extends string>({ tabs, current, onChange, numberKeys = true, className }: BottomTabsProps<Id>) {
  const root = useRef<HTMLDivElement>(null);
  const index = tabs.findIndex((t) => t.id === current);

  const go = (i: number, focus: boolean) => {
    const t = tabs[i];
    if (!t || t.disabled) return;
    onChange(t.id);
    if (focus) root.current?.querySelectorAll<HTMLElement>("[role=tab]")[i]?.focus();
  };

  const onGlobalKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (!numberKeys || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    const el = root.current;
    if (!el || el.getClientRects().length === 0) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= tabs.length) {
      e.preventDefault();
      go(n - 1, false);
    }
  });
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => onGlobalKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === (e.target as HTMLElement).dataset.tab);
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    const pos = enabled.indexOf(at);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    go(next, true);
  };

  return (
    <div
      ref={root}
      className={cx("BottomTabs", index < 0 && "is-none", className)}
      role="tablist"
      aria-label="Sections"
      style={cssVars({ "--tab-index": Math.max(0, index) })}
      onKeyDown={onKeyDown}
    >
      <span className="BottomTabs-indicator" aria-hidden="true" />
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          className="BottomTabs-tab"
          aria-selected={i === index}
          tabIndex={i === index || (index < 0 && i === 0) ? 0 : -1}
          disabled={t.disabled}
          onClick={() => go(i, false)}
        >
          <Icon name={t.icon} size={24} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
