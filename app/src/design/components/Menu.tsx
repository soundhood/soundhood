// MenuButton: an IconButton ("more" by default) that opens a popover menu of actions, styled like
// the Dropdown's options. Used by SelectModeBar for the rarer actions, and by any "more" button
// that holds a short list (a playlist card's Play, Shuffle, Delete playlist; the full player's song
// menu).
// ARIA menu button: the button has aria-haspopup="menu" and aria-expanded; opening moves focus to
// the menu, which tracks the active item with aria-activedescendant. Up and Down move, Home and
// End, Enter or Space runs the item (a held key runs nothing more), typed letters jump, Esc and Tab
// close; focus returns to the button. The open menu is a layer (usePopoverLayer): nothing behind it
// hears the keys heard on the window, Esc closes it first, and a sheet that opens closes it.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../lib/cx";
import { heldRepeat } from "../lib/dom";
import { isPrintable, useOutsidePress, usePopoverLayer, usePopoverPlacement, useTypeahead } from "../lib/usePopover";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** A destructive item: its icon is drawn in --danger (the words stay --fg-0). */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuButtonProps {
  /** The button's name ("More actions", "More for Glass Tides"). */
  label: string;
  items: readonly MenuItem[];
  icon?: IconName;
  size?: 20 | 24;
  defaultOpen?: boolean;
  className?: string;
}

export function MenuButton({ label, items, icon = "more", size = 24, defaultOpen, className }: MenuButtonProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(!!defaultOpen);
  const [active, setActive] = useState(0);
  const typeahead = useTypeahead(items.map((i) => i.label));
  const last = items.length - 1;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const run = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  };

  usePopoverLayer(open, menu, () => button.current, close);
  useOutsidePress(open, root, () => close(false));
  usePopoverPlacement(open, button, menu);
  useLayoutEffect(() => {
    if (open && !defaultOpen) menu.current?.focus();
  }, [open, defaultOpen]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (heldRepeat(e)) return;
    const k = e.key;
    if (k === "ArrowDown") setActive((a) => (a >= last ? 0 : a + 1));
    else if (k === "ArrowUp") setActive((a) => (a <= 0 ? last : a - 1));
    else if (k === "Home") setActive(0);
    else if (k === "End") setActive(last);
    else if (k === "Enter" || k === " ") run(active);
    // Esc: the layer closes the menu before any handler hears the key (usePopoverLayer).
    else if (k === "Tab") {
      close(true);
    } else if (isPrintable(e)) {
      const i = typeahead(k, active, e.timeStamp);
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <div className={cx("Menu", className)} ref={root}>
      <IconButton
        ref={button}
        icon={icon}
        size={size}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) close(false);
          else {
            setActive(0);
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive(e.key === "ArrowUp" ? last : 0);
            setOpen(true);
          }
        }}
      />
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="Popover"
          role="menu"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-item-${active}`}
          onKeyDown={onKeyDown}
        >
          {items.map((item, i) => (
            <div
              key={item.id}
              id={`${id}-item-${i}`}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              className={cx("Option", i === active && "is-active", item.danger && "is-danger")}
              onMouseMove={() => active !== i && setActive(i)}
              onClick={() => run(i)}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              <span className="Option-label">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
