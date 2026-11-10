// What Phase 0 added, on the rebuilt settings: Undo last change names the change in plain words and
// undoes it, a report says what a tag edit and an undo did (and never closes by itself), the
// developer section opens with its gesture, and a playlist add changes nothing on screen but its
// toast. The labels are the real core's words (core/src/ingest), which the mock repeats: "Edited
// tags of <file name>", "Added 1 track to <playlist>", "Restored tags of <file name>"; the app
// shows them (Settings, an undo's report and toast) with songs for tracks and without the file's
// extension.
//
// Every Undo names its own change: a toast's Undo undoes the change its gesture made, by id, and
// nothing else (not a newer change, not the change of a report that is open), and a second press
// of any Undo does nothing while the first runs.
import { changedPixelsOutside } from "./pixels.mjs";
import { expect, test } from "./harness.mjs";
import { closeSettings, goTo, ipcMark, openPlaylist, openSettings, playSong, report, row, settingRow, settle, status, untilCalled } from "./ui.mjs";

const PLAYLIST = "Late Night";
const sheet = (page) => page.locator(".SettingsSheet");
const undoButton = (page) => settingRow(page, "Undo last change").getByRole("button", { name: "Undo" });
const undoHelp = (page) => settingRow(page, "Undo last change").locator(".SettingRow-help");
const developer = (page) => sheet(page).locator("section", { has: page.locator("h3", { hasText: "Developer" }) });
const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const history = (page) => page.evaluate(() => window.__soundhoodMock.history.map((h) => h.summary.label));

/** Edits one song's title in the open list through the selection's Edit tags, and closes the report. */
async function editTitle(page, from, to) {
  await row(page, from).click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit tags" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(to);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(report(page).getByRole("heading")).toContainText("Saved the tags of");
  await report(page).getByRole("button", { name: "Done" }).last().click();
  await page.keyboard.press("Escape");
}

