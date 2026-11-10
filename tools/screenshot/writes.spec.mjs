// Library writes and their reports on the mocked UI. A move or a delete of several songs is one
// journaled change per song today, so its report keeps the id each change's own report carried,
// and "Undo this batch" undoes exactly those, newest first, whatever came after them, stopping at
// the first one that is refused. A delete stops the player when the song it plays went to the bin.
// A playlist deleted is a toast with Undo; a playlist gesture that changed nothing says so, without
// Undo. Undo reports name files without their extension, and the bin by this device's name.
import { expect, test } from "./harness.mjs";
import { goTo, ipcMark, openPlaylist, playSong, report, row, untilCalled } from "./ui.mjs";

const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const history = (page) => page.evaluate(() => window.__soundhoodMock.history.map((h) => h.summary.label));
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);

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

/** Moves Static Garden and Static Tide from Evenings to Archive: two journaled changes, one report. */
async function moveTwoToArchive(page) {
  await openFolder(page, "Evenings");
  await selectAndRun(page, ["Static Garden", "Static Tide"], "Move to folder");
  await page.getByRole("dialog", { name: "Move 2 songs to a folder" }).locator(".ListRow", { hasText: "Archive" }).click();
  await expect(report(page).getByRole("heading")).toHaveText("Moved 2 songs to Archive");
}
const MOVED = ["Moved Static Garden - Sola Brakke.opus to Archive", "Moved Static Tide - Velvet Ferry.opus to Archive"];

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
    // Newest first (they were moved in the list's order), the files named without their extension.
    await expect(u.locator(".BatchRow.is-done .BatchRow-main")).toHaveText([
      "Moved Static Tide - Velvet Ferry back to Evenings",
      "Moved Static Garden - Sola Brakke back to Evenings",
      "Moved Neon Signal - Kestrel Nine back to Evenings",
    ]);
    await expect(u.getByRole("button", { name: "Undo this batch" })).toHaveCount(0);
    expect(await history(page)).toHaveLength(0);
    await u.getByRole("button", { name: "Done" }).last().click();
    for (const s of songs) await expect(row(page, s)).toBeVisible();
  });

  test("Undo this batch undoes its own changes by id; a newer change on top stays", async ({ app, page }) => {
    await app.open();
    await moveTwoToArchive(page);
    // Another change lands on top of the batch (here: straight into the journal).
    await page.evaluate(() =>
      window.__soundhoodMock.history.push({
        summary: { batch: "fixture-other", ts: 1767225699999, label: "Added 1 track to Focus", count: 1 },
        undo: () => ({ label: "Restored playlist Focus", path_before: null, path_after: null }),
      }),
    );
    await report(page).getByRole("button", { name: "Undo this batch" }).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undid 2 of 2 changes");
    await expect(u.locator(".BatchReport-reasons")).toHaveCount(0);
    await expect(u.locator(".BatchRow.is-done .BatchRow-main")).toHaveText([
      "Moved Static Tide - Velvet Ferry back to Evenings",
      "Moved Static Garden - Sola Brakke back to Evenings",
    ]);
    expect(await history(page)).toEqual(["Added 1 track to Focus"]);
  });

  test("a download's playlist add landing between the batch and its Undo is left alone", async ({ app, page }) => {
    await app.open();
    // A download into Mixed Formats (a playlist neither song is in) is running.
    await page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Download" }).click();
    const where = page.getByRole("dialog", { name: "Where should this go?" });
    await where.getByRole("textbox", { name: "Link" }).fill("https://www.youtube.com/watch?v=AbCdEfGhIjK");
    await where.getByRole("combobox", { name: "Playlists" }).click();
    await page.getByRole("option", { name: "Mixed Formats" }).click();
    await page.keyboard.press("Escape");
    await where.getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__soundhoodMock.downloads.length)).toBe(1);

    await moveTwoToArchive(page);
    // It finishes while the report is open: its file joins Mixed Formats, a change of its own.
    const file = app.data.tracks.find((t) => t.name.startsWith("Quiet Bloom")).path;
    await emit(page, "ytdlp:files", [file]);
    await emit(page, "ytdlp:done", 0);
    await expect(toast(page, "Downloaded 1 and added to 1 playlist")).toBeVisible();
    expect(await history(page)).toEqual([...MOVED, "Added 1 track to Mixed Formats"]);

    await report(page).getByRole("button", { name: "Undo this batch" }).click();
    await expect(report(page).getByRole("heading")).toHaveText("Undid 2 of 2 changes");
    expect(await history(page), "the download's add is not the batch's").toEqual(["Added 1 track to Mixed Formats"]);
  });

  test("Undo this batch stops at a refused change and counts only what it undid", async ({ app, page }) => {
    await app.open();
    await moveTwoToArchive(page);
    // The newest change cannot be undone (a sync client changed the file since).
    await page.evaluate(() => (window.__soundhoodMock.undoSkipped = [{ path: "Archive/Static Tide - Velvet Ferry.opus", reason: "changed since, not undone" }]));
    await report(page).getByRole("button", { name: "Undo this batch" }).click();
    const u = report(page);
    await expect(u.getByRole("heading")).toHaveText("Undid 0 of 2 changes");
    await expect(u.locator(".BatchReport-reasons li")).toHaveText([
      'Stopped at "Moved Static Tide - Velvet Ferry to Archive": part of it was left as it was; 1 earlier change was not tried',
      "1 skipped: changed since, not undone",
    ]);
    await expect(u.locator(".BatchRow.is-skipped .BatchRow-main")).toHaveText("Static Tide - Velvet Ferry");
    // Nothing was undone, and the older change was not tried.
    expect(await history(page)).toEqual(MOVED);
  });

  test("a double press on Undo this batch undoes each change once", async ({ app, page }) => {
    await app.open();
    await moveTwoToArchive(page);
    await page.evaluate(() => (window.__soundhoodMock.delay = { undo_batch: 150 }));
    await report(page).getByRole("button", { name: "Undo this batch" }).dblclick();
    await expect(report(page).getByRole("heading")).toHaveText("Undid 2 of 2 changes");
    await page.waitForTimeout(600);
    await expect(report(page).getByRole("heading")).toHaveText("Undid 2 of 2 changes");
    const undos = await page.evaluate(() => window.__soundhoodIpc.calls.filter((c) => c.startsWith("undo_")).length);
    expect(undos, "one undo call per change").toBe(2);
    expect(await history(page)).toEqual([]);
  });

  test("deleting songs: the Recycle Bin named, a refused file as a failed row, the player stopped", async ({ app, page }) => {
    await app.open();
    await openFolder(page, "Evenings");
    await playSong(app, page, "Static Garden");
    await page.evaluate(() => (window.__soundhoodMock.deleteRefused = ["Static Tide - Velvet Ferry.opus"]));
    await selectAndRun(page, ["Static Garden", "Static Tide"], "Delete 2 songs");
    const dialog = page.getByRole("dialog", { name: "Delete 2 songs?" });
    // Several songs come back with Undo this batch (Undo last change takes back one per press).
    await expect(dialog).toContainText("The files go to the Recycle Bin; Undo this batch brings them back.");
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
    // The undo report says the same bin, and names the file without its extension.
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Deleted Static Garden - Sola Brakke (in the Recycle Bin)");
    await expect(report(page).locator(".BatchRow.is-done .BatchRow-main")).toHaveText("Restored Static Garden - Sola Brakke from the Recycle Bin");
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
    const t = toast(page, 'Playlist "Empty" moved to the Recycle Bin (songs untouched)');
    await expect(t).toBeVisible();
    await t.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Undone: Deleted playlist Empty")).toBeVisible();
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" })).toHaveCount(1);
  });

  test("Ctrl+S onto an existing playlist that already holds the song: no change, no Undo", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await row(page, "Static Garden").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+s");
    const sheet = page.getByRole("dialog", { name: "New playlist" });
    await sheet.getByRole("textbox", { name: "Playlist name" }).fill("Late Night");
    const mark = await ipcMark(page);
    await sheet.getByRole("button", { name: "Create and add" }).click();
    await untilCalled(app, page, mark, "playlist_add");
    expect(await history(page)).toEqual([]);
    // Nothing changed: said so, and no Undo that could take back anything else (counted now: a
    // toast that expires would make a waiting count pass).
    expect(await page.locator(".Toast").getByRole("button", { name: "Undo" }).count()).toBe(0);
    const t = toast(page, "Already in Late Night");
    await expect(t).toBeVisible();
    expect(await t.getByRole("button").count()).toBe(0);
  });

  test("Create and add: the toast's Undo takes back the add and the new playlist, nothing else", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await row(page, "Static Garden").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+s");
    const sheet = page.getByRole("dialog", { name: "New playlist" });
    await sheet.getByRole("textbox", { name: "Playlist name" }).fill("Night Drive");
    await sheet.getByRole("button", { name: "Create and add" }).click();
    const t = toast(page, "Added Static Garden to Night Drive");
    await expect(t).toBeVisible();
    expect(await history(page)).toEqual(["Created playlist Night Drive", "Added 1 track to Night Drive"]);
    const mark = await ipcMark(page);
    await t.getByRole("button", { name: "Undo" }).click();
    await untilCalled(app, page, mark, "undo_");
    expect(await history(page)).toEqual([]);
    await expect(toast(page, "Undone: Added 1 song to Night Drive; Created playlist Night Drive")).toBeVisible();
  });

  test("a partial add says how many were really added; its Undo takes back only those", async ({ app, page }) => {
    await app.open();
    await openFolder(page, "Evenings");
    // Static Garden is in Late Night already; Static Tide is not.
    for (const t of ["Static Garden", "Static Tide"]) await row(page, t).click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Add to playlist" }).click();
    const picker = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add 2 songs to a playlist" }) });
    await picker.getByRole("option", { name: /^Late Night/ }).click();
    const t = toast(page, "Added 1 song to Late Night; 1 was already there");
    await expect(t).toBeVisible();
    expect(await history(page)).toEqual(["Added 1 track to Late Night"]);
    const mark = await ipcMark(page);
    await t.getByRole("button", { name: "Undo" }).click();
    await untilCalled(app, page, mark, "undo_");
    await expect(toast(page, "Undone: Added 1 song to Late Night")).toBeVisible();
    expect(await history(page)).toEqual([]);
    // The song that was there before stays; the one the add brought is gone again.
    await page.keyboard.press("Escape");
    await goTo(page, "Playlists");
    await openPlaylist(page, "Late Night");
    await expect(row(page, "Static Garden")).toBeVisible();
    await expect(row(page, "Static Tide")).toHaveCount(0);
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("a delete names the bin, and so do its report and its undo", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await page.locator(".ListRow").filter({ visible: true }).filter({ hasText: "Evenings" }).first().tap();
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await row(page, "Static Garden").tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await bar.getByRole("button", { name: "More actions" }).tap();
    await page.getByRole("menuitem", { name: "Delete song" }).tap();
    const dialog = page.getByRole("dialog", { name: "Delete this song?" });
    await expect(dialog).toContainText("The file goes to the bin; Undo last change in Settings brings it back.");
    await dialog.getByRole("button", { name: "Delete", exact: true }).tap();
    await expect(report(page).getByRole("heading")).toHaveText("Moved 1 song to the bin");
    await report(page).getByRole("button", { name: "Undo this batch" }).tap();
    await expect(report(page).getByRole("heading")).toHaveText("Undone: Deleted Static Garden - Sola Brakke (in the bin)");
  });
});
