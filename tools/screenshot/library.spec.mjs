// Behaviour of the library screens, search and navigation on the mocked UI (no screenshots; the
// screens themselves are in screens.spec.mjs): what loads at start, tap or click plays, selecting
// with a mouse and in Select mode, the selection's actions (add to and remove from a playlist, with
// the toast's Undo), the sort order, a new playlist, search and filtering an open list, the Playing
// tab, the sidebar's remembered width and fold, the test library label.
import { expect, test } from "./harness.mjs";
import { closeSettings, goTo, openPlaylist, openSettings, playSong, row, searchField, settingRow, status } from "./ui.mjs";

/** The settings store as the mock holds it. */
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
/** The titles of the rows in view, top to bottom. */
const titles = (page) =>
  page.locator(".TrackRow .TrackRow-title span").filter({ visible: true }).evaluateAll((els) =>
    els.map((el) => ({ t: el.textContent, y: el.getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.t),
  );
const toast = (page) => page.locator(".Toast");
const card = (page, name) => page.locator(".PlaylistCard", { hasText: name });

test.describe("both layouts", { tag: ["@desktop", "@phone"] }, () => {
  test("at start: the library's playlists, the Playlists tab, the scan in the log", async ({ app, page }) => {
    await app.open();
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Playlists");
    const current = page.locator('.BottomTabs-tab[aria-selected="true"], .Sidebar-nav .NavItem[aria-current="page"]').filter({ visible: true });
    await expect(current).toContainText("Playlists");
    // Nothing plays yet: Playing cannot be opened.
    await expect(page.locator(".BottomTabs-tab, .Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Playing" })).toBeDisabled();
    await openSettings(app, page);
    await expect(status(page)).toHaveText("Found 50 tracks");
  });

  test("the sort order reorders the open list and is remembered", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    expect((await titles(page)).slice(0, 3)).toEqual(["Amber Comets", "Quiet Garden", "Paper Bloom"]);
    await page.getByRole("combobox", { name: "Sort" }).click();
    await page.getByRole("option", { name: "Title Z to A" }).click();
    expect((await titles(page)).slice(0, 3)).toEqual(["Velvet Engine", "Velvet Bloom", "Static Garden"]);
    await expect.poll(async () => (await storeOf(page)).sort).toBe("Title Z→A");
  });

  test("search: results in groups; a result opens its list; the field filters it; Back returns to the search", async ({ app, page }) => {
    await app.open();
    await searchField(page).fill("glass");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Search");
    await expect(page.locator("section[aria-label=Songs] .TrackRow")).toHaveCount(5);
    await page.getByRole("button", { name: "Show all 8" }).click();
    await expect(page.getByRole("toolbar", { name: "Show" }).getByRole("button", { name: "Songs" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("section[aria-label=Songs] .TrackRow")).toHaveCount(8);
    await expect(page.locator("section[aria-label=Artists]")).toHaveCount(0);
    await page.getByRole("toolbar", { name: "Show" }).getByRole("button", { name: "All" }).click();

    await page.locator("section[aria-label=Artists] .ListRow", { hasText: "Glasshouse Tide" }).click();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Glasshouse Tide");
    await expect(searchField(page)).toHaveValue("");
    await expect(page.locator(".TrackRow").filter({ visible: true })).toHaveCount(3);
    // While a list is open the field filters it.
    await searchField(page).fill("amber");
    await expect(page.locator(".TrackRow").filter({ visible: true })).toHaveCount(1);
    await expect(row(page, "Amber Ferry")).toBeVisible();
    await expect(page.locator(".ScreenHeader-meta")).toContainText("1 found");

    // Back (narrower shells; the desktop goes back through the sidebar) returns to the search.
    if (page.viewportSize().width >= 1080) return;
    await page.getByRole("button", { name: "Back", exact: true }).filter({ visible: true }).click();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Search");
    await expect(searchField(page)).toHaveValue("glass");
    // Esc clears the field: the tab's own screen comes back.
    await searchField(page).press("Escape");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Playlists");
  });

  test("a song found by search plays in the library's order", async ({ app, page }) => {
    await app.open();
    await searchField(page).fill("glass engine");
    await playSong(app, page, "Glass Engine");
    await expect(page.locator(".MiniPlayer-title, .PlayerBar-title").filter({ visible: true })).toHaveText("Glass Engine");
  });

  test("Playing: opens over the list and closes back to it", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await goTo(page, "Playing");
    await expect(page.locator(".FullPlayer")).toBeVisible();
    await expect(page.locator(".FullPlayer").getByText("Late Night").first()).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.locator(".FullPlayer")).toHaveCount(0);
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Late Night");
  });

  test("Playing while nothing plays: the tab, the rail icon and the sidebar item are greyed and inert alike", async ({ app, page }) => {
    await app.open();
    // Read the hover colours at once, not a frame into their transition.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
    const playing = page.locator(".BottomTabs-tab, .Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Playing" });
    const look = () => playing.evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor, cursor: getComputedStyle(el).cursor }));
    const disabledColour = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--fg-disabled)";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    await expect(playing).toBeDisabled();
    await expect(playing).toHaveAttribute("aria-disabled", "true");
    const idle = await look();
    expect(idle.color).toBe(disabledColour);
    // No hover: a pointer over it changes nothing, and a click opens nothing.
    await playing.hover({ force: true });
    expect(await look()).toEqual(idle);
    await playing.click({ force: true });
    await expect(page.locator(".FullPlayer")).toHaveCount(0);
    await page.mouse.move(0, 0);
    // Once a song plays it is a normal item again.
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await expect(playing).toBeEnabled();
    await expect(playing).not.toHaveAttribute("aria-disabled");
    expect((await look()).color).not.toBe(disabledColour);
  });

  test("the test library is named on every list screen", async ({ app, page }) => {
    await beforeLoad(page, () => {
      const m = window.__soundhoodMock;
      m.store.set("library_dir", m.fixtureRoot);
      m.store.set("fixture_root", m.fixtureRoot);
    });
    await app.open();
    await expect(page.locator(".ScreenHeader .TestBadge")).toHaveText("Test library");
    await openPlaylist(page, "Late Night");
    await expect(page.locator(".ScreenHeader .TestBadge")).toHaveText("Test library");
    await expect(page.locator("body")).not.toContainText("AppData");
  });
});

