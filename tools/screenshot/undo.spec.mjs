// Baselines of what Phase 0 adds to the old UI: Undo enabled after an edit, the developer section
// open, and the desktop after a playlist add, which must look exactly like the library baseline
// apart from the Undo button (and the status line and the playlist's count, which said what
// happened before the rebuild too). The labels are the real core's words (core/src/ingest), which
// the mock repeats: "Edited tags of <file name>", "Added 1 track to <playlist>", "Restored tags of
// <file name>".
import { changedPixelsOutside } from "./pixels.mjs";
import { expect, test } from "./harness.mjs";

const PLAYLIST = "Late Night Drive";

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  const undoButton = (page) => page.locator(".topbar .btn", { hasText: /^Undo$/ });
  const status = (page) => page.locator(".topbar .status");

  /** The library baseline's state: a playlist open, a track playing, no selection, mouse away. */
  async function libraryPlaying(app, page) {
    await app.open();
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).click();
    await page.locator(".trackRow", { hasText: "Glass Tides" }).dblclick();
    await app.settled("cover_art");
    await expect(page.locator(".player .npTitle")).toHaveText("Glass Tides - Neon Harbor");
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
  }

  /** Clicks away the focus ring of the last control used and lets IPC settle. */
  async function rest(app, page) {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(0, 0);
    await app.settled();
  }

  test("a playlist add: only the Undo button, the status and the playlist count change", async ({ app, page }) => {
    const target = "Morning Focus";
    await libraryPlaying(app, page);
    await expect(undoButton(page)).toBeDisabled();
    await expect(undoButton(page)).toHaveAttribute("title", "Nothing to undo");
    await rest(app, page);

    const count = page.locator(".pill.artistPill", { hasText: target }).locator(".artistCount");
    const allowedBefore = [await undoButton(page).boundingBox(), await status(page).boundingBox(), await count.boundingBox()];
    const before = await page.screenshot({ animations: "disabled", caret: "hide" });

    await page.locator(".player .ddSmall .ddBtn").click();
    await page.locator(".ddMenu .ddItem", { hasText: target }).click();
    await expect(status(page)).toHaveText(`Status: Added to ${target}`);
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoButton(page)).toHaveAttribute("title", `Undo: Added 1 track to ${target}`);
    await expect(count).toHaveText("11");
    // The change goes to the lines "Copy log" carries, not to a log panel on screen.
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy log" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear logs" })).toBeDisabled();
    await rest(app, page);

    const allowedAfter = [await undoButton(page).boundingBox(), await status(page).boundingBox(), await count.boundingBox()];
    const after = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(changedPixelsOutside(before, after, [...allowedBefore, ...allowedAfter]), "pixels changed outside Undo, status and count").toBe(0);

    await expect(page).toHaveScreenshot(app.shot("after-playlist-add"));
  });

  test("Undo enabled after a tag edit, then the edit undone", async ({ app, page }) => {
    await app.open();
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).click();
    await page.locator(".trackRow", { hasText: "Glass Tides" }).click();
    await page.locator('.iconBtn[title^="Edit the tags of"]').click();
    const title = page.locator(".modal input").first();
    await expect(title).toHaveValue("Glass Tides");
    await title.fill("Glass Tides (Night Edit)");
    await page.locator(".modal .primaryBtn", { hasText: "Save" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(status(page)).toHaveText("Status: Tags saved: Glass Tides - Neon Harbor");
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoButton(page)).toHaveAttribute("title", "Undo: Edited tags of Glass Tides - Neon Harbor.m4a");
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await rest(app, page);

    await expect(page).toHaveScreenshot(app.shot("undo"));

    await undoButton(page).click();
    await expect(status(page)).toHaveText("Status: Undone: Edited tags of Glass Tides - Neon Harbor.m4a");
    await expect(undoButton(page)).toBeDisabled();
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    // The tags are back: the editor reads the old title again.
    await page.locator(".trackRow", { hasText: "Glass Tides" }).click();
    await page.locator('.iconBtn[title^="Edit the tags of"]').click();
    await expect(page.locator(".modal input").first()).toHaveValue("Glass Tides");
    await page.locator(".modal .btn", { hasText: "Cancel" }).click();
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).click();
    await expect(page.locator(".devBar")).toHaveCount(0);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(page.locator(".devBar")).toBeVisible();
    await expect(status(page)).toHaveText("Status: Developer tools on");
    await expect(page.getByRole("switch")).toHaveText("Use fixture root: off");
    await rest(app, page);

    await expect(page).toHaveScreenshot(app.shot("developer"));
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  const status = (page) => page.locator(".topbar .status");
  const undoRow = (page) => page.getByRole("button", { name: "Undo last change" });

  async function openSettings(app, page) {
    await page.locator(".topbar .brand .iconBtn").tap();
    await expect(page.locator(".mSettings")).toBeVisible();
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

  test("Undo last change names the edit, then undoes it", async ({ app, page }) => {
    await app.open();
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).tap();
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await page.locator(".trackRow", { hasText: "Tin Roof Rain" }).tap();
    await page.locator('.iconBtn[title^="Edit the tags of"]').tap();
    await page.locator(".modal input").first().fill("Tin Roof Rain (Live)");
    await page.locator(".modal .primaryBtn", { hasText: "Save" }).tap();
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(status(page)).toHaveText("Tags saved: Tin Roof Rain - Nova Tamsin");
    await page.getByRole("button", { name: "Done", exact: true }).tap();

    await openSettings(app, page);
    await expect(undoRow(page)).toBeEnabled();
    await expect(page.locator(".mSettings")).toContainText("Edited tags of Tin Roof Rain - Nova Tamsin.m4a");
    // No change lines in the settings log, as before the rebuild.
    await expect(page.locator(".mSettings .downloadLogs")).toHaveCount(0);

    await expect(page).toHaveScreenshot(app.shot("settings-undo"));

    await undoRow(page).tap();
    await expect(status(page)).toHaveText("Undone: Edited tags of Tin Roof Rain - Nova Tamsin.m4a");
    await expect(undoRow(page)).toBeDisabled();
    await expect(page.locator(".mSettings")).toContainText("Nothing to undo");
    await expect(page.locator(".mSettings .downloadLogs")).toHaveCount(0);
  });

  test("developer section open", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.locator(".mSettings")).toContainText("Nothing to undo");
    // Seven taps on the status pill, each within 1.5 s of the last.
    for (let i = 0; i < 7; i++) await status(page).tap();
    await expect(status(page)).toHaveText("Developer tools on");
    await expect(page.getByRole("switch")).toHaveText("Use fixture root: off");
    await app.settled();

    await expect(page).toHaveScreenshot(app.shot("settings-developer"));
  });
});
