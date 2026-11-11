// OnboardingStep: one of the three skippable first-launch steps, in EmptyState styling and no
// illustration: an icon (the aqua mark on the first step), "Step 1 of 3", a title, two lines of
// text, one control area (a folder button and the index progress, or one switch), and Skip / Next.
import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export interface OnboardingStepProps {
  step: number;
  total: number;
  /** "mark" draws the aqua brand mark; any other icon is a --fg-1 line icon. */
  icon: IconName;
  title: string;
  /** Two short lines. */
  lines: readonly string[];
  /** The step's one control. */
  children?: ReactNode;
  onSkip?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  className?: string;
}

export function OnboardingStep({
  step,
  total,
  icon,
  title,
  lines,
  children,
  onSkip,
  onNext,
  nextLabel = "Next",
  nextDisabled,
  className,
}: OnboardingStepProps) {
  const id = useId();
  return (
    <section className={cx("OnboardingStep", className)} aria-labelledby={id}>
      <div className="OnboardingStep-body">
        <span className={cx("OnboardingStep-icon", icon === "mark" && "is-brand")}>
          <Icon name={icon} size={48} />
        </span>
        <span className="t-overline">
          Step {step} of {total}
        </span>
        <h2 id={id}>{title}</h2>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {children && <div className="OnboardingStep-control">{children}</div>}
      </div>
      <div className="OnboardingStep-foot">
        {onSkip && (
          <Button variant="text" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </section>
  );
}
