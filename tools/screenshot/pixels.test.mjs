// Unit tests for the screenshot comparison helper the flow specs use.
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { PIXEL_TOLERANCE, changedPixelsOutside } from "./pixels.mjs";

/** A width x height PNG, all grey (128), with the pixels in `dots` ([x, y]) set to `value`. */
function png(width, height, dots = [], value = 255) {
  const p = new PNG({ width, height });
  p.data.fill(128);
  for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255;
  for (const [x, y] of dots) p.data.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return PNG.sync.write(p);
}

describe("changedPixelsOutside", () => {
  test("identical screenshots: nothing changed", () => {
    expect(changedPixelsOutside(png(20, 10), png(20, 10))).toBe(0);
  });

  test("counts every changed pixel outside the allowed regions", () => {
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[1, 1], [18, 8]]))).toBe(2);
  });

  test("changes inside an allowed region (with a 1 px margin) are ignored", () => {
    const allowed = [{ x: 10, y: 2, width: 4, height: 4 }];
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[10, 2], [13, 5], [9, 1], [14, 6]]), allowed)).toBe(0);
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[2, 2]]), allowed)).toBe(1);
  });

  test("re-rasterised edges (a few levels) are the same pixel; a real change is not", () => {
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[3, 3]], 128 + PIXEL_TOLERANCE))).toBe(0);
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[3, 3]], 128 + PIXEL_TOLERANCE + 1))).toBe(1);
    expect(changedPixelsOutside(png(20, 10), png(20, 10, [[3, 3]], 128 + 8), [], 0)).toBe(1);
  });

  test("a different size is a layout change", () => {
    expect(() => changedPixelsOutside(png(20, 10), png(20, 11))).toThrow(/size changed/);
  });
});
