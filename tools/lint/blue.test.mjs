import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLUE_MAX_RATIO, hueSat, isBlue, maskPathFor, readMasks, scanPng, scanRgba } from "./blue.mjs";

/** A width x height RGBA image filled with `fill`, with `paint(x, y)` overriding single pixels. */
function image(width, height, fill, paint = () => null) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint(x, y) ?? fill;
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe("pixel classification", () => {
  it("computes hue and HSV saturation", () => {
    expect(hueSat(255, 0, 0)).toEqual({ hue: 0, sat: 1 });
    expect(hueSat(0, 0, 255).hue).toBe(240);
    expect(hueSat(128, 128, 128)).toEqual({ hue: 0, sat: 0 });
  });

  it("calls UI blues blue and the brand colours not blue", () => {
    expect(isBlue(0x00, 0x5f, 0xcc)).toBe(true); // Chromium focus ring
    expect(isBlue(0x1e, 0x90, 0xff)).toBe(true); // dodger blue, hue 210
    expect(isBlue(0x00, 0xff, 0xbf)).toBe(false); // aqua, hue 165
    expect(isBlue(0x8c, 0x19, 0xff)).toBe(false); // purple, hue 271
    expect(isBlue(0xc9, 0xa3, 0xff)).toBe(false); // lilac
    expect(isBlue(0x0f, 0x0f, 0x12)).toBe(false); // near-black with a blue cast, low saturation
    expect(isBlue(0x40, 0x50, 0x70)).toBe(false); // slate, saturation 0.43
  });
});

describe("scanRgba", () => {
  it("measures the blue ratio over considered pixels", () => {
    const img = image(100, 10, [15, 15, 15], (x, y) => (x === 0 && y === 0 ? [0, 0, 255] : null));
    expect(scanRgba(img)).toEqual({ considered: 1000, matched: 1, ratio: 0.001 });
    expect(scanRgba(img).ratio > BLUE_MAX_RATIO).toBe(false);
  });

  it("drops masked and transparent pixels from both counts", () => {
    const img = image(10, 10, [0, 0, 255], (x) => (x >= 5 ? [0, 0, 0, 0] : null));
    expect(scanRgba(img, [{ x: 0, y: 0, w: 5, h: 5 }])).toEqual({ considered: 25, matched: 25, ratio: 1 });
  });
});

describe("files and masks", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sh-blue-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writePng(name, img) {
    const png = new PNG({ width: img.width, height: img.height });
    png.data = Buffer.from(img.data);
    const file = path.join(dir, name);
    writeFileSync(file, PNG.sync.write(png));
    return file;
  }

  it("reads the sidecar next to the screenshot", () => {
    const file = writePng("phone-player.png", image(20, 20, [0, 0, 255]));
    expect(maskPathFor(file)).toBe(path.join(dir, "phone-player.mask.json"));
    expect(scanPng(file).ratio).toBe(1);
    writeFileSync(maskPathFor(file), JSON.stringify({ masks: [{ x: 0, y: 0, w: 20, h: 19, why: "artwork" }] }));
    expect(scanPng(file)).toMatchObject({ considered: 20, matched: 20, masks: 1 });
  });

  it("rejects malformed sidecars", () => {
    const file = writePng("a.png", image(2, 2, [0, 0, 0]));
    writeFileSync(maskPathFor(file), JSON.stringify({ masks: [{ x: 0, y: 0, w: -1, h: 2 }] }));
    expect(() => readMasks(file)).toThrow(/non-negative/);
    writeFileSync(maskPathFor(file), "[]");
    expect(() => readMasks(file)).toThrow(/expected/);
  });
});
