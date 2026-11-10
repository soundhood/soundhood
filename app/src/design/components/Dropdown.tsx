// Dropdown and MultiSelect: a button that shows the value and a chevron and opens a popover listbox
// of 36 px options; the chosen option has an aqua tick. Never a native <select>.
// ARIA: the button is a select-only combobox (aria-expanded, aria-controls, aria-activedescendant);
// the popover is a listbox of options with aria-selected. Focus stays on the button the whole time,
// so it is where focus is after closing. Keys: Up and Down move (and open), Home and End, Enter or
// Space picks (a held key picks once), Esc and Tab close, typed letters jump to the first option
// starting with them. MultiSelect keeps the popover open and toggles; its button reads "None", one
// name or "N chosen". The open list is a layer (usePopoverLayer): nothing behind it hears the keys
// heard on the window, Esc closes it first, and a sheet that opens closes it. It is drawn in the
// shell's overlay layer against its button (usePopoverPlacement), so a sheet body or pane that
// scrolls never clips it: every option can be scrolled to, seen and picked.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { heldRepeat } from "../lib/dom";
import { useOverlayLayer } from "../lib/overlayLayer";
import { isPrintable, useOutsidePress, usePopoverLayer, usePopoverPlacement, useTypeahead } from "../lib/usePopover";
import { Icon } from "./Icon";

export interface DropdownOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface ListboxProps {
  /** Name of the control, for assistive tech (the settings row label). */
  label: string;
  labels: readonly string[];
  disabledAt: (i: number) => boolean;
  selectedAt: (i: number) => boolean;
  firstSelected: number;
  multi: boolean;
  text: string;
  pick: (i: number) => void;
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
}

function Listbox({
  label,
  labels,
  disabledAt,
  selectedAt,
  firstSelected,
  multi,
  text,
  pick,
  defaultOpen,
  disabled,
  className,
}: ListboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(!!defaultOpen);
  const [active, setActive] = useState(defaultOpen ? Math.max(0, firstSelected) : -1);
  const typeahead = useTypeahead(labels);
  const layer = useOverlayLayer();
  const last = labels.length - 1;

  const show = (at: number) => {
    setOpen(true);
    setActive(Math.min(Math.max(0, at), last));
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const choose = (i: number) => {
    if (i < 0 || disabledAt(i)) return;
    pick(i);
    if (!multi) close();
  };

  // In the shell's overlay layer; in place outside a shell (a fixture page).
  const place = (list: ReactNode) => (layer ? createPortal(list, layer) : list);

  usePopoverLayer(open, popover, () => button.current, close);
  useOutsidePress(open, [root, popover], () => close());
  usePopoverPlacement(open, root, popover, { onLost: () => close() });
  // Keep the active option in view inside the popover (never scrolls the page).
  useLayoutEffect(() => {
    const p = popover.current;
    const o = p?.children[active] as HTMLElement | undefined;
    if (!open || !p || !o) return;
    if (o.offsetTop < p.scrollTop) p.scrollTop = o.offsetTop;
    else if (o.offsetTop + o.offsetHeight > p.scrollTop + p.clientHeight) {
      p.scrollTop = o.offsetTop + o.offsetHeight - p.clientHeight;
    }
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (heldRepeat(e)) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "Enter" || k === " ") show(firstSelected);
      else if (k === "ArrowUp") show(firstSelected >= 0 ? firstSelected : last);
      else if (isPrintable(e)) {
        const i = typeahead(k, firstSelected, e.timeStamp);
        show(i >= 0 ? i : firstSelected);
      } else return;
      e.preventDefault();
      return;
    }
    if (k === "ArrowDown") setActive((a) => Math.min(last, a + 1));
    else if (k === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (k === "Home" || k === "PageUp") setActive(0);
    else if (k === "End" || k === "PageDown") setActive(last);
    else if (k === "Enter" || k === " ") choose(active);
    // Esc: the layer closes the list before any handler hears the key (usePopoverLayer).
    else if (k === "Tab") {
      close();
      return;
    } else if (isPrintable(e)) {
      const i = typeahead(k, active, e.timeStamp);
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <div className={cx("Dropdown", className)} ref={root}>
      <button
        ref={button}
        type="button"
        className="Dropdown-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : show(firstSelected))}
        onKeyDown={onKeyDown}
      >
        <span className="Dropdown-value">{text}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open &&
        place(
          <div
            ref={popover}
            id={listId}
            className="Popover"
            role="listbox"
            aria-label={label}
            aria-multiselectable={multi || undefined}
            // Keep focus on the button while the pointer picks.
            onMouseDown={(e) => e.preventDefault()}
          >
            {labels.map((l, i) => (
              <div
                key={i}
                id={optionId(i)}
                role="option"
                aria-selected={selectedAt(i)}
                aria-disabled={disabledAt(i) || undefined}
                className={cx("Option", i === active && "is-active")}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => choose(i)}
              >
                <Icon name="check" size={18} />
                <span className="Option-label">{l}</span>
              </div>
            ))}
          </div>,
        )}
    </div>
  );
}

export interface DropdownProps<V extends string> {
  label: string;
  options: readonly DropdownOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Open on first render (fixture pages). */
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Dropdown<V extends string>({ options, value, onChange, ...rest }: DropdownProps<V>) {
  const selected = options.findIndex((o) => o.value === value);
  return (
    <Listbox
      {...rest}
      labels={options.map((o) => o.label)}
      disabledAt={(i) => !!options[i].disabled}
      selectedAt={(i) => i === selected}
      firstSelected={selected}
      multi={false}
      text={selected >= 0 ? options[selected].label : ""}
      pick={(i) => onChange(options[i].value)}
    />
  );
}

export interface MultiSelectProps<V extends string> {
  label: string;
  options: readonly DropdownOption<V>[];
  values: readonly V[];
  onChange: (values: V[]) => void;
  /** Button text with nothing chosen. */
  noneLabel?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
}

export function MultiSelect<V extends string>({
  options,
  values,
  onChange,
  noneLabel = "None",
  ...rest
}: MultiSelectProps<V>) {
  const chosen = options.filter((o) => values.includes(o.value));
  const text = chosen.length === 0 ? noneLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} chosen`;
  return (
    <Listbox
      {...rest}
      labels={options.map((o) => o.label)}
      disabledAt={(i) => !!options[i].disabled}
      selectedAt={(i) => values.includes(options[i].value)}
      firstSelected={options.findIndex((o) => values.includes(o.value))}
      multi
      text={text}
      pick={(i) => {
        const v = options[i].value;
        onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
      }}
    />
  );
}
