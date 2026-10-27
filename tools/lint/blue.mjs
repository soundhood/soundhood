// Rules behind tools/blue-scan.mjs (brief §6): no blue anywhere in UI chrome. A pixel is "blue"
// when its hue is 200..250 degrees and its HSV saturation is above 0.5; a screenshot fails when
// more than 0.1 % of its considered pixels are blue. Artwork regions on device screenshots are
// excluded with mask rectangles, never by raising the threshold.
import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";

export const BLUE_HUE_MIN = 200;
export const BLUE_HUE_MAX = 250;
export const BLUE_SAT_MIN = 0.5;
export const BLUE_MAX_RATIO = 0.001;

/** Hue in degrees [0, 360) and HSV saturation [0, 1] of an 8-bit RGB colour. */
export function hueSat(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, sat: d / max };
}

/** True when the pixel reads as UI blue. */
export function isBlue(r, g, b) {
  const { hue, sat } = hueSat(r, g, b);
  return hue >= BLUE_HUE_MIN && hue <= BLUE_HUE_MAX && sat > BLUE_SAT_MIN;
}

/**
 * Counts blue pixels in an RGBA image ({ width, height, data }), skipping fully transparent
 * pixels and pixels inside `masks` ([{ x, y, w, h }]). Masked pixels leave the denominator too.
 */
export function scanRgba({ width, height, data }, masks = []) {
  const inMask = (x, y) => masks.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
  let considered = 0;
  let matched = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      if (masks.length && inMask(x, y)) continue;
      considered++;
      if (isBlue(data[i], data[i + 1], data[i + 2])) matched++;
    }
  }
  return { considered, matched, ratio: considered ? matched / considered : 0 };
}

/** Path of the mask sidecar for a screenshot: `<name>.mask.json` next to `<name>.png`. */
export function maskPathFor(pngPath) {
  return pngPath.replace(/\.png$/i, ".mask.json");
}

/**
 * Mask rectangles for a screenshot from its sidecar, `{ "masks": [{ "x", "y", "w", "h", "why" }] }`;
 * [] when there is no sidecar. Throws on a malformed sidecar so a broken mask never passes silently.
 */
export function readMasks(pngPath) {
  const file = maskPathFor(pngPath);
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: not valid JSON (${e.message})`);
  }
  const masks = parsed?.masks;
  if (!Array.isArray(masks)) throw new Error(`${file}: expected { "masks": [...] }`);
  for (const m of masks) {
    for (const k of ["x", "y", "w", "h"]) {
      if (!Number.isFinite(m?.[k]) || m[k] < 0) throw new Error(`${file}: mask needs non-negative numbers x, y, w, h`);
    }
  }
  return masks;
}

/** Decodes one PNG and scans it with its sidecar masks. */
export function scanPng(pngPath) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const masks = readMasks(pngPath);
  return { width: png.width, height: png.height, masks: masks.length, ...scanRgba(png, masks) };
}
