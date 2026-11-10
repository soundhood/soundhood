// Every option of every list can be reached (docs/DESIGN.md, Popovers). An open Dropdown or
// MultiSelect list is drawn in the shell's overlay layer against its button, so no sheet body or
// pane that scrolls can clip it; its height is capped to the room on the side it opens to, it
// scrolls inside, and it opens upward only when there is more room above. Checked with 29
// playlists (the owner's count) in "Where should this go?" at 390x844, 834x1194, 760x520 and
// 1280x800: every option scrolls into view, is the element under its own centre, and a click or a
// tap picks it; Home, End and type-ahead keep the active option in view.
import { expect, test } from "./harness.mjs";

const VIDEO = "https://www.youtube.com/watch?v=AbCdEfGhIjK";

/** With the fixture's five, the owner's 29 playlists. */
const MORE_PLAYLISTS = [
  "Acoustic Mornings", "Autumn Drive", "Bedroom Pop", "Blue Hour", "Chill Beats", "City Lights",
  "Deep Work", "Dinner Party", "Early Bird", "Gym Sessions", "Indie Gold", "Jazz Corner",
  "Kitchen Radio", "Long Run", "Morning Coffee", "Night Shift", "Old Favourites", "Party Starters",
  "Rainy Days", "Road Trip", "Summer Hits", "Sunday Slow", "Throwbacks", "Workout",
];
const PLAYLIST_COUNT = 29;

/** The window sizes each project checks: the desktop project also checks the smallest PC window. */
const SIZES = {
  "desktop-1280x800": [
    [1280, 800],
    [760, 520],
  ],
  "phone-390x844": [[390, 844]],
  "tablet-834x1194": [[834, 1194]],
};

/** A link pasted (Ctrl+V) where the focus is. */
const paste = (page) =>
  page.evaluate((url) => {
    const data = new DataTransfer();
    data.setData("text/plain", url);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, VIDEO);

/** True when the element under the centre of `el` is `el` or inside it: it can be seen and hit. */
const hittable = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });

/** The open list's box, its button's box and the window, in px. */
const boxes = (page, name) =>
  page.evaluate((n) => {
    const list = document.querySelector(`[role="listbox"][aria-label="${n}"]`);
    const button = document.querySelector(`[role="combobox"][aria-label="${n}"][aria-expanded="true"]`);
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    return { list: r(list), button: r(button), view: { width: innerWidth, height: innerHeight } };
  }, name);

for (const tag of ["@desktop", "@phone"]) {
  test.describe(`every option of a long list ${tag}`, { tag }, () => {
    test(`29 playlists in "Where should this go?" can each be seen and picked`, async ({ app, page }, testInfo) => {
      const sizes = SIZES[testInfo.project.name];
      test.skip(!sizes, "checked at 1280x800 and 760x520, 390x844 and 834x1194");
      const touch = tag === "@phone";
      await page.addInitScript((names) => {
        const m = window.__soundhoodMock;
        m.store.set("downloader_enabled", true);
        m.addPlaylists(names);
      }, MORE_PLAYLISTS);
      for (const [width, height] of sizes) {
        const at = `${width}x${height}`;
        await page.setViewportSize({ width, height });
        await app.open();
        await paste(page);
        const where = page.getByRole("dialog", { name: "Where should this go?" });
        await expect(where).toBeVisible();
        const button = where.getByRole("combobox", { name: "Playlists" });
        if (touch) await button.tap();
        else await button.click();
        const list = page.getByRole("listbox", { name: "Playlists" });
        await expect(list).toBeVisible();
        const options = list.getByRole("option");
        await expect(options).toHaveCount(PLAYLIST_COUNT);

        // The whole list lies inside the window and clear of its button.
        const b = await boxes(page, "Playlists");
        expect(b.list.top, `${at}: the list's top is in the window`).toBeGreaterThanOrEqual(0);
        expect(b.list.bottom, `${at}: the list's bottom is in the window`).toBeLessThanOrEqual(b.view.height);
        expect(b.list.left, `${at}: the list's left is in the window`).toBeGreaterThanOrEqual(0);
        expect(b.list.right, `${at}: the list's right is in the window`).toBeLessThanOrEqual(b.view.width);
        const clear = b.list.bottom <= b.button.top || b.list.top >= b.button.bottom;
        expect(clear, `${at}: the list does not cover its button`).toBe(true);

        // Every option: scrolled into view, seen, picked by a click or a tap.
        for (let i = 0; i < PLAYLIST_COUNT; i++) {
          const option = options.nth(i);
          const name = (await option.textContent())?.trim();
          await option.scrollIntoViewIfNeeded();
          expect(await hittable(option), `${at}: "${name}" is under its own centre`).toBe(true);
          if (touch) await option.tap({ timeout: 5_000 });
          else await option.click({ timeout: 5_000 });
          await expect(option, `${at}: "${name}" is picked`).toHaveAttribute("aria-selected", "true");
        }
        await expect(button).toHaveText(`${PLAYLIST_COUNT} chosen`);
        await expect(list, "a MultiSelect stays open while it picks").toBeVisible();

        // The keys keep the active option in view.
        await button.focus();
        const active = list.locator(".Option.is-active");
        await page.keyboard.press("End");
        await expect(active).toHaveText(MORE_PLAYLISTS.at(-1));
        expect(await hittable(active), `${at}: End shows the last option`).toBe(true);
        await page.keyboard.press("Home");
        await expect(active).toHaveText("Acoustic Mornings");
        expect(await hittable(active), `${at}: Home shows the first option`).toBe(true);
        await page.keyboard.press("t");
        await expect(active).toHaveText("Throwbacks");
        expect(await hittable(active), `${at}: type-ahead shows the option it finds`).toBe(true);
        await page.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }
    });
  });
}
