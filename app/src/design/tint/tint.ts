// The artwork tint: the one colour the app computes at runtime. Pure functions, unit-tested
// (tint.test.ts); the worker (tintWorker.ts) feeds them a 32 x 32 RGBA copy of the cover.
//
//   pixels -> k-means with k = 4 in OKLab (deterministic seeds) -> the biggest cluster -> OKLCH
//   -> lightness clamped to 0.18..0.32, chroma to at most 0.08, and at most 0.04 when the hue is
//   within 25 degrees of aqua (165) or purple (290), so the tint never reads as a brand colour
//   -> a CSS oklch() string.
//
// The tint is used as --tint on player surfaces only (docs/DESIGN.md, Artwork tint); never on
// bars, tabs, text, sliders or buttons.

export type Lab = readonly [number, number, number];

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** What --tint falls back to when there is no cover or anything fails. */
export const TINT_FALLBACK = "var(--bg-1)";

export const TINT_LIMITS = {
  lMin: 0.18,
  lMax: 0.32,
  cMax: 0.08,
  cBrand: 0.04,
  brandHues: [165, 290],
  brandRange: 25,
} as const;

function toLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0..255 per channel) to OKLab [L, a, b] (Ottosson's matrices). */
export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to OKLCH; the hue is in degrees 0..360, and 0 when there is (almost) no chroma. */
export function labToOklch([l, a, b]: Lab): Oklch {
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

export function rgbToOklch(r: number, g: number, b: number): Oklch {
  return labToOklch(rgbToOklab(r, g, b));
}

/** Shortest distance between two hues, in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Applies the tint limits: dark enough for white text, muted, and never a brand colour. */
export function clampTint({ l, c, h }: Oklch): Oklch {
  const { lMin, lMax, cMax, cBrand, brandHues, brandRange } = TINT_LIMITS;
  const nearBrand = brandHues.some((b) => hueDistance(h, b) <= brandRange);
  return { l: Math.min(lMax, Math.max(lMin, l)), c: Math.min(c, nearBrand ? cBrand : cMax), h };
}

/** "oklch(0.270 0.040 165.0)". */
export function oklchCss({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

function dist2(p: Lab, q: Lab): number {
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

export interface Clusters {
  centers: Lab[];
  counts: number[];
}

/**
 * k-means over OKLab points. Seeds are deterministic: the points sorted by lightness (ties by
 * position) and taken at the centres of k equal slices, so one cover always gives one answer.
 */
export function kMeans(points: readonly Lab[], k: number, iterations = 16): Clusters {
  if (points.length === 0) return { centers: [], counts: [] };
  const order = points.map((_, i) => i).sort((i, j) => points[i][0] - points[j][0] || i - j);
  const n = Math.min(k, points.length);
  let centers: Lab[] = Array.from({ length: n }, (_, i) => points[order[Math.floor(((2 * i + 1) * order.length) / (2 * n))]]);
  const assign = new Array<number>(points.length).fill(0);
  let counts = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let p = 0; p < points.length; p++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < n; c++) {
        const d = dist2(points[p], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[p] !== best) {
        assign[p] = best;
        moved = true;
      }
    }
    const sums = Array.from({ length: n }, () => [0, 0, 0]);
    counts = new Array<number>(n).fill(0);
    for (let p = 0; p < points.length; p++) {
      const s = sums[assign[p]];
      s[0] += points[p][0];
      s[1] += points[p][1];
      s[2] += points[p][2];
      counts[assign[p]]++;
    }
    // An empty cluster keeps its centre.
    centers = centers.map((c, i) => (counts[i] ? [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]] : c));
    if (it > 0 && !moved) break;
  }
  return { centers, counts };
}

/** The OKLab colour of the biggest cluster among the opaque pixels (RGBA bytes), or null. */
export function dominantColour(rgba: ArrayLike<number>, k = 4): Lab | null {
  const points: Lab[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] >= 128) points.push(rgbToOklab(rgba[i], rgba[i + 1], rgba[i + 2]));
  }
  const { centers, counts } = kMeans(points, k);
  if (centers.length === 0) return null;
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  return centers[best];
}

/** The CSS tint for a 32 x 32 RGBA cover, or null when it has no opaque pixel. */
export function tintFromPixels(rgba: ArrayLike<number>): string | null {
  const lab = dominantColour(rgba);
  return lab ? oklchCss(clampTint(labToOklch(lab))) : null;
}
