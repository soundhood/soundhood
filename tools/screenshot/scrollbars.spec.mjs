// The scrollbars as the user sees them (docs/DESIGN.md, Hard rules: no native scrollbars). Playwright
// hides Chromium's scrollbars by default (--hide-scrollbars), so the rest of the suite never sees
// them; this file shows them. On the desktop the custom bar must be the one drawn: 8 px, a
// --scrollbar thumb on a transparent track, no arrow buttons at its ends. Chromium (WebView2) drops
// every ::-webkit-scrollbar rule of an element that sets scrollbar-width or scrollbar-color, and
// Windows then draws its own wider bar with arrows; that is what these checks catch. On touch there
// is no bar at all.
import { PNG } from "pngjs";
import { expect, test } from "./harness.mjs";
import { goTo, openSettings } from "./ui.mjs";

test.use({ launchOptions: { args: ["--disable-lcd-text"], ignoreDefaultArgs: ["--hide-scrollbars"] } });

/** The custom bar's width (base.css). */
const BAR = 8;
/** Rows at each end of the bar where Windows draws its arrow buttons. */
const END = 14;
/** Largest per-channel spread still counted as one flat colour. */
const FLAT = 6;

/** Scrolls `selector` to the middle and measures its bar: the gutter and the styles that pick it. */
async function scroller(page, selector) {
  const m = await page.locator(selector).first().evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    const r = el.getBoundingClientRect();
    const gutter = el.offsetWidth - el.clientWidth;
    const cs = getComputedStyle(el);
    const thumb = getComputedStyle(document.documentElement).getPropertyValue("--scrollbar").trim();
    return {
      overflows: el.scrollHeight > el.clientHeight + 1,
      gutter,
      clip: { x: r.right - gutter, y: r.top, width: gutter, height: r.height },
      scrollbarWidth: cs.scrollbarWidth,
      scrollbarColor: cs.scrollbarColor,
      bar: getComputedStyle(el, "::-webkit-scrollbar").display,
      buttons: getComputedStyle(el, "::-webkit-scrollbar-button").display,
      thumb: [1, 3, 5].map((i) => parseInt(thumb.slice(i, i + 2), 16)),
    };
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return m;
}

/**
 * The bar drawn: its ends hold nothing but the track (each row there matches the plain track row
 * next to it, column by column, so a dialog's edge line passes) and its middle holds the thumb.
 * `bottom: false` for a dialog, whose rounded corner cuts through the bottom of the bar; Windows
 * draws its arrow buttons at both ends, so the top end alone still finds them.
 */
async function expectCustomBar(page, m, what, { bottom = true } = {}) {
  expect(m.overflows, `${what} scrolls`).toBe(true);
  // The standard properties stay unset, or they switch the custom rules off.
  expect(m.scrollbarWidth, `${what}: scrollbar-width`).toBe("auto");
  expect(m.scrollbarColor, `${what}: scrollbar-color`).toBe("auto");
  expect(m.buttons, `${what}: ::-webkit-scrollbar-button`).toBe("none");
  expect(m.gutter, `${what}: the bar's width`).toBe(BAR);

  const png = PNG.sync.read(await page.screenshot({ clip: m.clip, animations: "disabled" }));
  const px = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
  // Scrolled to the middle, the thumb is far from both ends: the row just past each end is track.
  const differs = (y, ref) => Array.from({ length: png.width }, (_, x) => x).some((x) => px(x, y).some((v, c) => Math.abs(v - px(x, ref)[c]) > FLAT));
  const top = [...Array(END).keys()].filter((y) => differs(y, END + 2));
  const last = png.height - 1;
  const bottomRows = bottom ? Array.from({ length: END }, (_, i) => last - i).filter((y) => differs(y, last - END - 2)) : [];
  expect([...top, ...bottomRows], `${what}: rows with a drawn shape at the bar's ends (arrow buttons)`).toEqual([]);

  let thumb = 0;
  for (let y = END; y < png.height - END; y++) {
    for (let x = 0; x < png.width; x++) {
      if (px(x, y).every((v, c) => Math.abs(v - m.thumb[c]) <= 3)) thumb++;
    }
  }
  expect(thumb, `${what}: pixels of the --scrollbar thumb`).toBeGreaterThan(40);
}

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("the track list and the settings dialog draw the thin custom bar, without arrow buttons", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await page.locator(".ListRow").filter({ visible: true }).filter({ hasText: "All songs" }).first().click();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("All songs");
    await page.mouse.move(0, 0);
    await expectCustomBar(page, await scroller(page, ".Shell-main"), "the track list");

    await openSettings(app, page);
    const body = await scroller(page, ".SettingsSheet .Sheet-body");
    // A tall window shows every setting without scrolling; the bar is checked where there is one.
    if (body.overflows) await expectCustomBar(page, body, "the settings dialog", { bottom: false });
    else expect(page.viewportSize().height).toBeGreaterThan(900);
  });
});

test.describe("touch (platform android)", { tag: "@phone" }, () => {
  test("no bar on touch: the lists scroll without one", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await page.locator(".ListRow").filter({ visible: true }).filter({ hasText: "All songs" }).first().click();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("All songs");
    const m = await scroller(page, ".Shell-main");
    expect(m.overflows).toBe(true);
    expect(m.bar).toBe("none");
    expect(m.gutter).toBe(0);
    expect(m.scrollbarWidth).toBe("auto");
  });
});
