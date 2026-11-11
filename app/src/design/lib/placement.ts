// Where a popover goes (a Dropdown's or MultiSelect's list, a menu): against what opened it, inside
// the area where it can be seen. Below its anchor, or above it only when it does not fit below and
// there is more room above (so on the side where it fits whole when one does); its height capped to
// the room on that side only when it fits on neither, so it scrolls inside instead of running out
// of the area. At the pointer it slides over the pointer instead, until it fits whole. Start-aligned
// with the anchor, or end-aligned when it would leave the area on that side; never outside the area.
// No DOM here: usePopoverPlacement and the row menu measure and apply it.
import type { Box } from "./dom";

/** Between the anchor and the popover (--sp-1). */
export const POPOVER_GAP = 4;
/** Kept clear between the popover and the edges of the area it can be seen in. */
export const POPOVER_EDGE = 8;

export interface PlacementInput {
  /** What opened it, in viewport px (a button's box, or the pointer as a box of no size). */
  anchor: Box;
  /** The popover's own size (its height as tall as its content, up to its CSS cap). */
  width: number;
  height: number;
  /** Where it can be seen, in viewport px. */
  area: Box;
  /** Line its left edge up with the anchor's ("start"), or its right edge ("end"). */
  align?: "start" | "end";
}

export interface Placement {
  /** Its top-left corner, in viewport px. */
  left: number;
  top: number;
  /** Its height cap when the room on its side is less than its height, else null. */
  maxHeight: number | null;
  /** Opened upward. */
  up: boolean;
  /** Its right edge lines up with the anchor's. */
  end: boolean;
}

export function placePopover({ anchor, width, height, area, align = "start" }: PlacementInput): Placement {
  const below = area.bottom - POPOVER_EDGE - (anchor.bottom + POPOVER_GAP);
  const above = anchor.top - POPOVER_GAP - (area.top + POPOVER_EDGE);
  const up = height > below && above > below;
  let room = Math.max(0, up ? above : below);
  let shown = Math.min(height, room);
  let top = up ? anchor.top - POPOVER_GAP - shown : anchor.bottom + POPOVER_GAP;
  // At the pointer (a context menu) there is no button to keep clear: when neither side holds it,
  // it slides along the area until it shows whole, over the pointer, and is capped only when the
  // area itself is shorter than it.
  const atPointer = anchor.top === anchor.bottom && anchor.left === anchor.right;
  if (atPointer && height > below && height > above) {
    room = Math.max(0, area.bottom - area.top - 2 * POPOVER_EDGE);
    shown = Math.min(height, room);
    top = up ? area.top + POPOVER_EDGE : area.bottom - POPOVER_EDGE - shown;
  }

  const minLeft = area.left + POPOVER_EDGE;
  const maxLeft = area.right - POPOVER_EDGE - width;
  let end = align === "end";
  if (!end && anchor.left > maxLeft && anchor.right - width >= minLeft) end = true;
  else if (end && anchor.right - width < minLeft && anchor.left <= maxLeft) end = false;
  const left = Math.max(minLeft, Math.min(end ? anchor.right - width : anchor.left, maxLeft));

  return { left, top, maxHeight: height > room ? room : null, up, end };
}
