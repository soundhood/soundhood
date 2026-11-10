// Settings rows, the parts of the SettingsSheet (one component on every device: the phone's sheet
// and the desktop's Ctrl+comma dialog). A group is an overline heading over rows; a row is a label
// with an optional help line and one control on the right: a Switch (SwitchRow, the whole row is the
// click target), a Dropdown, a small Button, or a value with a chevron that opens a sub-sheet
// (ValueRow). A stacked row puts the control under the label (a field with a Paste button).
import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { isControlTarget, onePress } from "../lib/dom";
import { Icon } from "./Icon";
import { Switch } from "./Switch";

export interface SettingGroupProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function SettingGroup({ title, children, className }: SettingGroupProps) {
  const id = useId();
  return (
    <section className={cx("SettingGroup", className)} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

export interface SettingRowProps {
  label: ReactNode;
  help?: ReactNode;
  /** The one control. */
  children?: ReactNode;
  /** The control under the label instead of beside it. */
  stacked?: boolean;
  /** Id for the label, so the control can point at it with aria-labelledby. */
  labelId?: string;
  className?: string;
}

export function SettingRow({ label, help, children, stacked, labelId, className }: SettingRowProps) {
  return (
    <div className={cx("SettingRow", stacked && "is-stacked", className)}>
      <div className="SettingRow-text">
        <div className="SettingRow-label" id={labelId}>
          {label}
        </div>
        {help && <div className="SettingRow-help">{help}</div>}
      </div>
      {children}
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  help?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A setting with a Switch; a tap anywhere on the row toggles it. */
export function SwitchRow({ label, help, checked, onChange, disabled }: SwitchRowProps) {
  const id = useId();
  return (
    <div
      className={cx("SettingRow", "is-clickable", disabled && "is-disabled")}
      onClick={(e) => {
        if (!disabled && !isControlTarget(e.target)) onChange(!checked);
      }}
    >
      <div className="SettingRow-text">
        <div className="SettingRow-label" id={`${id}-label`}>
          {label}
        </div>
        {help && (
          <div className="SettingRow-help" id={`${id}-help`}>
            {help}
          </div>
        )}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
      />
    </div>
  );
}

export interface ValueRowProps {
  label: string;
  help?: ReactNode;
  value: ReactNode;
  onClick: () => void;
}

/** A value with a chevron; the row is one button that opens a sub-sheet. */
export function ValueRow({ label, help, value, onClick }: ValueRowProps) {
  return (
    <button type="button" className="SettingRow is-clickable" onClick={onClick} onKeyDown={onePress()}>
      <span className="SettingRow-text">
        <span className="SettingRow-label">{label}</span>
        {help && <span className="SettingRow-help">{help}</span>}
      </span>
      <span className="SettingRow-value">
        {value}
        <Icon name="chevronRight" size={20} />
      </span>
    </button>
  );
}