test.describe("mouse and keyboard (platform windows)", { tag: "@desktop" }, () => {
  test("a click plays; Ctrl+click and Shift+click select without playing; Esc clears", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Paper Bloom");
    await row(page, "Silver Garden").click({ modifiers: ["Control"] });
    await row(page, "Hollow Garden").click({ modifiers: ["Control"] });
    await expect(page.getByRole("toolbar", { name: "Selection" })).toContainText("2 chosen");
    await expect(row(page, "Paper Bloom")).toHaveClass(/is-playing/);
    await expect(row(page, "Silver Garden")).toHaveAttribute("aria-selected", "true");
    // Shift+click: the range from the last one clicked.
    await row(page, "Static Comets").click({ modifiers: ["Shift"] });
    await expect(page.getByRole("toolbar", { name: "Selection" })).toContainText("5 chosen");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("toolbar", { name: "Selection" })).toHaveCount(0);
    await expect(page.locator('.TrackRow[aria-selected="true"]')).toHaveCount(0);
    // A plain click on another song plays it.
    await row(page, "Velvet Bloom").click();
    await expect(row(page, "Velvet Bloom")).toHaveClass(/is-playing/);
  });

  test("add from the player bar: the toast says so and its Undo puts the playlist back", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Quiet Bloom");
    await page.locator(".PlayerBar").getByRole("button", { name: "Add to playlist" }).click();
    const sheet = page.getByRole("dialog", { name: "Add to playlist" });
    await expect(sheet).toBeVisible();
    // Playlists already holding the song are not offered.
    await expect(sheet.locator(".ListRow", { hasText: "Late Night" })).toHaveCount(0);
    await sheet.locator(".ListRow", { hasText: "Focus" }).click();
    await expect(toast(page)).toContainText("Added Quiet Bloom to Focus");
    await goTo(page, "Playlists");
    await expect(card(page, "Focus")).toContainText("8 songs");
    await openSettings(app, page);
    await expect(settingRow(page, "Undo last change").locator(".SettingRow-help")).toHaveText("Added 1 track to Focus");
    await closeSettings(page);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(card(page, "Focus")).toContainText("7 songs");
  });

  test("remove from the open playlist; a new playlist opens empty", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Focus");
    const first = (await titles(page))[0];
    await row(page, first).click({ modifiers: ["Control"] });
    // Remove from the playlist and Leave Select mode are two different glyphs.
    const glyph = (name) => page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name }).locator("svg").innerHTML();
    expect(await glyph("Remove from Focus")).not.toBe(await glyph("Leave Select mode"));
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Remove from Focus" }).click();
    await expect(toast(page)).toContainText(`Removed ${first} from Focus`);
    await expect(page.locator(".TrackRow").filter({ visible: true })).toHaveCount(6);
    await expect(page.locator(".ScreenHeader-meta")).toContainText("6 songs");

    await goTo(page, "Playlists");
    await page.getByRole("button", { name: "New playlist" }).filter({ visible: true }).first().click();
    const sheet = page.getByRole("dialog", { name: "New playlist" });
    await sheet.getByRole("textbox", { name: "Playlist name" }).fill("Road Trip");
    await sheet.getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Road Trip");
    await expect(page.getByText("This playlist is empty")).toBeVisible();
    await expect(page.locator(".Sidebar-list .NavItem", { hasText: "Road Trip" })).toHaveAttribute("aria-current", "page");
  });

  test("the sidebar folds to the rail and keeps its width; both are remembered", async ({ app, page }) => {
    await app.open();
    const edge = page.getByRole("separator", { name: "Sidebar width" });
    await edge.focus();
    await page.keyboard.press("End");
    await expect(edge).toHaveAttribute("aria-valuenow", "320");
    await page.getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect(page.locator(".Sidebar")).toHaveClass(/is-collapsed/);
    await expect.poll(async () => {
      const s = await storeOf(page);
      return [s.sidebar_width, s.sidebar_collapsed];
    }).toEqual([320, true]);
  });

  test("the sidebar starts as it was left", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("sidebar_width", 280);
      window.__soundhoodMock.store.set("sidebar_collapsed", false);
    });
    await app.open();
    await expect(page.locator(".Sidebar")).not.toHaveClass(/is-collapsed/);
    await expect(page.getByRole("separator", { name: "Sidebar width" })).toHaveAttribute("aria-valuenow", "280");
    expect(await page.locator(".Sidebar").evaluate((el) => el.getBoundingClientRect().width)).toBe(280);
  });
});

