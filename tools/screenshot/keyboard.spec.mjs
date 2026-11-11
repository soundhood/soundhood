// The keyboard map (app/src/app/keyboard.ts, docs/SHORTCUTS.md) on the desktop layout, no
// screenshots: playback keys, navigation keys, the list and queue keys, and single keys staying
// quiet while typing in a field.
import { expect, test } from "./harness.mjs";
import { openPlaylist, playSong, searchField } from "./ui.mjs";

const PLAYLIST = "Late Night";
const shown = (locator) => locator.filter({ visible: true });
const nowTitle = (page) => shown(page.locator(".PlayerBar-title"));
const button = (page, name) => shown(page.getByRole("button", { name, exact: true })).first();
/** The player bar's play button, named by what it does now ("Play" or "Pause"). */
const playButton = (page) => page.locator(".PlayerBar .PlayButton");
const toast = (page) => page.locator(".Toast");
/** A song row of the list in the main area (the queue pane has rows of its own). */
const row = (page, title) => shown(page.locator(".Shell-main .TrackRow", { hasText: title }));
/** The newest toast's words (without its Undo). */
const toastText = (page) => toast(page).last().locator("span").first();
const volume = (page) => page.getByRole("slider", { name: "Volume" });
const queueTitles = (page, label) =>
  page
    .locator(".RightPane")
    .getByRole("listbox", { name: label })
    .locator(".TrackRow-title > span:not(.Equaliser)")
    .evaluateAll((els) => els.map((el) => ({ t: el.textContent, y: el.getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.t));

/** Late Night open, Lunar Comets playing, the focus on the list (not on a button). */
async function playing(app, page) {
  await app.open();
  await openPlaylist(page, PLAYLIST);
  await playSong(app, page, "Lunar Comets");
  await row(page, "Lunar Comets").focus();
}

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("Space, Ctrl+Right, Ctrl+Left, Ctrl+Up, Ctrl+Down and M drive the player", async ({ app, page }) => {
    await playing(app, page);
    await page.keyboard.press("Space");
    await expect(playButton(page)).toHaveAttribute("aria-label", "Play");
    await page.keyboard.press("Space");
    await expect(playButton(page)).toHaveAttribute("aria-label", "Pause");
    await page.keyboard.press("Control+ArrowRight");
    await expect(nowTitle(page)).toHaveText("Hollow Garden");
    await page.keyboard.press("Control+ArrowLeft");
    await expect(nowTitle(page)).toHaveText("Lunar Comets");
    await page.keyboard.press("Control+ArrowDown");
    await page.keyboard.press("Control+ArrowDown");
    await expect(volume(page)).toHaveValue("90");
    await page.keyboard.press("Control+ArrowUp");
    await expect(volume(page)).toHaveValue("95");
    await page.keyboard.press("m");
    await expect(button(page, "Unmute")).toBeVisible();
    await expect(volume(page)).toHaveValue("0");
    await page.keyboard.press("m");
    await expect(volume(page)).toHaveValue("95");
    // From the volume slider too: Ctrl+arrows always mean the player.
    await volume(page).focus();
    await page.keyboard.press("Control+ArrowRight");
    await expect(nowTitle(page)).toHaveText("Hollow Garden");
  });

  test("Q shows and hides the queue; 1 to 4 switch screens; Ctrl+K and / find the search field; Esc clears it", async ({ app, page }) => {
    await playing(app, page);
    await page.keyboard.press("q");
    await expect(page.locator(".RightPane")).toBeVisible();
    await page.keyboard.press("q");
    await expect(page.locator(".RightPane")).toHaveCount(0);
    await page.keyboard.press("2");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Artists");
    await page.keyboard.press("3");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Folders");
    await page.keyboard.press("4");
    await expect(page.locator(".FullPlayer")).toBeVisible();
    await page.keyboard.press("1");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Playlists");
    await page.keyboard.press("Control+k");
    await expect(searchField(page)).toBeFocused();
    // Typing: single keys are letters, not shortcuts.
    await page.keyboard.type("q 1");
    await expect(searchField(page)).toHaveValue("q 1");
    await expect(page.locator(".RightPane")).toHaveCount(0);
    await page.locator(".ScreenHeader h1").click();
    await page.keyboard.press("Escape");
    await expect(searchField(page)).toHaveValue("");
    await page.keyboard.press("/");
    await expect(searchField(page)).toBeFocused();
  });

  test("A, Shift+A and X put songs in and out of the queue; Ctrl+L asks before clearing it", async ({ app, page }) => {
    await playing(app, page);
    await page.keyboard.press("q");
    await row(page, "Amber Comets").focus();
    await page.keyboard.press("a");
    await row(page, "Quiet Garden").focus();
    await page.keyboard.press("Shift+A");
    expect(await queueTitles(page, "Next in queue")).toEqual(["Quiet Garden", "Amber Comets"]);
    await row(page, "Quiet Garden").focus();
    await page.keyboard.press("x");
    expect(await queueTitles(page, "Next in queue")).toEqual(["Amber Comets"]);
    await expect(toastText(page)).toHaveText("Removed Quiet Garden from the queue");
    await page.keyboard.press("Control+l");
    await expect(page.getByRole("dialog", { name: "Clear the queue?" })).toBeVisible();
    await page.getByRole("dialog", { name: "Clear the queue?" }).getByRole("button", { name: "Clear", exact: true }).click();
    expect(await queueTitles(page, "Next in queue")).toEqual([]);
    expect(await queueTitles(page, `Next from ${PLAYLIST}`)).toEqual([]);
    await expect(nowTitle(page)).toHaveText("Lunar Comets");
  });

  test("Enter plays the selection; Delete takes it out of the playlist with Undo; Ctrl+E and Ctrl+S open their sheets", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await row(page, "Paper Bloom").click({ modifiers: ["Control"] });
    await row(page, "Silver Garden").click({ modifiers: ["Control"] });
    await page.keyboard.press("Enter");
    await expect(nowTitle(page)).toHaveText("Paper Bloom");
    await page.keyboard.press("Control+ArrowRight");
    await expect(nowTitle(page)).toHaveText("Silver Garden");

    await row(page, "Static Comets").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("dialog", { name: "New playlist" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create and add" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New playlist" })).toHaveCount(0);
    // Esc again ends the selection.
    await page.keyboard.press("Escape");
    await expect(page.locator(".TrackRow.is-selected")).toHaveCount(0);

    await row(page, "Static Comets").click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("dialog", { name: "Edit tags" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await row(page, "Static Comets").focus();
    await page.keyboard.press("Delete");
    await expect(toastText(page)).toHaveText("Removed Static Comets from Late Night");
    await expect(row(page, "Static Comets")).toHaveCount(0);
    await toast(page).last().getByRole("button", { name: "Undo" }).click();
    await expect(row(page, "Static Comets")).toHaveCount(1);
  });
});
