// Keyboard focus on every shell size (docs/DESIGN.md, Accessibility): Tab walks the main screens and
// the settings sheet, and every stop shows the 2 px aqua outline. A control that hides its own
// outline must hand the ring to a box that holds it: the search field's frame, a playlist card (its
// ::after). Checked by computed style at every stop, and by the pixels around the search field,
// which Tab, Ctrl+K and "/" reach.
import { PNG } from "pngjs";
import { expect, test } from "./harness.mjs";
import { openPlaylist, openSettings, playSong, searchField, settle } from "./ui.mjs";

const AQUA = "rgb(0, 255, 191)";
const MAX_STOPS = 90;

/**
 * The focused element and the ring it shows: the element's own outline, else its ::after's (a
 * playlist card), else the search field frame's. Null while the focus is on the page itself.
 */
function focusStop(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    if (!el.dataset.focusWalk) el.dataset.focusWalk = String(document.querySelectorAll("[data-focus-walk]").length + 1);
    const ring = (cs) => ({ style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor });
    const holders = [getComputedStyle(el), getComputedStyle(el, "::after")];
    const frame = el.closest(".SearchField");
    if (frame) holders.push(getComputedStyle(frame));
    const drawn = holders.map(ring).find((r) => r.style !== "none") ?? ring(holders[0]);
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className.split(" ")[0] : el.tagName;
    return {
      id: el.dataset.focusWalk,
      kind: `${el.tagName.toLowerCase()}.${cls || "-"}`,
      name: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || "",
      visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility === "visible",
      ...drawn,
    };
  });
}

/**
 * Tab from where the focus is until it comes round again; every stop must show the ring. Returns the
 * kinds of control met and their names in Tab order.
 */
async function walk(page) {
  const seen = new Set();
  const kinds = new Set();
  const order = [];
  const missing = [];
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press("Tab");
    const stop = await focusStop(page);
    if (!stop) continue;
    if (seen.has(stop.id)) break;
    seen.add(stop.id);
    kinds.add(stop.kind);
    order.push(stop.name);
    const ok = stop.visible && stop.style === "solid" && stop.width === "2px" && stop.color === AQUA;
    if (!ok) missing.push(`${stop.kind} "${stop.name}": ${stop.style} ${stop.width} ${stop.color}`);
  }
  expect(seen.size, "focus stops reached").toBeGreaterThan(5);
  expect(missing, "focus stops without the 2 px aqua ring").toEqual([]);
  return { kinds, order };
}

/** Aqua pixels in a 6 px band around the search field's frame (the ring sits 2 px outside it). */
async function aquaAroundSearch(page) {
  const box = await searchField(page).evaluate((el) => el.closest(".SearchField").getBoundingClientRect().toJSON());
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x) - 6);
  const y = Math.max(0, Math.floor(box.y) - 6);
  const clip = { x, y, width: Math.min(vp.width - x, Math.ceil(box.width) + 12), height: Math.min(vp.height - y, Math.ceil(box.height) + 12) };
  const png = PNG.sync.read(await page.screenshot({ clip, animations: "disabled", caret: "hide" }));
  let aqua = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    if (r < 70 && g > 200 && b > 140 && b < 235) aqua++;
  }
  // The full ring is about 2 * (2 * (width + height)) px; half of that is a ring, not a stray pixel.
  return { aqua, ring: 2 * (box.width + box.height) };
}

async function expectSearchRing(page, how) {
  await expect(searchField(page)).toBeFocused();
  const { aqua, ring } = await aquaAroundSearch(page);
  expect(aqua, `aqua pixels around the search field after ${how}`).toBeGreaterThan(ring);
}

for (const [tag, layout] of [
  ["@desktop", "desktop layout (platform windows)"],
  ["@phone", "touch layouts (platform android)"],
]) {
  test.describe(layout, { tag }, () => {
    test("Tab through Playlists: every stop shows the ring, the search field's frame too", async ({ app, page }) => {
      await app.open();
      await settle(app, page);
      const { kinds, order } = await walk(page);
      // The search field before the screen's own buttons, on every shell: it heads the desktop's
      // sidebar, and the screen header puts its actions after it.
      expect(order.indexOf("Search"), "the search field is a stop").toBeGreaterThanOrEqual(0);
      expect(order.indexOf("Search"), "the search field comes before New playlist").toBeLessThan(order.indexOf("New playlist"));
      // The player bar's position slider is there from the tablet up; the phone has the mini player.
      const wide = page.viewportSize().width >= 720;
      for (const kind of ["input.-", "button.PlaylistCard-open", "button.IconButton", ...(wide ? ["input.Slider"] : [])]) {
        expect([...kinds], `the walk reaches ${kind}`).toContain(kind);
      }
      // Tab, then Ctrl+K and "/" from the page: the frame's ring, in pixels.
      for (let i = 0; i < MAX_STOPS; i++) {
        await page.keyboard.press("Tab");
        if (await searchField(page).evaluate((el) => el === document.activeElement)) break;
      }
      await expectSearchRing(page, "Tab");
      await searchField(page).blur();
      await page.keyboard.press("Control+k");
      await expectSearchRing(page, "Ctrl+K");
      await searchField(page).blur();
      await page.keyboard.press("/");
      await expectSearchRing(page, "/");
    });

    test("Tab through an open playlist with a song playing, and through Settings", async ({ app, page }) => {
      await app.open();
      await openPlaylist(page, "Late Night");
      await playSong(app, page, "Lunar Comets");
      await settle(app, page);
      const { kinds } = await walk(page);
      for (const kind of ["div.TrackRow", "button.Button", "button.Dropdown-button"]) {
        expect([...kinds], `the walk reaches ${kind}`).toContain(kind);
      }
      await openSettings(app, page);
      const { kinds: inSettings } = await walk(page);
      for (const kind of ["button.Switch", "button.Button"]) {
        expect([...inSettings], `the settings walk reaches ${kind}`).toContain(kind);
      }
    });
  });
}
