// What Phase 0 added, on the rebuilt shell: Undo enabled after an edit, the developer section open,
// and the desktop after a playlist add, which must look exactly like the screen before it apart
// from the toast that says what happened. Undo, the status line and the developer section are the
// old ones, inside the settings sheet, until Settings is rebuilt. The labels are the real core's words
// (core/src/ingest), which the mock repeats: "Edited tags of <file name>", "Added 1 track to
// <playlist>", "Restored tags of <file name>".
import { changedPixelsOutside } from "./pixels.mjs";
import { expect, test } from "./harness.mjs";
import { closeSettings, goTo, openPlaylist, openSettings, playSong, row, settle, status } from "./ui.mjs";

const PLAYLIST = "Late Night";

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  const undoButton = (page) => page.locator(".topbar .btn", { hasText: /^Undo$/ });

  test("a playlist add: only the toast changes on screen; Undo then names it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await playSong(app, page, "Quiet Bloom");
    await openSettings(app, page);
    await expect(undoButton(page)).toBeDisabled();
    await expect(undoButton(page)).toHaveAttribute("title", "Nothing to undo");
    await closeSettings(page);
    await settle(app, page);
    const before = await page.screenshot({ animations: "disabled", caret: "hide" });

    await page.locator(".PlayerBar").getByRole("button", { name: "Add to playlist" }).click();
    await page.getByRole("dialog", { name: "Add to playlist" }).locator(".ListRow", { hasText: "Focus" }).click();
    const toast = page.locator(".Toast");
    await expect(toast).toHaveText(/Added Quiet Bloom to Focus/);
    await settle(app, page);
    // The toast and its shadow (a float shadow reaches past its box).
    const t = await page.locator(".Toasts").boundingBox();
    const allowed = [{ x: t.x - 32, y: t.y - 32, width: t.width + 64, height: t.height + 64 }];
    const after = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(changedPixelsOutside(before, after, allowed), "pixels changed outside the toast").toBe(0);

    // The toast goes by itself; the screen is the one before the add again.
    await expect(toast).toHaveCount(0, { timeout: 8000 });
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("after-playlist-add"));

    await openSettings(app, page);
    await expect(status(page)).toHaveText("Status: Added to Focus");
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoButton(page)).toHaveAttribute("title", "Undo: Added 1 track to Focus");
    // The change goes to the lines "Copy log" carries, not to a log panel on screen.
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy log" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear logs" })).toBeDisabled();
  });

  test("Undo enabled after a tag edit, then the edit undone", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    const title = page.locator(".modal input").first();
    await expect(title).toHaveValue("Quiet Bloom");
    await title.fill("Quiet Bloom (Night Edit)");
    await page.locator(".modal .primaryBtn", { hasText: "Save" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(row(page, "Quiet Bloom (Night Edit)")).toBeVisible();
    await page.keyboard.press("Escape"); // drop the selection
    // The settings sheet is photographed over a screen without artwork: a blurred cover grid mixes
    // aqua and purple into blue pixels.
    await goTo(page, "Folders");
    await openSettings(app, page);
    await expect(status(page)).toHaveText("Status: Tags saved: Quiet Bloom - Anouk Lirr");
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoButton(page)).toHaveAttribute("title", "Undo: Edited tags of Quiet Bloom - Anouk Lirr.ogg");
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("undo"));

    await undoButton(page).click();
    await expect(status(page)).toHaveText("Status: Undone: Edited tags of Quiet Bloom - Anouk Lirr.ogg");
    await expect(undoButton(page)).toBeDisabled();
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    // The tags are back: the row and the editor read the old title again.
    await closeSettings(page);
    await goTo(page, "Playlists");
    await openPlaylist(page, PLAYLIST);
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    await expect(page.locator(".modal input").first()).toHaveValue("Quiet Bloom");
    await page.locator(".modal .btn", { hasText: "Cancel" }).click();
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await openSettings(app, page);
    await expect(page.locator(".devBar")).toHaveCount(0);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(page.locator(".devBar")).toBeVisible();
    await expect(status(page)).toHaveText("Status: Developer tools on");
    await expect(page.getByRole("switch")).toHaveText("Test library: off");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("developer"));
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  const undoRow = (page) => page.getByRole("button", { name: "Undo last change" });

  async function openPhoneSettings(app, page) {
    await openSettings(app, page);
    await expect(page.locator(".mSettings")).toBeVisible();
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

  test("Undo last change names the edit, then undoes it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await row(page, "Static Garden").tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await bar.getByRole("button", { name: "Edit tags" }).tap();
    await page.locator(".modal input").first().fill("Static Garden (Live)");
    await page.locator(".modal .primaryBtn", { hasText: "Save" }).tap();
    await expect(page.locator(".modal")).toHaveCount(0);
    await bar.getByRole("button", { name: "Leave Select mode" }).tap();

    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    await expect(status(page)).toHaveText("Tags saved: Static Garden - Sola Brakke");
    await expect(undoRow(page)).toBeEnabled();
    await expect(page.locator(".mSettings")).toContainText("Edited tags of Static Garden - Sola Brakke.opus");
    // No change lines in the settings log, as before the rebuild.
    await expect(page.locator(".mSettings .downloadLogs")).toHaveCount(0);
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoRow(page).tap();
    await expect(status(page)).toHaveText("Undone: Edited tags of Static Garden - Sola Brakke.opus");
    await expect(undoRow(page)).toBeDisabled();
    await expect(page.locator(".mSettings")).toContainText("Nothing to undo");
    await expect(page.locator(".mSettings .downloadLogs")).toHaveCount(0);
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.locator(".mSettings")).toContainText("Nothing to undo");
    // Seven taps on the status pill, each within 1.5 s of the last.
    for (let i = 0; i < 7; i++) await status(page).tap();
    await expect(status(page)).toHaveText("Developer tools on");
    await expect(page.getByRole("switch")).toHaveText("Test library: off");
    await settle(app, page);

    await expect(page).toHaveScreenshot(app.shot("settings-developer"));
  });
});
