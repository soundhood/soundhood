import { describe, expect, it } from "vitest";
import {
  CANVAS_RGB,
  GAP,
  composePair,
  composeStack,
  filledImage,
  pairLayout,
  pairScreens,
  parseShotName,
  parseSize,
  resize,
  stackLayout,
} from "./parity.mjs";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const pixel = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("names and sizes", () => {
  it("reads sizes and the suite's screenshot names", () => {
    expect(parseSize("390x844")).toEqual(PHONE);
    expect(() => parseSize("390*844")).toThrow(/not a size/);
    expect(() => parseSize("0x10")).toThrow(/not a size/);
    expect(parseShotName("1280x800-now-playing.png")).toEqual({ width: 1280, height: 800, screen: "now-playing" });
    expect(parseShotName("1280x800-library-diff.txt")).toBeNull();
    expect(parseShotName("library.png")).toBeNull();
  });

  it("pairs a screen only when it exists at both sizes and lists the rest", () => {
    const names = [
      "390x844-playlists.png",
      "1280x800-playlists.png",
      "390x844-queue.png",
      "1280x800-search.png",
      "1920x1080-search.png",
      "834x1194-settings.png",
      "1280x800-settings.png",
      "notes.txt",
    ];
    expect(pairScreens(names, PHONE, DESKTOP)).toEqual({
      pairs: [{ screen: "playlists", phone: "390x844-playlists.png", desktop: "1280x800-playlists.png" }],
      phoneOnly: ["queue"],
      desktopOnly: ["search", "settings"],
    });
  });

  it("uses other sizes when asked", () => {
    const { pairs } = pairScreens(["834x1194-a.png", "1920x1080-a.png"], { width: 834, height: 1194 }, { width: 1920, height: 1080 });
    expect(pairs.map((p) => p.screen)).toEqual(["a"]);
  });
});

describe("layout", () => {
  it("scales both to the smaller height, phone left, a gap between and around", () => {
    const l = pairLayout(PHONE, DESKTOP);
    expect(l.phone).toEqual({ x: GAP, y: GAP, width: Math.round((390 * 800) / 844), height: 800 });
    expect(l.desktop).toEqual({ x: GAP + 370 + GAP, y: GAP, width: 1280, height: 800 });
    expect(l.width).toBe(GAP + 370 + GAP + 1280 + GAP);
    expect(l.height).toBe(800 + 2 * GAP);
  });

  it("never enlarges: a taller desktop is scaled down to the phone's height", () => {
    const l = pairLayout(PHONE, { width: 1920, height: 1080 });
    expect(l.phone.height).toBe(844);
    expect(l.phone.width).toBe(390);
    expect(l.desktop).toMatchObject({ height: 844, width: 1500 });
  });

  it("stacks pair images with one gap between rows", () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 120, height: 40 },
    ];
    expect(stackLayout(sizes, 10)).toEqual({ width: 120, height: 50 + 40 - 10, at: [{ x: 0, y: 0 }, { x: 0, y: 40 }] });
    expect(stackLayout([], 10)).toEqual({ width: 0, height: 0, at: [] });
  });
});

describe("pixels", () => {
  const solid = (w, h, rgb) => filledImage(w, h, rgb);

  it("keeps an image of the same size as it is", () => {
    const img = solid(3, 2, [1, 2, 3]);
    expect(resize(img, 3, 2).data).toEqual(img.data);
  });

  it("averages the covered area when shrinking", () => {
    // Two columns, black and white, shrunk to one pixel: mid grey.
    const img = { width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]) };
    expect(pixel(resize(img, 1, 1), 0, 0)).toEqual([128, 128, 128, 255]);
    // Three columns to two: the middle one is split between the two outputs.
    const three = { width: 3, height: 1, data: Uint8Array.from([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255]) };
    expect(resize(three, 2, 1).data).toEqual(Uint8Array.from([30, 30, 30, 255, 150, 150, 150, 255]));
  });

  it("draws a pair on the canvas colour with the gap left empty", () => {
    const grid = composePair(solid(39, 84, [0, 255, 191]), solid(128, 80, [140, 25, 255]), 4);
    const l = pairLayout({ width: 39, height: 84 }, { width: 128, height: 80 }, 4);
    expect([grid.width, grid.height]).toEqual([l.width, l.height]);
    expect(pixel(grid, 0, 0)).toEqual([...CANVAS_RGB, 255]);
    expect(pixel(grid, l.phone.x, l.phone.y)).toEqual([0, 255, 191, 255]);
    expect(pixel(grid, l.phone.x + l.phone.width, l.phone.y)).toEqual([...CANVAS_RGB, 255]);
    expect(pixel(grid, l.desktop.x + l.desktop.width - 1, l.desktop.y + l.desktop.height - 1)).toEqual([140, 25, 255, 255]);
  });

  it("stacks pairs into one image", () => {
    const a = filledImage(10, 6, [200, 0, 0]);
    const b = filledImage(8, 6, [0, 200, 0]);
    const all = composeStack([a, b], 2);
    expect([all.width, all.height]).toEqual([10, 10]);
    expect(pixel(all, 0, 0)).toEqual([200, 0, 0, 255]);
    expect(pixel(all, 0, 9)).toEqual([0, 200, 0, 255]);
    expect(pixel(all, 9, 9)).toEqual([...CANVAS_RGB, 255]);
  });
});
