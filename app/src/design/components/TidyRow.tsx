// TidyRow: a proposed change waiting for a tick in Tidy (Phase 2). A checkbox, the name before and
// after (changed parts in --fg-0, the rest --fg-1; removed parts also struck through), a confidence
// hint and the reason. A tap anywhere on the row ticks it.
import { cx } from "../lib/cx";
import { isControlTarget } from "../lib/dom";
import { Checkbox } from "./Checkbox";
import { Icon, type IconName } from "./Icon";

export interface TidyPart {
  text: string;
  changed?: boolean;
}

export type TidyConfidence = "high" | "medium" | "low";

export interface TidyRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  before: readonly TidyPart[];
  after: readonly TidyPart[];
  confidence: TidyConfidence;
  /** Why the change is proposed, in plain words. */
  reason: string;
  className?: string;
}

const CONFIDENCE: Record<TidyConfidence, { label: string; icon: IconName }> = {
  high: { label: "Sure", icon: "done" },
  medium: { label: "Likely", icon: "info" },
  low: { label: "Check this", icon: "warning" },
};

const plain = (parts: readonly TidyPart[]) => parts.map((p) => p.text).join("");

function Parts({ parts }: { parts: readonly TidyPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={cx(p.changed && "is-changed")}>
          {p.text}
        </span>
      ))}
    </>
  );
}

export function TidyRow({ checked, onChange, before, after, confidence, reason, className }: TidyRowProps) {
  const c = CONFIDENCE[confidence];
  return (
    <div
      className={cx("TidyRow", checked && "is-checked", className)}
      onClick={(e) => {
        if (!isControlTarget(e.target)) onChange(!checked);
      }}
    >
      <Checkbox checked={checked} onChange={onChange} aria-label={`Rename to ${plain(after)}`} />
      <div className="TidyRow-text">
        <div className="TidyRow-line is-before">
          <span className="visually-hidden">Before: </span>
          <Parts parts={before} />
        </div>
        <div className="TidyRow-line is-after">
          <Icon name="chevronRight" size={16} />
          <span className="visually-hidden">After: </span>
          <Parts parts={after} />
        </div>
        <div className="TidyRow-reason">{reason}</div>
      </div>
      <span className={cx("TidyRow-confidence", `is-${confidence}`)}>
        <Icon name={c.icon} size={16} />
        {c.label}
      </span>
    </div>
  );
}
