// Where a popover goes (placement.ts): below, or above only when there is more room there; its height
// capped to the room on its side; aligned with its anchor and never outside the area.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { POPOVER_EDGE, POPOVER_GAP, placePopover } from "./placement";

const area = { top: 0, left: 0, bottom: 800, right: 1280 };
const button = (top: number, left = 100, width = 160) => ({ top, bottom: top + 36, left, right: left + width });
const pointer = (x: number, y: number) => ({ top: y, bottom: y, left: x, right: x });

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
    expect(placePopover({ anchor: pointer(400, 300), width: 240, height: 260, area })).toMatchObject({ left: 400, top: 300 + POPOVER_GAP, up: false });
    expect(placePopover({ anchor: pointer(400, 700), width: 240, height: 260, area })).toMatchObject({ top: 700 - POPOVER_GAP - 260, up: true });
  });

  it("opens on the side where it fits whole: below when it fits there, else above when it fits there", () => {
    // The 7-item row menu (260 px) at 760x520: below when it fits there (272 px of room), above
    // when only that side holds it (278 px above, 182 below), uncapped either way.
    const small = { top: 0, left: 0, bottom: 520, right: 760 };
    expect(placePopover({ anchor: button(200), width: 240, height: 260, area: small })).toMatchObject({ up: false, maxHeight: null });
    expect(placePopover({ anchor: button(290), width: 240, height: 260, area: small })).toMatchObject({ up: true, maxHeight: null, top: 290 - POPOVER_GAP - 260 });
  });

  it("at the pointer near the middle of a 520 px window, where it fits on neither side, slides to fit whole", () => {
    // The 7-item row menu (260 px) at 760x520: from y = 249 to 271 neither side holds it.
    const small = { top: 0, left: 0, bottom: 520, right: 760 };
    for (const y of [252, 256, 260, 264, 268]) {
      const at = placePopover({ anchor: pointer(300, y), width: 240, height: 260, area: small });
      expect(at.maxHeight, `y=${y}`).toBeNull();
      expect(at.top, `y=${y}`).toBeGreaterThanOrEqual(POPOVER_EDGE);
      expect(at.top + 260, `y=${y}`).toBeLessThanOrEqual(520 - POPOVER_EDGE);
      expect(at.top, `y=${y}: over the pointer`).toBeLessThanOrEqual(y);
      expect(at.top + 260, `y=${y}: over the pointer`).toBeGreaterThanOrEqual(y);
    }
  });

  it("at the pointer in an area shorter than itself, uses the whole area and is capped to it", () => {
    const tiny = { top: 0, left: 0, bottom: 200, right: 760 };
    expect(placePopover({ anchor: pointer(300, 100), width: 240, height: 260, area: tiny })).toMatchObject({ top: POPOVER_EDGE, maxHeight: 200 - 2 * POPOVER_EDGE });
  });

  it("against a button where it fits on neither side, is capped to the roomier side (never covers its button)", () => {
    const small = { top: 0, left: 0, bottom: 520, right: 760 };
    const at = placePopover({ anchor: { top: 242, bottom: 278, left: 600, right: 636 }, width: 240, height: 260, area: small, align: "end" });
    expect(at.maxHeight).not.toBeNull();
    expect(at.top >= 278 || at.top + (at.maxHeight ?? 0) <= 242).toBe(true);
  });
});