/** Removes a song from the playlist on screen with the Delete key; returns its toast. */
async function removeWithDelete(page, title) {
  await row(page, title).focus();
  await page.keyboard.press("Delete");
  const t = toast(page, `Removed ${title} from`);
  await expect(t).toBeVisible();
  return t;
}

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
    await expect(undoHelp(page)).toHaveText("Added 1 song to Focus");
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
    await expect(undoHelp(page)).toHaveText("Edited tags of Quiet Bloom - Anouk Lirr");
    await expect(undoButton(page)).toBeEnabled();
    await expect(status(page)).not.toContainText("[change]");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoButton(page).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undone: Edited tags of Quiet Bloom - Anouk Lirr");
    await expect(u.locator(".BatchRow.is-done")).toHaveText("Restored tags of Quiet Bloom - Anouk Lirr");
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

  test("two remove toasts: Undo on the older one never takes back the newer one", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    const older = await removeWithDelete(page, "Quiet Bloom");
    await removeWithDelete(page, "Static Garden");
    expect(await history(page)).toEqual(["Removed 1 track from Late Night", "Removed 1 track from Late Night"]);
    // The playlist changed since the older remove (the newer one): the core refuses to force it, and
    // the toast says so. Neither song comes back, and both changes stay undoable.
    const mark = await ipcMark(page);
    await older.getByRole("button", { name: "Undo" }).click();
    await untilCalled(app, page, mark, "undo_");
    expect(await history(page)).toEqual(["Removed 1 track from Late Night", "Removed 1 track from Late Night"]);
    await expect(row(page, "Quiet Bloom")).toHaveCount(0);
    await expect(row(page, "Static Garden")).toHaveCount(0);
    await expect(toast(page, "Undo: 0 restored, 1 left as they are (see the log)")).toBeVisible();
    await expect(report(page)).toHaveCount(0);
  });

  test("a toast's Undo leaves a newer tag edit as it is", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await removeWithDelete(page, "Static Garden");
    await editTitle(page, "Quiet Bloom", "Quiet Bloom (Night Edit)");
    expect(await history(page)).toEqual(["Removed 1 track from Late Night", "Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
    const mark = await ipcMark(page);
    await toast(page, "Removed Static Garden from").getByRole("button", { name: "Undo" }).click();
    await untilCalled(app, page, mark, "undo_");
    expect(await history(page)).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
    await expect(toast(page, "Undone: Removed 1 song from Late Night")).toBeVisible();
    await expect(row(page, "Quiet Bloom (Night Edit)")).toBeVisible();
    await expect(row(page, "Static Garden")).toBeVisible();
  });

  test("a toast's Undo while a tag edit's report is open undoes the toast's change; the report stays", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    const t = await removeWithDelete(page, "Static Garden");
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+e");
    const dialog = page.getByRole("dialog", { name: "Edit tags" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Quiet Bloom (Night Edit)");
    await dialog.getByRole("textbox", { name: "Title" }).press("Enter");
    await expect(report(page).getByRole("heading")).toHaveText("Saved the tags of Quiet Bloom - Anouk Lirr");
    await expect(t).toBeVisible();
    const mark = await ipcMark(page);
    await t.getByRole("button", { name: "Undo" }).click();
    await untilCalled(app, page, mark, "undo_");
    expect(await history(page)).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
    await expect(toast(page, "Undone: Removed 1 song from Late Night")).toBeVisible();
    // The report is the tag edit's, as it was, with its own Undo.
    await expect(report(page).getByRole("heading")).toHaveText("Saved the tags of Quiet Bloom - Anouk Lirr");
    await expect(report(page).getByRole("button", { name: "Undo this batch" })).toBeEnabled();
  });

  test("a double press on Undo last change undoes one change; a toast's Undo pressed twice undoes one", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await editTitle(page, "Quiet Bloom", "Quiet Bloom (A)");
    await editTitle(page, "Static Garden", "Static Garden (B)");
    await goTo(page, "Folders");
    await openSettings(app, page);
    // A slow host leaves room for the second press.
    await page.evaluate(() => (window.__soundhoodMock.delay = { last_change: 60, undo_last: 60, undo_batch: 60 }));
    await undoButton(page).dblclick();
    await expect(report(page).getByRole("heading")).toBeVisible();
    await page.waitForTimeout(800);
    await app.settled();
    expect(await history(page)).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Edited tags of Static Garden - Sola Brakke");
    await report(page).getByRole("button", { name: "Done" }).last().click();
    await closeSettings(page);

    await goTo(page, "Playlists");
    await openPlaylist(page, PLAYLIST);
    const t = await removeWithDelete(page, "Neon Bloom");
    await t.getByRole("button", { name: "Undo" }).dblclick();
    await expect(toast(page, "Undone: Removed 1 song from Late Night")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await history(page)).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
  });

  for (const how of ["typed again with spaces around it", "left as it is (Ctrl+E, then Save)"]) {
    test(`saving the tags a song already has, ${how}: a short "Nothing to change" toast, no report, no Undo, nothing journaled`, async ({ app, page }) => {
      await app.open();
      await openPlaylist(page, PLAYLIST);
      await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
      await page.keyboard.press("Control+e");
      const dialog = page.getByRole("dialog", { name: "Edit tags" });
      // Typed again with spaces around it: the host trims, so nothing changes.
      if (how.startsWith("typed")) await dialog.getByRole("textbox", { name: "Title" }).fill(" Quiet Bloom ");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".Toast")).toHaveText(["Nothing to change"]);
      await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
      await expect(report(page), "no report sheet").toHaveCount(0);
      expect(await history(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await goTo(page, "Folders");
      await openSettings(app, page);
      await expect(undoButton(page)).toBeDisabled();
      await expect(undoHelp(page)).toHaveText("Nothing to undo");
    });
  }

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
    // Below the desktop width Edit tags (one song only) is in More.
    await bar.getByRole("button", { name: "More actions" }).filter({ visible: true }).tap();
    await page.getByRole("menuitem", { name: "Edit tags" }).tap();
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
    await expect(undoHelp(page)).toHaveText("Edited tags of Static Garden - Sola Brakke");
    // No change lines in the log on screen, as before the rebuild.
    await expect(status(page)).not.toContainText("[change]");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoButton(page).tap();
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Edited tags of Static Garden - Sola Brakke");
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
