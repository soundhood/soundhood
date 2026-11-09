// Badge: an 18 px pill. Filled purple under light text (the smart-playlist bolt), or an outline
// with lilac text (Generated lyrics). Purple never carries the meaning alone: there is always text.
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";

export interface BadgeProps {
  outline?: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

export function Badge({ outline, icon, children, className }: BadgeProps) {
  return (
    <span className={cx("Badge", outline && "is-outline", className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
