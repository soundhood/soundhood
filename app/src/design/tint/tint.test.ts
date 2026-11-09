// Unit tests of the artwork tint maths (run from tools/: `npm run test`). Synthetic pixels only.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import {
  TINT_LIMITS,
  clampTint,
  dominantColour,
  hueDistance,
  kMeans,
  labToOklch,
  oklchCss,
  rgbToOklch,
  tintFromPixels,
  type Lab,
} from "./tint";

/** A 32 x 32 RGBA image: `share` of the pixels in colour a, the rest in b. */
function image(a: number[], b: number[], share: number, alphaB = 255): number[] {
  const out: number[] = [];
  for (let i = 0; i < 1024; i++) {
    const [r, g, bl] = i < share * 1024 ? a : b;
    out.push(r, g, bl, i < share * 1024 ? 255 : alphaB);
  }
  return out;
}

describe("rgbToOklch", () => {
  it("matches the reference values for white, black and red", () => {
    const white = rgbToOklch(255, 255, 255);
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeCloseTo(0, 4);
    expect(rgbToOklch(0, 0, 0)).toEqual({ l: 0, c: 0, h: 0 });
    const red = rgbToOklch(255, 0, 0);
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });

  it("puts the brand colours where the clamp expects them", () => {
    expect(hueDistance(rgbToOklch(0, 255, 191).h, 165)).toBeLessThan(5);
    expect(hueDistance(rgbToOklch(140, 25, 255).h, 290)).toBeLessThan(10);
  });
});

describe("hueDistance", () => {
  it("takes the short way round the circle", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(720, 0)).toBe(0);
  });
});

describe("clampTint", () => {
  it("keeps lightness between 0.18 and 0.32", () => {
    expect(clampTint({ l: 0.9, c: 0.01, h: 40 }).l).toBe(TINT_LIMITS.lMax);
    expect(clampTint({ l: 0.02, c: 0.01, h: 40 }).l).toBe(TINT_LIMITS.lMin);
    expect(clampTint({ l: 0.25, c: 0.01, h: 40 }).l).toBe(0.25);
  });

  it("caps chroma at 0.08, and at 0.04 within 25 degrees of aqua or purple", () => {
    expect(clampTint({ l: 0.25, c: 0.3, h: 40 }).c).toBe(0.08);
    expect(clampTint({ l: 0.25, c: 0.3, h: 165 }).c).toBe(0.04);
    expect(clampTint({ l: 0.25, c: 0.3, h: 189 }).c).toBe(0.04);
    expect(clampTint({ l: 0.25, c: 0.3, h: 191 }).c).toBe(0.08);
    expect(clampTint({ l: 0.25, c: 0.3, h: 270 }).c).toBe(0.04);
    expect(clampTint({ l: 0.25, c: 0.3, h: 314 }).c).toBe(0.04);
    expect(clampTint({ l: 0.25, c: 0.02, h: 290 }).c).toBe(0.02);
  });

  it("keeps the hue", () => {
    expect(clampTint({ l: 0.5, c: 0.2, h: 52 }).h).toBe(52);
  });
});

describe("kMeans", () => {
  const pts: Lab[] = [
    [0.1, 0, 0],
    [0.11, 0, 0],
    [0.5, 0.1, 0],
    [0.52, 0.1, 0],
    [0.9, 0, 0.1],
    [0.91, 0, 0.1],
    [0.92, 0, 0.1],
  ];

  it("is deterministic", () => {
    expect(kMeans(pts, 3)).toEqual(kMeans(pts, 3));
  });

  it("finds well separated groups", () => {
    const { centers, counts } = kMeans(pts, 3);
    expect([...counts].sort()).toEqual([2, 2, 3]);
    const big = centers[counts.indexOf(3)];
    expect(big[0]).toBeCloseTo(0.91, 2);
  });

  it("copes with fewer points than clusters, and with none", () => {
    expect(kMeans(pts.slice(0, 2), 4).centers).toHaveLength(2);
    expect(kMeans([], 4)).toEqual({ centers: [], counts: [] });
  });
});

describe("dominantColour and tintFromPixels", () => {
  it("picks the colour covering most of the cover", () => {
    const lab = dominantColour(image([200, 40, 40], [30, 160, 60], 0.7));
    expect(lab).not.toBeNull();
    expect(hueDistance(labToOklch(lab as Lab).h, rgbToOklch(200, 40, 40).h)).toBeLessThan(3);
  });

  it("ignores transparent pixels", () => {
    const lab = dominantColour(image([200, 40, 40], [30, 160, 60], 0.2, 0));
    expect(hueDistance(labToOklch(lab as Lab).h, rgbToOklch(200, 40, 40).h)).toBeLessThan(3);
  });

  it("returns null for an empty or fully transparent cover", () => {
    expect(tintFromPixels([])).toBeNull();
    expect(tintFromPixels(new Array(4096).fill(0))).toBeNull();
  });

  it("returns a clamped oklch() string", () => {
    expect(tintFromPixels(image([200, 40, 40], [30, 160, 60], 0.7))).toBe("oklch(0.320 0.080 26.8)");
    const aqua = tintFromPixels(image([0, 255, 191], [0, 42, 34], 0.8));
    expect(aqua).toMatch(/^oklch\(0\.320 0\.040 16\d\.\d\)$/);
    const grey = tintFromPixels(image([90, 90, 90], [10, 10, 10], 0.9));
    expect(grey).toMatch(/^oklch\(0\.[23]\d\d 0\.000 0\.0\)$/);
  });

  it("formats with fixed decimals", () => {
    expect(oklchCss({ l: 0.2, c: 0.04, h: 165 })).toBe("oklch(0.200 0.040 165.0)");
  });
});
