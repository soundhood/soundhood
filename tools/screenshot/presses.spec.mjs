// A held key is one press (docs/DESIGN.md, Keyboard): Button, IconButton, a menu's items and a
// list's options ignore the repeated keydowns of a held Enter, so holding Enter on a control does
// what one press does, even when the focus lands on the next control of the same kind.
import { expect, test } from "./harness.mjs";
import { openPlaylist, openSettings, report, row, settingRow } from "./ui.mjs";

/** Holds `key` down for `n` keydowns (the first one, then `n - 1` auto-repeats). */
async function hold(page, key, n = 20, gap = 33) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(gap);
  }
  await page.keyboard.up(key);
}

const calls = (page, cmd) => page.evaluate((c) => window.__soundhoodIpc.calls.filter((x) => x === c).length, cmd);
const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });

test.describe("held Enter", { tag: "@desktop" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the keys are the same at every PC size");
  });

  test("on Remove in Links waiting removes one link (IconButton)", async ({ app, page }) => {
    const urls = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map((id) => `https://www.youtube.com/watch?v=${id}`);
    await page.addInitScript((list) => window.__soundhoodMock.store.set("share_queue", list.map((url, i) => ({ url, added: 4 - i }))), urls);
    await app.open();
    await openSettings(app, page);
    await dialog(page, "Settings").locator(".SettingRow", { hasText: "Links waiting" }).click();
    const rows = dialog(page, "Links waiting").getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await rows.nth(0).getByRole("button", { name: "Remove from the list" }).focus();
    await hold(page, "Enter", 12, 40);
    await page.waitForTimeout(300);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("bbbbbbbbbbb");
  });

  test("on Undo last change undoes one change (Button)", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    for (const t of ["Quiet Bloom", "Paper Bloom", "Amber Comets"]) {
      await row(page, t).click();
      await page.keyboard.press("Delete");
      await expect(row(page, t)).toHaveCount(0);
      await app.settled();
    }
    await openSettings(app, page);
    await settingRow(page, "Undo last change").getByRole("button").focus();
    await hold(page, "Enter", 30, 50);
    await page.waitForTimeout(800);
    await app.settled();
    expect(await calls(page, "undo_batch"), "one undo").toBe(1);
    expect(await page.evaluate(() => window.__soundhoodMock.history.length), "two changes left to undo").toBe(2);
  });

  test("after deleting every song of a playlist, cannot open its menu and pick Delete playlist (MenuButton items)", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+a");
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "More actions" }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: /^Delete/ }).click();
    await page.getByRole("dialog", { name: /^Delete \d+ songs/ }).getByRole("button", { name: /^Delete \d+/ }).click();
    await expect(report(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(report(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More for Late Night" }).filter({ visible: true })).toBeFocused();
    await hold(page, "Enter", 20);
    await page.waitForTimeout(400);
    await expect(dialog(page, "Delete this playlist?"), "no item was picked by a repeat").toHaveCount(0);
    await expect(page.getByRole("menu", { name: "More for Late Night" }), "the first press opened the menu").toBeVisible();
    expect(await calls(page, "playlist_delete")).toBe(0);
  });

  test("on an option of the Sort list picks it once, and the list stays closed (listbox options)", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    const sort = page.getByRole("combobox", { name: "Sort" }).filter({ visible: true });
    const list = page.getByRole("listbox", { name: "Sort" });
    await sort.focus();
    await page.keyboard.press("Enter");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const next = (await list.locator(".Option.is-active").textContent()) ?? "";
    // An even number of keydowns: each repeat would open the list again or pick again.
    await hold(page, "Enter", 16);
    await expect(sort).toHaveText(next);
    await page.waitForTimeout(200);
    await expect(list, "the repeats did not open it again").toHaveCount(0);
    await expect(sort).toBeFocused();
  });
});
