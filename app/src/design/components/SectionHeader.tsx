// SectionHeader: an h3-styled heading with an optional text action on the right ("Show all 5").
import { cx } from "../lib/cx";
import { Button } from "./Button";

export interface SectionHeaderProps {
  title: string;
  action?: { label: string; onClick: () => void };
  /** The heading element; the look is h3 either way. */
  level?: 2 | 3;
  className?: string;
}

export function SectionHeader({ title, action, level = 2, className }: SectionHeaderProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={cx("SectionHeader", className)}>
      <H>{title}</H>
      {action && (
        <Button variant="link" small onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
