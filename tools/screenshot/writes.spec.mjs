// Library writes and their reports on the mocked UI. A move or a delete of several songs is one
// journaled change per song today, so its report remembers each change and "Undo this batch"
// undoes them newest first, stopping at a change the batch did not make. A delete stops the player
// when the song it plays went to the bin. A playlist deleted is a toast with Undo.
import { expect, test } from "./harness.mjs";
import { goTo, playSong, report, row } from "./ui.mjs";

const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const history = (page) => page.evaluate(() => window.__soundhoodMock.history.map((h) => h.summary.label));

/** Opens a storage folder from the Folders screen. */
async function openFolder(page, name) {
  await goTo(page, "Folders");
  await page.locator(".ListRow").filter({ visible: true }).filter({ hasText: name }).first().click();
  await expect(page.locator(".ScreenHeader h1")).toHaveText(name);
}

/** Ctrl+click selects each song, then the selection's More actions menu runs `action`. */
async function selectAndRun(page, titles, action) {
  for (const t of titles) await row(page, t).click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("moving three songs: one report; Undo this batch puts all three back", async ({ app, page }) => {
    await app.open();
    await openFolder(page, "Evenings");
    const songs = ["Static Garden", "Static Tide", "Neon Signal"];
    await selectAndRun(page, songs, "Move to folder");
    await page.getByRole("dialog", { name: "Move 3 songs to a folder" }).locator(".ListRow", { hasText: "Archive" }).click();

    const r = report(page);
    await expect(r.getByRole("heading")).toHaveText("Moved 3 songs to Archive");
    await expect(r.locator(".BatchRow.is-done")).toHaveCount(3);
    await expect(r.locator(".BatchRow.is-done").first()).toContainText("Was in Evenings");
    for (const s of songs) await expect(row(page, s)).toHaveCount(0);
    expect(await history(page)).toHaveLength(3);
    // It never closes by itself.
    await page.waitForTimeout(4500);
    await expect(r).toBeVisible();

    await r.getByRole("button", { name: "Undo this batch" }).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undid 3 of 3 changes");
    await expect(u.locator(".BatchRow.is-done")).toHaveCount(3);
    await expect(u.locator(".BatchRow.is-done").first()).toContainText("back to Evenings");
    await expect(u.getByRole("button", { name: "Undo this batch" })).toHaveCount(0);
    expect(await history(page)).toHaveLength(0);
    await u.getByRole("button", { name: "Done" }).last().click();
    for (const s of songs) await expect(row(page, s)).toBeVisible();
  });

  test("Undo this batch stops at a change the batch did not make", async ({ app, page }) => {
    await app.open();
    await openFolder(page, "Evenings");
    await selectAndRun(page, ["Static Garden", "Static Tide"], "Move to folder");
    await page.getByRole("dialog", { name: "Move 2 songs to a folder" }).locator(".ListRow", { hasText: "Archive" }).click();
    await expect(report(page).getByRole("heading")).toHaveText("Moved 2 songs to Archive");
    // Another change lands on top of the batch (here: straight into the journal).
    await page.evaluate(() =>
      window.__soundhoodMock.history.push({
        summary: { batch: "fixture-other", ts: 1767225699999, label: "Added 1 track to Focus", count: 1 },
        undo: () => ({ label: "Restored playlist Focus", path_before: null, path_after: null }),
      }),
    );
    await report(page).getByRole("button", { name: "Undo this batch" }).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undid 0 of 2 changes");
    await expect(u.locator(".BatchReport-reasons")).toContainText('Stopped: the newest change is now "Added 1 track to Focus", which this batch did not make');
    expect(await history(page)).toEqual(["Moved Static Garden - Sola Brakke.opus to Archive", "Moved Static Tide - Velvet Ferry.opus to Archive", "Added 1 track to Focus"]);
  });

  test("deleting songs: the Recycle Bin named, a refused file as a failed row, the player stopped", async ({ app, page }) => {
    await app.open();
    await openFolder(page, "Evenings");
    await playSong(app, page, "Static Garden");
    await page.evaluate(() => (window.__soundhoodMock.deleteRefused = ["Static Tide - Velvet Ferry.opus"]));
    await selectAndRun(page, ["Static Garden", "Static Tide"], "Delete 2 songs");
    const dialog = page.getByRole("dialog", { name: "Delete 2 tracks?" });
    await expect(dialog).toContainText("The files go to the Recycle Bin; Undo last change in Settings brings them back.");
    await expect(dialog.getByRole("listitem")).toHaveText(["Static Garden - Sola Brakke", "Static Tide - Velvet Ferry"]);
    await dialog.getByRole("button", { name: "Delete 2" }).click();
    await expect(dialog).toHaveCount(0);

    const r = report(page);
    await expect(r.getByRole("heading")).toHaveText("Moved 1 song to the Recycle Bin");
    await expect(r.locator(".BatchRow.is-failed")).toContainText("Static Tide - Velvet Ferry");
    await expect(r.locator(".BatchRow.is-failed")).toContainText("file in use");
    await expect(r.locator(".BatchReport-reasons")).toHaveText("1 failed: file in use");
    // The song that was playing went to the bin: nothing plays.
    await expect(page.locator(".Sidebar-nav .NavItem", { hasText: "Playing" })).toBeDisabled();

    await r.getByRole("button", { name: "Undo this batch" }).click();
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Moved Static Garden - Sola Brakke.opus to the bin");
    await report(page).getByRole("button", { name: "Done" }).last().click();
    await expect(row(page, "Static Garden")).toBeVisible();
  });

  test("a playlist deleted: a toast with Undo, which brings it back", async ({ app, page }) => {
    await app.open();
    await page.getByRole("button", { name: "More for Empty" }).click();
    await page.getByRole("menuitem", { name: "Delete playlist" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this playlist?" });
    await expect(dialog).toContainText("Only the playlist file goes to the Recycle Bin");
    await dialog.getByRole("button", { name: "Delete playlist" }).click();
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" })).toHaveCount(0);
    const t = toast(page, 'Playlist "Empty" moved to the Recycle Bin (tracks untouched)');
    await expect(t).toBeVisible();
    await t.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Undone: Deleted playlist Empty")).toBeVisible();
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" })).toHaveCount(1);
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("a delete names the app's bin, and its report the bin", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await page.locator(".ListRow").filter({ visible: true }).filter({ hasText: "Evenings" }).first().tap();
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await row(page, "Static Garden").tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await bar.getByRole("button", { name: "More actions" }).tap();
    await page.getByRole("menuitem", { name: "Delete song" }).tap();
    const dialog = page.getByRole("dialog", { name: "Delete this track?" });
    await expect(dialog).toContainText("The files go to the app's bin; Undo last change in Settings brings them back.");
    await dialog.getByRole("button", { name: "Delete", exact: true }).tap();
    await expect(report(page).getByRole("heading")).toHaveText("Moved 1 song to the bin");
  });
});
