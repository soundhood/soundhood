// Where a popover goes (placement.ts): below, or above only when there is more room there; its height
// capped to the room on its side; aligned with its anchor and never outside the area.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { POPOVER_EDGE, POPOVER_GAP, placePopover } from "./placement";

const area = { top: 0, left: 0, bottom: 800, right: 1280 };
const button = (top: number, left = 100, width = 160) => ({ top, bottom: top + 36, left, right: left + width });

describe("placePopover", () => {
  it("opens below its anchor when it fits there, start-aligned, uncapped", () => {
    const at = placePopover({ anchor: button(100), width: 240, height: 320, area });
    expect(at).toEqual({ left: 100, top: 136 + POPOVER_GAP, maxHeight: null, up: false, end: false });
  });

  it("opens above when it does not fit below and there is more room above", () => {
    const at = placePopover({ anchor: button(600), width: 240, height: 320, area });
    expect(at.up).toBe(true);
    expect(at.top).toBe(600 - POPOVER_GAP - 320);
    expect(at.maxHeight).toBeNull();
  });

  it("stays below when it fits neither way but below has more room, capped to that room", () => {
    // 29 playlists: 1052 px of options in a 520 px window, the button a little above the middle.
    const small = { top: 0, left: 0, bottom: 520, right: 760 };
    const at = placePopover({ anchor: button(200), width: 240, height: 1052, area: small });
    const room = 520 - POPOVER_EDGE - (236 + POPOVER_GAP);
    expect(at).toMatchObject({ up: false, top: 236 + POPOVER_GAP, maxHeight: room });
  });

  it("opens above, capped to the room above, when neither way fits and above has more room", () => {
    const small = { top: 0, left: 0, bottom: 520, right: 760 };
    const at = placePopover({ anchor: button(330), width: 240, height: 1052, area: small });
    const room = 330 - POPOVER_GAP - POPOVER_EDGE;
    expect(at).toMatchObject({ up: true, maxHeight: room, top: POPOVER_EDGE });
  });

  it("never leaves the area: the top of an upward list is at least the edge below the area's top", () => {
    const sheetArea = { top: 60, left: 0, bottom: 844, right: 390 };
    const at = placePopover({ anchor: button(600, 150, 200), width: 240, height: 1052, area: sheetArea });
    expect(at.top).toBeGreaterThanOrEqual(sheetArea.top + POPOVER_EDGE);
    expect(at.top + (at.maxHeight ?? 1052)).toBeLessThanOrEqual(600 - POPOVER_GAP);
  });

  it("lines its right edge up with the anchor's when it would leave the area on the right", () => {
    const at = placePopover({ anchor: button(100, 1180, 60), width: 240, height: 200, area });
    expect(at.end).toBe(true);
    expect(at.left).toBe(1240 - 240);
  });

  it("an end-aligned menu goes start-aligned when it would leave the area on the left", () => {
    const at = placePopover({ anchor: button(100, 10, 40), width: 240, height: 200, area, align: "end" });
    expect(at.end).toBe(false);
    expect(at.left).toBe(POPOVER_EDGE + 2);
  });

  it("is held inside the area when it is wider than the room on either side", () => {
    const narrow = { top: 0, left: 0, bottom: 844, right: 300 };
    const at = placePopover({ anchor: button(100, 120, 60), width: 280, height: 200, area: narrow });
    expect(at.left).toBeGreaterThanOrEqual(POPOVER_EDGE);
    expect(at.left + 280).toBeLessThanOrEqual(300 - POPOVER_EDGE);
  });

  it("at the pointer (an anchor of no size) opens below it, or above it near the bottom", () => {
    const pointer = (x: number, y: number) => ({ top: y, bottom: y, left: x, right: x });
    expect(placePopover({ anchor: pointer(400, 300), width: 240, height: 260, area })).toMatchObject({ left: 400, top: 300 + POPOVER_GAP, up: false });
    expect(placePopover({ anchor: pointer(400, 700), width: 240, height: 260, area })).toMatchObject({ top: 700 - POPOVER_GAP - 260, up: true });
  });
});
