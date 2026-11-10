// The play queue on the mocked UI: the queue photographed at every size (the sheet on the phone and
// the tablet, the right pane on the desktop) under one name, so the parity grid pairs them; then
// what it does: Next follows Play next, Add to queue and the rest of the list; Previous; Repeat;
// a row played, moved, taken out and put back; Clear asks first; Save as playlist; the pane
// remembered; the row menus; songs dragged onto a playlist in the sidebar.
import { expect, test } from "./harness.mjs";
import { goTo, openPlayer, openPlaylist, playSong, row, settle } from "./ui.mjs";

const PLAYLIST = "Late Night";
const SONG = "Lunar Comets";

const shown = (locator) => locator.filter({ visible: true });
/** The song the player shows (the mini player on a phone, the player bar elsewhere). */
const nowTitle = (page) => shown(page.locator(".MiniPlayer-title, .PlayerBar-title"));
/** A player button by name, the one on screen. */
const button = (page, name) => shown(page.getByRole("button", { name, exact: true })).first();
/** The queue on screen (the sheet or the right pane). */
const queue = (page) => shown(page.locator(".Queue"));
/** The titles in one of the queue's sections ("Now playing", "Next in queue", "Next from Late Night"). */
const titlesIn = (page, label) =>
  queue(page)
    .getByRole("listbox", { name: label })
    .locator(".TrackRow-title > span:not(.Equaliser)")
    .evaluateAll((els) => els.map((el) => ({ t: el.textContent, y: el.getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.t));
const toast = (page) => page.locator(".Toast");
/** The newest toast's words (without its Undo). */
const toastText = (page) => toast(page).last().locator("span").first();
/** The player bar's play button, named by what it does now ("Play" or "Pause"). */
const playButton = (page) => page.locator(".PlayerBar .PlayButton");
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));

/** Opens a song row's menu with its more button and picks `item`. */
async function fromRowMenu(page, title, item) {
  const r = row(page, title);
  await r.hover();
  await r.getByRole("button", { name: `More for ${title}` }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: item }).click();
}

/** Opens the queue: the mini player's or the player bar's queue button. */
async function openQueue(page) {
  await button(page, "Queue").click();
  await expect(queue(page)).toBeVisible();
}

/** Late Night playing Lunar Comets, Glass Engine to play next and Amber Comets added to the queue. */
async function queued(app, page) {
  await app.open();
  await openPlaylist(page, PLAYLIST);
  await playSong(app, page, SONG);
  await fromRowMenu(page, "Amber Comets", "Add to queue");
  await expect(toastText(page)).toHaveText("Added Amber Comets to the queue");
  await fromRowMenu(page, "Glass Engine", "Play next");
  await expect(toastText(page)).toHaveText("Glass Engine plays next");
}

