// Pixel comparison for "nothing else on screen changed" checks: two screenshots of the same page,
// compared everywhere except the regions a flow is allowed to change.
import { PNG } from "pngjs";

/** True when the pixel (x, y) lies inside one of `rects` ({ x, y, width, height }, CSS px). */
function inside(rects, x, y) {
  return rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

/**
 * Largest per-channel difference still counted as "the same pixel". Chromium re-rasterises the
 * rounded corners of a box that sits in a repainted tile with a few levels of difference (seen: up
 * to 8); anything that moves or appears changes pixels by far more than this.
 */
export const PIXEL_TOLERANCE = 24;

/**
 * How many pixels differ by more than `tolerance` in any channel between two PNG screenshots of
 * equal size, ignoring the pixels inside `allowed` (rectangles from Playwright's boundingBox(), at
 * device scale 1). Throws when the sizes differ, which is itself a layout change.
 */
export function changedPixelsOutside(pngA, pngB, allowed = [], tolerance = PIXEL_TOLERANCE) {
  const a = PNG.sync.read(pngA);
  const b = PNG.sync.read(pngB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`screenshot size changed: ${a.width}x${a.height} -> ${b.width}x${b.height}`);
  }
  // Rounded outwards so anti-aliased edges of an allowed region stay inside it.
  const rects = allowed
    .filter(Boolean)
    .map((r) => ({ x: Math.floor(r.x) - 1, y: Math.floor(r.y) - 1, width: Math.ceil(r.width) + 3, height: Math.ceil(r.height) + 3 }));
  let changed = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (inside(rects, x, y)) continue;
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(a.data[i + c] - b.data[i + c]) > tolerance) {
          changed++;
          break;
        }
      }
    }
  }
  return changed;
}
