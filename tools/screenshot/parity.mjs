// Pure parts of the parity grid (parity-grid.mjs): which screenshots pair up, where each image goes
// on the canvas, and the pixel work (box-filter resize, compositing). The Phase 1 definition of done
// asks for the phone and the desktop side by side per screen with no parity exceptions.

/** Background of every grid: the app canvas colour (bg-0). */
export const CANVAS_RGB = [0x0f, 0x0f, 0x0f];

/** Space between the images and around them, in pixels. */
export const GAP = 16;

/** "390x844" -> { width: 390, height: 844 }; throws on anything else. */
export function parseSize(text) {
  const m = /^(\d+)x(\d+)$/.exec(String(text).trim());
  if (!m || +m[1] === 0 || +m[2] === 0) throw new Error(`not a size: "${text}" (expected <width>x<height>, e.g. 390x844)`);
  return { width: +m[1], height: +m[2] };
}

/** The suite's screenshot name `<width>x<height>-<screen>.png` -> { width, height, screen }, or null. */
export function parseShotName(name) {
  const m = /^(\d+)x(\d+)-(.+)\.png$/i.exec(name);
  return m ? { width: +m[1], height: +m[2], screen: m[3] } : null;
}

const sameSize = (a, b) => a.width === b.width && a.height === b.height;

/**
 * Pairs the screenshot names in `names` by screen: { pairs: [{ screen, phone, desktop }] (sorted by
 * screen), phoneOnly: [screen], desktopOnly: [screen] }. Names at other sizes or not in the suite's
 * form are ignored.
 */
export function pairScreens(names, phone, desktop) {
  const byScreen = new Map();
  for (const name of names) {
    const shot = parseShotName(name);
    if (!shot) continue;
    const side = sameSize(shot, phone) ? "phone" : sameSize(shot, desktop) ? "desktop" : null;
    if (!side) continue;
    const entry = byScreen.get(shot.screen) ?? {};
    entry[side] = name;
    byScreen.set(shot.screen, entry);
  }
  const screens = [...byScreen.keys()].sort();
  return {
    pairs: screens.filter((s) => byScreen.get(s).phone && byScreen.get(s).desktop).map((s) => ({ screen: s, ...byScreen.get(s) })),
    phoneOnly: screens.filter((s) => !byScreen.get(s).desktop),
    desktopOnly: screens.filter((s) => !byScreen.get(s).phone),
  };
}

/**
 * Where a phone and a desktop image of the given sizes go: both scaled to the same height (the
 * smaller of the two, so nothing is enlarged), phone on the left, `gap` between them and around
 * them. Returns { width, height, phone: { x, y, width, height }, desktop: { ... } }.
 */
export function pairLayout(phone, desktop, gap = GAP) {
  const height = Math.min(phone.height, desktop.height);
  const scaled = (s) => ({ width: Math.max(1, Math.round((s.width * height) / s.height)), height });
  const p = scaled(phone);
  const d = scaled(desktop);
  return {
    width: gap + p.width + gap + d.width + gap,
    height: gap + height + gap,
    phone: { x: gap, y: gap, ...p },
    desktop: { x: gap + p.width + gap, y: gap, ...d },
  };
}

/**
 * Where pair images of the given sizes go when stacked top to bottom, left-aligned. Each pair image
 * already has a `gap` margin of canvas all round, so each row starts `gap` above the previous one's
 * bottom edge: one gap between rows, as between the images of a pair. Returns { width, height, at:
 * [{ x, y }] }.
 */
export function stackLayout(sizes, gap = GAP) {
  const at = [];
  let y = 0;
  for (const s of sizes) {
    at.push({ x: 0, y });
    y += s.height - gap;
  }
  const width = Math.max(0, ...sizes.map((s) => s.width));
  return { width, height: sizes.length ? y + gap : 0, at };
}

/** A new RGBA image ({ width, height, data }) filled with `rgb`. */
export function filledImage(width, height, rgb = CANVAS_RGB) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/**
 * `img` resized to width x height with a box filter: every output pixel is the area-weighted mean
 * of the source pixels it covers, so a downscale does not alias text. Same size returns a copy.
 */
export function resize(img, width, height) {
  if (img.width === width && img.height === height) return { width, height, data: Uint8Array.from(img.data) };
  const out = new Uint8Array(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  // Per output column: the source columns it covers and how much of each.
  const spans = (n, scale, limit) =>
    Array.from({ length: n }, (_, o) => {
      const from = o * scale;
      const to = Math.min(limit, (o + 1) * scale);
      const cells = [];
      for (let s = Math.floor(from); s < to; s++) {
        const w = Math.min(to, s + 1) - Math.max(from, s);
        if (w > 1e-9) cells.push([s, w]);
      }
      return cells;
    });
  const cols = spans(width, sx, img.width);
  const rows = spans(height, sy, img.height);
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      const acc = [0, 0, 0, 0];
      let total = 0;
      for (const [y, wy] of rows[oy]) {
        for (const [x, wx] of cols[ox]) {
          const w = wx * wy;
          const i = (y * img.width + x) * 4;
          for (let c = 0; c < 4; c++) acc[c] += img.data[i + c] * w;
          total += w;
        }
      }
      const o = (oy * width + ox) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / total);
    }
  }
  return { width, height, data: out };
}

/** Draws `src` onto `dst` at (x, y), blending by the source alpha (screenshots are opaque). */
export function drawImage(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (sy * src.width + sx) * 4;
      const d = (dy * dst.width + dx) * 4;
      const a = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round(src.data[s + c] * a + dst.data[d + c] * (1 - a));
      dst.data[d + 3] = 255;
    }
  }
}

/** The side-by-side image of one screen: phone and desktop scaled to one height on the canvas. */
export function composePair(phoneImg, desktopImg, gap = GAP) {
  const layout = pairLayout(phoneImg, desktopImg, gap);
  const canvas = filledImage(layout.width, layout.height);
  for (const [img, at] of [
    [phoneImg, layout.phone],
    [desktopImg, layout.desktop],
  ]) {
    drawImage(canvas, resize(img, at.width, at.height), at.x, at.y);
  }
  return canvas;
}

/** Every pair image stacked into one, in the order given (stackLayout). */
export function composeStack(images, gap = GAP) {
  const layout = stackLayout(images, gap);
  const canvas = filledImage(Math.max(1, layout.width), Math.max(1, layout.height));
  images.forEach((img, i) => drawImage(canvas, img, layout.at[i].x, layout.at[i].y));
  return canvas;
}