test.describe("queue", { tag: ["@desktop", "@phone"] }, () => {
  test("queue", async ({ app, page }) => {
    await queued(app, page);
    await page.mouse.move(0, 0);
    await expect(toast(page)).toHaveCount(0, { timeout: 10_000 });
    await openQueue(page);
    expect(await titlesIn(page, "Now playing")).toEqual([SONG]);
    expect(await titlesIn(page, "Next in queue")).toEqual(["Glass Engine", "Amber Comets"]);
    expect((await titlesIn(page, `Next from ${PLAYLIST}`)).slice(0, 2)).toEqual(["Hollow Garden", "Neon Bloom"]);
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("queue"));
  });

  test("Next plays what was added first, then the rest of the list; Previous goes back", async ({ app, page }) => {
    await queued(app, page);
    await button(page, "Next").click();
    await expect(nowTitle(page)).toHaveText("Glass Engine");
    await button(page, "Next").click();
    await expect(nowTitle(page)).toHaveText("Amber Comets");
    await button(page, "Next").click();
    await expect(nowTitle(page)).toHaveText("Hollow Garden");
    // The playing row in the list follows the queue.
    await expect(row(page, "Hollow Garden")).toHaveClass(/is-playing/);
    await openPlayer(page);
    await button(page, "Previous").click();
    await expect(page.locator(".FullPlayer-title, .FullPlayer-desk h1").filter({ visible: true })).toHaveText("Amber Comets");
  });

  test("the queue sheet opens from the mini player, the player bar and the full player", async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.use.soundhoodPlatform === "windows", "the desktop shows the right pane");
    await queued(app, page);
    await openQueue(page);
    await expect(page.locator(".QueueSheet")).toBeVisible();
    await page.locator(".QueueSheet").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".QueueSheet")).toHaveCount(0);
    await openPlayer(page);
    await page.locator(".FullPlayer").getByRole("button", { name: "Queue", exact: true }).filter({ visible: true }).click();
    await expect(page.locator(".QueueSheet")).toBeVisible();
    expect(await titlesIn(page, "Next in queue")).toEqual(["Glass Engine", "Amber Comets"]);
    // A tap on a row plays it.
    await queue(page).getByRole("listbox", { name: "Next in queue" }).locator(".TrackRow", { hasText: "Amber Comets" }).click();
    await expect(page.locator(".FullPlayer-title, .FullPlayer-desk h1").filter({ visible: true })).toHaveText("Amber Comets");
    expect(await titlesIn(page, "Next in queue")).toEqual([]);
  });
});

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("a row plays, moves with Alt+Down, and leaves with Delete; Undo puts it back", async ({ app, page }) => {
    await queued(app, page);
    await openQueue(page);
    const next = queue(page).getByRole("listbox", { name: "Next in queue" });
    await next.locator(".TrackRow", { hasText: "Glass Engine" }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await titlesIn(page, "Next in queue")).toEqual(["Amber Comets", "Glass Engine"]);
    await next.locator(".TrackRow", { hasText: "Amber Comets" }).focus();
    await page.keyboard.press("Delete");
    expect(await titlesIn(page, "Next in queue")).toEqual(["Glass Engine"]);
    await expect(toastText(page)).toHaveText(/Removed Amber Comets from the queue/);
    await toast(page).last().getByRole("button", { name: "Undo" }).click();
    expect(await titlesIn(page, "Next in queue")).toEqual(["Amber Comets", "Glass Engine"]);
    // A click on a row of the list's rest plays it; the rows above it are skipped.
    await queue(page).getByRole("listbox", { name: `Next from ${PLAYLIST}` }).locator(".TrackRow", { hasText: "Neon Bloom" }).click();
    await expect(nowTitle(page)).toHaveText("Neon Bloom");
    expect((await titlesIn(page, `Next from ${PLAYLIST}`))[0]).toBe("Glass Engine");
    expect(await titlesIn(page, "Next in queue")).toEqual(["Amber Comets", "Glass Engine"]);
  });

  test("Clear asks first and keeps the playing song; Save as playlist makes a playlist of the queue", async ({ app, page }) => {
    await queued(app, page);
    await openQueue(page);
    await queue(page).getByRole("button", { name: "Save as playlist" }).click();
    await page.getByRole("textbox", { name: "Playlist name" }).fill("Tonight");
    await page.getByRole("button", { name: "Create and add" }).click();
    // The playing song, the two added and the nine left of Late Night after Lunar Comets.
    await expect(toastText(page)).toHaveText("Added 12 songs to Tonight");
    await expect(page.locator(".Sidebar-list .NavItem", { hasText: "Tonight" })).toBeVisible();

    await queue(page).getByRole("button", { name: "Clear", exact: true }).click();
    await expect(queue(page)).toContainText("Clear the queue?");
    await queue(page).getByRole("button", { name: "Clear", exact: true }).click();
    expect(await titlesIn(page, "Next in queue")).toEqual([]);
    expect(await titlesIn(page, "Now playing")).toEqual([SONG]);
    await expect(nowTitle(page)).toHaveText(SONG);
  });

  test("the pane is the queue button's and Q's; open or closed is remembered", async ({ app, page }) => {
    await app.open();
    await expect(page.locator(".RightPane")).toHaveCount(0);
    await button(page, "Queue").click();
    await expect(page.locator(".RightPane")).toBeVisible();
    await expect(button(page, "Queue")).toHaveAttribute("aria-pressed", "true");
    await expect(queue(page)).toContainText("Songs you add with Play next or Add to queue show here.");
    await expect.poll(async () => (await storeOf(page)).queue_pane_open).toBe(true);
    // The next start reads it back (the mocked store starts afresh with each page load).
    await page.addInitScript(() => window.__soundhoodMock.store.set("queue_pane_open", true));
    await page.reload();
    await app.settled("list_playlists");
    await expect(page.locator(".RightPane")).toBeVisible();
    await page.locator(".RightPane").getByRole("button", { name: "Hide the queue" }).click();
    await expect(page.locator(".RightPane")).toHaveCount(0);
    await expect.poll(async () => (await storeOf(page)).queue_pane_open).toBe(false);
  });

  test("Repeat goes off, all, one: one plays the song again; off stops after the last song", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await playSong(app, page, "Velvet Engine");
    const repeat = shown(page.locator(".PlayerBar").getByRole("button", { name: /^Repeat/ }));
    // Repeat all is where it starts: the list starts again after its last song, as before.
    await expect(repeat).toHaveAttribute("aria-label", "Repeat");
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    const ended = () => page.evaluate(() => document.querySelector("audio").dispatchEvent(new Event("ended")));
    await ended();
    await expect(nowTitle(page)).toHaveText("Amber Comets");

    await playSong(app, page, "Velvet Engine");
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat one");
    await ended();
    await expect(nowTitle(page)).toHaveText("Velvet Engine");
    await expect(playButton(page)).toHaveAttribute("aria-label", "Pause");

    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-pressed", "false");
    await ended();
    // The first song is loaded and waits.
    await expect(nowTitle(page)).toHaveText("Amber Comets");
    await expect(playButton(page)).toHaveAttribute("aria-label", "Play");
  });

  test("Previous starts the song again past 3 s", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await playSong(app, page, "Paper Bloom");
    // The mocked file cannot be seeked, so the element reports a made-up time.
    await page.evaluate(() => {
      window.__fakeTime = 3.5;
      Object.defineProperty(document.querySelector("audio"), "currentTime", { configurable: true, get: () => window.__fakeTime, set: (v) => (window.__fakeTime = v) });
    });
    await button(page, "Previous").click();
    expect(await page.evaluate(() => window.__fakeTime)).toBe(0);
    await expect(nowTitle(page)).toHaveText("Paper Bloom");
    await button(page, "Previous").click();
    await expect(nowTitle(page)).toHaveText("Quiet Garden");
  });

  test("the row menu: go to the artist, edit tags, delete asks first", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await fromRowMenu(page, "Paper Bloom", "Edit tags");
    await expect(page.getByRole("dialog", { name: "Edit tags" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await fromRowMenu(page, "Paper Bloom", "Delete song");
    await expect(page.getByRole("dialog", { name: "Delete this track?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    // The keyboard opens it too (ContextMenu on the row); Esc closes it and the row keeps the focus.
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(row(page, "Paper Bloom")).toBeFocused();
    await fromRowMenu(page, "Paper Bloom", "Go to artist");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Mira Velloux");
  });

  test("songs dragged onto a playlist in the sidebar are added, with Undo", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    const target = page.locator(".Sidebar-list .NavItem", { hasText: "Empty" });
    await row(page, "Quiet Garden").click({ modifiers: ["Control"] });
    await row(page, "Static Comets").click({ modifiers: ["Control"] });
    await row(page, "Static Comets").dragTo(target);
    await expect(toastText(page)).toHaveText("Added 2 songs to Empty");
    await goTo(page, "Playlists");
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" })).toContainText("2 songs");
    await toast(page).last().getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" })).toContainText("0 songs");
  });
});
