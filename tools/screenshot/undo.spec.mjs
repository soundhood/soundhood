// What Phase 0 added, on the rebuilt settings: Undo last change names the change in plain words and
// undoes it, a report says what a tag edit and an undo did (and never closes by itself), the
// developer section opens with its gesture, and a playlist add changes nothing on screen but its
// toast. The labels are the real core's words (core/src/ingest), which the mock repeats: "Edited
// tags of <file name>", "Added 1 track to <playlist>", "Restored tags of <file name>".
import { changedPixelsOutside } from "./pixels.mjs";
import { expect, test } from "./harness.mjs";
import { closeSettings, goTo, openPlaylist, openSettings, playSong, report, row, settingRow, settle, status } from "./ui.mjs";

const PLAYLIST = "Late Night";
const sheet = (page) => page.locator(".SettingsSheet");
const undoButton = (page) => settingRow(page, "Undo last change").getByRole("button", { name: "Undo" });
const undoHelp = (page) => settingRow(page, "Undo last change").locator(".SettingRow-help");
const developer = (page) => sheet(page).locator("section", { has: page.locator("h3", { hasText: "Developer" }) });
const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();

/** Opens View log and returns its text, then closes it again. */
async function logText(page) {
  await sheet(page).getByRole("button", { name: /^View log/ }).click();
  const log = page.getByRole("dialog", { name: "Log" });
  const text = (await log.locator(".LogText, .SheetNote").first().textContent()) ?? "";
  await log.getByRole("button", { name: "Close", exact: true }).click();
  return text;
}

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("a playlist add: only the toast changes on screen; Undo then names it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await playSong(app, page, "Quiet Bloom");
    await openSettings(app, page);
    await expect(undoButton(page)).toBeDisabled();
    await expect(undoHelp(page)).toHaveText("Nothing to undo");
    await closeSettings(page);
    await settle(app, page);
    const before = await page.screenshot({ animations: "disabled", caret: "hide" });

    await page.locator(".PlayerBar").getByRole("button", { name: "Add to playlist" }).click();
    await page.getByRole("dialog", { name: "Add to playlist" }).locator(".ListRow", { hasText: "Focus" }).click();
    const t = page.locator(".Toast");
    await expect(t).toHaveText(/Added Quiet Bloom to Focus/);
    await settle(app, page);
    // The toast and its shadow (a float shadow reaches past its box).
    const box = await page.locator(".Toasts").boundingBox();
    const allowed = [{ x: box.x - 32, y: box.y - 32, width: box.width + 64, height: box.height + 64 }];
    const after = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(changedPixelsOutside(before, after, allowed), "pixels changed outside the toast").toBe(0);

    // The toast goes by itself; the screen is the one before the add again.
    await expect(t).toHaveCount(0, { timeout: 8000 });
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("after-playlist-add"));

    await openSettings(app, page);
    // Undo names the change next to its button, not in a tooltip.
    await expect(undoHelp(page)).toHaveText("Added 1 track to Focus");
    await expect(undoButton(page)).toBeEnabled();
    // The change goes to the lines "Copy log" carries, not to the log on screen.
    const log = await logText(page);
    expect(log).not.toContain("[change]");
    expect(log).not.toContain("Focus");
  });

  test("a tag edit ends in a report; Undo then names it and undoes it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit tags" });
    const title = dialog.getByRole("textbox", { name: "Title" });
    await expect(title).toHaveValue("Quiet Bloom");
    await title.fill("Quiet Bloom (Night Edit)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    // Tier 1: a report with the before and after, and Undo this batch. It stays until Done.
    const r = report(page);
    await expect(r.getByRole("heading")).toHaveText("Saved the tags of Quiet Bloom - Anouk Lirr");
    await expect(r.locator(".BatchRow.is-done")).toContainText("Quiet Bloom (Night Edit) - Anouk Lirr");
    await expect(r.locator(".BatchRow.is-done")).toContainText("Was Quiet Bloom - Anouk Lirr");
    await expect(r.getByRole("button", { name: "Undo this batch" })).toBeEnabled();
    await r.getByRole("button", { name: "Done" }).last().click();
    await expect(report(page)).toHaveCount(0);
    await expect(row(page, "Quiet Bloom (Night Edit)")).toBeVisible();
    await page.keyboard.press("Escape"); // drop the selection
    // The settings sheet is photographed over a screen without artwork: a blurred cover grid mixes
    // aqua and purple into blue pixels.
    await goTo(page, "Folders");
    await openSettings(app, page);
    await expect(undoHelp(page)).toHaveText("Edited tags of Quiet Bloom - Anouk Lirr.ogg");
    await expect(undoButton(page)).toBeEnabled();
    await expect(status(page)).not.toContainText("[change]");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoButton(page).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undone: Edited tags of Quiet Bloom - Anouk Lirr.ogg");
    await expect(u.locator(".BatchRow.is-done")).toHaveText("Restored tags of Quiet Bloom - Anouk Lirr.ogg");
    // An undo cannot be undone from its own report.
    await expect(u.getByRole("button", { name: "Undo this batch" })).toHaveCount(0);
    await u.getByRole("button", { name: "Done" }).last().click();
    await expect(undoButton(page)).toBeDisabled();
    await expect(undoHelp(page)).toHaveText("Nothing to undo");
    expect(await logText(page)).not.toContain("[change]");
    // The tags are back: the row and the editor read the old title again.
    await closeSettings(page);
    await goTo(page, "Playlists");
    await openPlaylist(page, PLAYLIST);
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    await expect(page.getByRole("dialog", { name: "Edit tags" }).getByRole("textbox", { name: "Title" })).toHaveValue("Quiet Bloom");
    await page.getByRole("dialog", { name: "Edit tags" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Edit tags" })).toHaveCount(0);
  });

  test("a refused tag write keeps the dialog open with the reason", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit tags" });
    // The core refuses a file a sync client rewrote a moment ago.
    await page.evaluate(() => (window.__soundhoodMock.writeTagsError = "changed a few seconds ago"));
    await dialog.getByRole("textbox", { name: "Title" }).fill("Quiet Bloom (Live)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.locator(".ErrorRow")).toContainText("Not saved");
    await expect(dialog.locator(".ErrorRow")).toContainText("changed a few seconds ago");
    await expect(report(page)).toHaveCount(0);
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await openSettings(app, page);
    await expect(developer(page)).toHaveCount(0);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(developer(page)).toBeVisible();
    await expect(toast(page, "Developer tools on")).toBeVisible();
    await expect(sheet(page).getByRole("switch", { name: "Test library" })).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".Toast")).toHaveCount(0, { timeout: 8000 });
    await developer(page).scrollIntoViewIfNeeded();
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-developer"));
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  async function openPhoneSettings(app, page) {
    await openSettings(app, page);
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

  test("Undo last change names the edit, then undoes it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await row(page, "Static Garden").tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await bar.getByRole("button", { name: "Edit tags" }).tap();
    const dialog = page.getByRole("dialog", { name: "Edit tags" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Static Garden (Live)");
    await dialog.getByRole("button", { name: "Save" }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(report(page).getByRole("heading")).toHaveText("Saved the tags of Static Garden - Sola Brakke");
    await report(page).getByRole("button", { name: "Done" }).last().tap();
    await bar.getByRole("button", { name: "Leave Select mode" }).tap();

    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoHelp(page)).toHaveText("Edited tags of Static Garden - Sola Brakke.opus");
    // No change lines in the log on screen, as before the rebuild.
    await expect(status(page)).not.toContainText("[change]");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoButton(page).tap();
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Edited tags of Static Garden - Sola Brakke.opus");
    await report(page).getByRole("button", { name: "Done" }).last().tap();
    await expect(undoButton(page)).toBeDisabled();
    await expect(undoHelp(page)).toHaveText("Nothing to undo");
    expect(await logText(page)).not.toContain("[change]");
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    await expect(sheet(page).getByRole("switch", { name: "Test library" })).toHaveCount(0);
    await expect(undoHelp(page)).toHaveText("Nothing to undo");
    // Seven taps on the version row (About), each within 1.5 s of the last.
    const version = sheet(page).locator(".VersionRow");
    await version.scrollIntoViewIfNeeded();
    for (let i = 0; i < 6; i++) await version.tap();
    await expect(developer(page)).toHaveCount(0);
    await version.tap();
    await expect(toast(page, "Developer tools on")).toBeVisible();
    await expect(developer(page)).toBeVisible();
    await expect(sheet(page).getByRole("switch", { name: "Test library" })).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".Toast")).toHaveCount(0, { timeout: 8000 });
    await developer(page).scrollIntoViewIfNeeded();
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-developer"));

    // The same gesture hides it again.
    for (let i = 0; i < 7; i++) await version.tap();
    await expect(developer(page)).toHaveCount(0);
  });
});
