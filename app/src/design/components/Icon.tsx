// Icon: an inline SVG from the Soundhood set (icons/icons.ts). Decorative by default (aria-hidden);
// with a `title` it becomes an image with that name. Spec: docs/DESIGN.md, Icons and Primitives.
import { ICONS, type IconName } from "../icons/icons";
import { cx } from "../lib/cx";

export type { IconName };

// One markup object per icon, made once. React re-sets innerHTML whenever this object is a new one,
// which replaced the icon's paths on every re-render: a press on an icon whose list re-rendered
// between pointer down and up (the row taking the focus) lost its click.
const MARKUP = Object.fromEntries(Object.entries(ICONS).map(([name, html]) => [name, { __html: html }])) as Record<IconName, { __html: string }>;

/** 20, 24 and 32 are the set's sizes; any other number is allowed for a special case. */
export type IconSize = 20 | 24 | 32 | (number & {});

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Makes the icon an image named `title`; leave it out when the icon sits next to its label. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 24, title, className }: IconProps) {
  return (
    <svg
      className={cx("Icon", className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      // The set is static data from icons.ts, never user input.
      dangerouslySetInnerHTML={MARKUP[name]}
    />
  );
}
