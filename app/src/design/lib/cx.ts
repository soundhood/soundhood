// Small helpers shared by the design-system components.
import type { CSSProperties } from "react";

export type ClassPart = string | false | null | undefined | 0;

/** Joins the truthy class names: cx("Button", primary && "is-primary"). */
export function cx(...parts: ClassPart[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * An inline style made of CSS custom properties only. Inline styles in the design system carry
 * variables (--percent, --tab-index, --progress, --tint, ...); every real property stays in CSS.
 */
export function cssVars(vars: Record<`--${string}`, string | number | undefined>): CSSProperties {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(vars)) if (value !== undefined) out[name] = value;
  return out as CSSProperties;
}

/** Clamps `n` into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