test.describe("touch (platform android)", { tag: "@phone" }, () => {
  test("Select mode: taps tick rows; add them to a playlist; Done leaves", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await expect(bar).toContainText("0 chosen");
    await row(page, "Amber Comets").tap();
    await row(page, "Paper Bloom").tap();
    await expect(bar).toContainText("2 chosen");
    // Ticking never plays.
    await expect(page.locator(".TrackRow.is-playing")).toHaveCount(0);
    await bar.getByRole("button", { name: "Add to playlist" }).tap();
    await page.getByRole("dialog", { name: "Add 2 songs to a playlist" }).locator(".ListRow", { hasText: "Focus" }).tap();
    await expect(toast(page)).toContainText("Added 2 songs to Focus");
    await bar.getByRole("button", { name: "Leave Select mode" }).tap();
    await expect(bar).toHaveCount(0);
    // Out of Select mode a tap plays again.
    await row(page, "Amber Comets").tap();
    await expect(row(page, "Amber Comets")).toHaveClass(/is-playing/);
    await goTo(page, "Playlists");
    await expect(card(page, "Focus")).toContainText("9 songs");
  });

  test("Select mode below the desktop width: four buttons; Select all, Remove and Delete in More", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    const bar = page.getByRole("toolbar", { name: "Selection" });
    await row(page, "Paper Bloom").tap();
    const buttons = bar.getByRole("button").filter({ visible: true });
    expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual([
      "Leave Select mode",
      "Add to playlist",
      "Edit tags",
      "More actions",
    ]);
    const more = bar.getByRole("button", { name: "More actions" });
    await more.tap();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Select all", "Remove from Late Night", "Delete song"]);
    await page.getByRole("menuitem", { name: "Select all" }).tap();
    await expect(bar).not.toContainText("1 chosen");
    await more.tap();
    await expect(page.getByRole("menuitem").first()).toHaveText("Select none");
    await page.getByRole("menuitem", { name: "Select none" }).tap();
    await expect(bar).toContainText("0 chosen");
    await row(page, "Paper Bloom").tap();
    await more.tap();
    await page.getByRole("menuitem", { name: "Remove from Late Night" }).tap();
    await expect(toast(page)).toContainText("Removed Paper Bloom from Late Night");
  });

  test("the mini player opens Playing; the tabs hide under it", async ({ app, page }) => {
    test.skip(page.viewportSize().width >= 720, "the mini player and the tabs are the phone shell's (under 720 px)");
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await page.locator(".MiniPlayer-open").tap();
    await expect(page.locator(".FullPlayer")).toBeVisible();
    await expect(page.locator(".BottomTabs")).toBeHidden();
    await page.getByRole("button", { name: "Close the player" }).tap();
    await expect(page.locator(".BottomTabs")).toBeVisible();
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Late Night");
  });
});
