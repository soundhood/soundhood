// Keyboard focus on every shell size (docs/DESIGN.md, Accessibility): Tab walks the main screens and
// the settings sheet, and every stop shows the 2 px aqua outline. A control that hides its own
// outline must hand the ring to a box that holds it: the search field's frame, a playlist card (its
// ::after). Checked by computed style at every stop, and by the pixels around the search field,
// which Tab, Ctrl+K and "/" reach. And the focus never falls to the page when what had it goes
// (useFocusReturn): Esc leaving Select mode from the bar's More menu, Esc closing the full player,
// the setup's Done, and a song's row menu closed by a scroll of the list or a resize of the window.
import { PNG } from "pngjs";
import { expect, test } from "./harness.mjs";
import { openPlayer, openPlaylist, openSettings, playSong, row, searchField, settle } from "./ui.mjs";

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

/** Where the focus is: "the page" when nowhere, else the element and whether it is in the main area. */
const focusPlace = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return "the page";
    return `${el.closest(".Shell-main") ? "main" : "elsewhere"}: ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`;
  });

for (const tag of ["@desktop", "@phone"]) {
  test.describe(`the focus never falls to the page ${tag}`, { tag }, () => {
    test.beforeEach(({}, testInfo) => {
      test.skip(!["desktop-1280x800", "phone-390x844"].includes(testInfo.project.name), "one PC and one phone size");
    });

    test("Esc twice from the selection bar's More menu: the menu closes, then Select mode, and the focus is back in the list", async ({ app, page }) => {
      await app.open();
      await openPlaylist(page, "Late Night");
      if (tag === "@phone") {
        await page.getByRole("button", { name: "Select", exact: true }).filter({ visible: true }).first().click();
        await row(page, "Paper Bloom").click();
      } else await row(page, "Paper Bloom").click({ modifiers: ["Control"] });
      const bar = page.getByRole("toolbar", { name: "Selection" });
      await bar.getByRole("button", { name: "More actions" }).filter({ visible: true }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(bar.getByRole("button", { name: "More actions" }).filter({ visible: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(bar).toHaveCount(0);
      await expect.poll(() => focusPlace(page)).toMatch(/^main: /);
      if (tag === "@desktop") await expect(row(page, "Paper Bloom"), "back on the row that started Select mode").toBeFocused();
    });

    test("Esc closing the full player from its More menu: the focus is back on what opened it", async ({ app, page }) => {
      test.skip(tag === "@phone", "on the phone the mini player opens it, by touch");
      for (const size of [{ width: 1280, height: 800 }, { width: 760, height: 520 }]) {
        await page.setViewportSize(size);
        await app.open();
        await openPlaylist(page, "Late Night");
        await playSong(app, page, "Lunar Comets");
        await openPlayer(page);
        await page.locator(".FullPlayer").getByRole("button", { name: /^More for/ }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.locator(".FullPlayer")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }), `${size.width}x${size.height}`).toBeFocused();
      }
    });

    test("the setup's Done: the focus is in the main area", async ({ app, page }) => {
      await page.addInitScript(() => {
        const m = window.__soundhoodMock;
        m.store.clear();
        m.pickFolder = window.__SOUNDHOOD_FIXTURE__.root;
      });
      await app.open({ until: "platform" });
      const setup = page.getByRole("dialog", { name: "Set up Soundhood" });
      await expect(setup).toBeVisible();
      for (const step of ["Skip", "Skip"]) await setup.getByRole("button", { name: step }).click();
      await setup.getByRole("button", { name: "Done" }).click();
      await expect(setup).toHaveCount(0);
      await expect.poll(() => focusPlace(page)).toMatch(/^main: /);
    });
  });
}

/** The row menu's facts: how many items, its own height against its content's, its box. */
const menuFacts = (page) =>
  page.getByRole("menu").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { items: el.querySelectorAll('[role="menuitem"]').length, client: el.clientHeight, content: el.scrollHeight, top: r.top, bottom: r.bottom };
  });

test.describe("a song's row menu and the focus", { tag: "@desktop" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "1280x800 and 760x520, from the 1280x800 project");
  });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 760, height: 520 },
  ]) {
    test(`closed by a scroll of the list or a resize of the window, it gives the focus back to its row (${size.width}x${size.height})`, async ({ app, page }) => {
      await page.setViewportSize(size);
      await app.open();
      await openPlaylist(page, "Late Night");
      const menu = page.getByRole("menu");
      const target = row(page, "Paper Bloom");
      await target.focus();
      await page.keyboard.press("Shift+F10");
      await expect(menu).toBeVisible();
      // Over the list, left of the menu (end-aligned with the row's more button, on the right).
      const main = await page.locator(".Shell-main").boundingBox();
      await page.mouse.move(main.x + 40, main.y + main.height - 30);
      await page.mouse.wheel(0, 80);
      await expect(menu).toHaveCount(0);
      await expect(target, "after a scroll of the list").toBeFocused();
      await page.keyboard.press("Shift+F10");
      await expect(menu).toBeVisible();
      await page.setViewportSize({ width: size.width - 40, height: size.height });
      await expect(menu).toHaveCount(0);
      await expect(target, "after a resize of the window").toBeFocused();
    });
  }

  test("at 760x520 a right-click near the middle shows the 7-item menu whole, and a wheel over it leaves it open", async ({ app, page }) => {
    await page.setViewportSize({ width: 760, height: 520 });
    await app.open();
    await openPlaylist(page, "Late Night");
    const menu = page.getByRole("menu");
    for (const y of [252, 256, 260, 264, 268]) {
      expect(await page.evaluate((yy) => !!document.elementFromPoint(300, yy)?.closest(".TrackRow"), y), `a song row at y=${y}`).toBe(true);
      await page.mouse.click(300, y, { button: "right" });
      await expect(menu).toBeVisible();
      const m = await menuFacts(page);
      expect(m.items, `y=${y}`).toBe(7);
      expect(m.client, `y=${y}: the whole menu shows, not capped`).toBe(m.content);
      expect(m.top, `y=${y}`).toBeGreaterThanOrEqual(8);
      expect(m.bottom, `y=${y}`).toBeLessThanOrEqual(520 - 8);
      const box = await menu.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(300);
      await expect(menu, `y=${y}: still open after a wheel over it`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }
  });

  test("at 760x520 a row menu that fits neither below nor above its button scrolls inside, and its own scroll never closes it", async ({ app, page }) => {
    await page.setViewportSize({ width: 760, height: 520 });
    await app.open();
    await openPlaylist(page, "Late Night");
    // The row whose more button sits nearest the middle of the window.
    const title = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".Shell-main .TrackRow")].filter((r) => r.getClientRects().length > 0);
      const off = (r) => {
        const b = (r.querySelector(".IconButton") ?? r).getBoundingClientRect();
        return Math.abs((b.top + b.bottom) / 2 - innerHeight / 2);
      };
      rows.sort((a, b) => off(a) - off(b));
      return rows[0]?.querySelector(".TrackRow-title > span:not(.Equaliser)")?.textContent ?? "";
    });
    const target = row(page, title);
    await target.focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const m = await menuFacts(page);
    expect(m.content, `${title}: capped, it scrolls inside`).toBeGreaterThan(m.client);
    const box = await menu.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => menu.evaluate((el) => el.scrollTop), "the menu scrolled").toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(menu, "still open after its own scroll").toBeVisible();
    await expect(menu.getByRole("menuitem").last(), "scrolled to its last item").toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(target).toBeFocused();
  });
});
