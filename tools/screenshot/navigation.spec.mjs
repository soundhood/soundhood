// Where the focus goes after a navigation (docs/DESIGN.md, Accessibility; docs/SHORTCUTS.md): Enter
// on a card or a row, Back, the tab digits, "4" for Playing, and a click or tap on a card, on Back or
// on a navigation item. The focus lands on the new screen's heading (the full player's on Playing):
// never on a button, a card or a row, so Space stays play and pause, Ctrl+E with nothing chosen
// edits the playing song, Tab leads into the screen, no row's More button shows for a focus the user
// never put there, and Back to a scrolled grid keeps its scroll. At 1280x800 and 760x520 (from the
// 1280x800 project), 834x1194 and 390x844.
import { expect, test } from "./harness.mjs";
import { goTo, openPlaylist, playSong, row, searchField } from "./ui.mjs";

/** What has the focus: where (the main area, the full player, elsewhere, the page) and what kind. */
const focusFacts = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return { at: "the page" };
    const at = el.closest(".FullPlayer") ? "player" : el.closest(".Shell-main") ? "main" : "elsewhere";
    const kind = el.matches('[role="listbox"] [role="option"]')
      ? "row"
      : el.matches(".PlaylistCard-open")
        ? "card"
        : el.matches("h1, h2")
          ? "heading"
          : el.tagName.toLowerCase();
    return { at, kind, name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40) };
  });

/** The focus on the screen's heading, `name`, in the main area or the full player. */
const onHeading = (name, at = "main") => ({ at, kind: "heading", name });

const heading = (page) => page.locator(".ScreenHeader h1").filter({ visible: true }).first();
const firstOption = (page) => page.locator('.Shell-main [role="listbox"] [role="option"]').filter({ visible: true }).first();
const firstCard = (page) => page.locator(".PlaylistCard-open").filter({ visible: true }).first();
const fullPlayer = (page) => page.locator(".FullPlayer");
const back = (page) => page.getByRole("button", { name: "Back" }).filter({ visible: true });

/** The play button on screen says Pause while the music plays. */
const playing = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="Pause"], button[aria-label="Play"]')].find((x) => x.getClientRects().length > 0);
    return b?.getAttribute("aria-label") === "Pause";
  });

/** Space toggles play and pause from where the focus is (it presses nothing). */
async function spaceToggles(page, where) {
  const before = await playing(page);
  const at = await focusFacts(page);
  await page.keyboard.press(" ");
  await expect.poll(() => playing(page), `Space ${where}`).toBe(!before);
  expect(await focusFacts(page), `Space ${where} moved nothing`).toEqual(at);
}

/** Tab from the heading reaches the screen's list (a row or a card) within the screen's own controls. */
async function tabReaches(page, kind, where) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const now = await focusFacts(page);
    expect(now.at, `Tab from the heading ${where} stays in the screen`).toBe("main");
    if (now.kind === kind) return;
  }
  throw new Error(`Tab from the heading ${where} never reached a ${kind}`);
}

/** No song row's More button shows unhovered (only a focus or the pointer in a row shows it). */
const moreShown = (page) =>
  page.locator(".Shell-main .TrackRow .IconButton").evaluateAll((els) => els.filter((b) => b.getClientRects().length && getComputedStyle(b).opacity !== "0").length);

for (const tag of ["@desktop", "@phone"]) {
  test.describe(`keyboard navigation puts the focus on the new screen's heading ${tag}`, { tag }, () => {
    test("Enter on a playlist card: the open list's heading, and Tab reaches its rows; Back (where it shows): the Playlists heading", async ({ app, page }) => {
      await app.open();
      await page.locator(".PlaylistCard-open").filter({ visible: true }).filter({ hasText: "Late Night" }).focus();
      await page.keyboard.press("Enter");
      await expect(heading(page)).toHaveText("Late Night");
      await expect.poll(() => focusFacts(page)).toEqual(onHeading("Late Night"));
      await tabReaches(page, "row", "of Late Night");
      if (await back(page).count()) {
        await back(page).focus();
        await page.keyboard.press("Enter");
        await expect(heading(page)).toHaveText("Playlists");
        await expect.poll(() => focusFacts(page)).toEqual(onHeading("Playlists"));
        await tabReaches(page, "card", "of Playlists");
      }
    });

    test("Enter on an artist row and on a folder row: the open list's heading, and Tab reaches its rows", async ({ app, page }) => {
      await app.open();
      for (const [digit, screen] of [
        ["2", "Artists"],
        ["3", "Folders"],
      ]) {
        await firstCard(page).focus();
        await page.keyboard.press(digit);
        await expect(heading(page)).toHaveText(screen);
        await expect.poll(() => focusFacts(page), `${screen}: its heading`).toEqual(onHeading(screen));
        await tabReaches(page, "row", `of ${screen}`);
        await firstOption(page).focus();
        await page.keyboard.press("Enter");
        await expect(heading(page)).not.toHaveText(screen);
        const opened = await heading(page).textContent();
        await expect.poll(() => focusFacts(page), `the list opened from ${screen}`).toEqual(onHeading(opened));
        await tabReaches(page, "row", `of ${opened}`);
        await page.keyboard.press("1");
        await expect(heading(page)).toHaveText("Playlists");
        await expect.poll(() => focusFacts(page), "Playlists: its heading").toEqual(onHeading("Playlists"));
      }
    });

    test("the tab digits 1 to 3 from a song row, and 4 for Playing: the heading, and Space plays and pauses", async ({ app, page }) => {
      await app.open();
      await openPlaylist(page, "Late Night");
      await playSong(app, page, "Lunar Comets");
      await row(page, "Paper Bloom").focus();
      for (const [digit, screen] of [
        ["2", "Artists"],
        ["3", "Folders"],
        ["1", "Playlists"],
      ]) {
        await page.keyboard.press(digit);
        await expect(heading(page)).toHaveText(screen);
        await expect.poll(() => focusFacts(page), `"${digit}": ${screen}`).toEqual(onHeading(screen));
        await spaceToggles(page, `after "${digit}"`);
      }
      await page.keyboard.press("4");
      await expect(fullPlayer(page)).toBeVisible();
      await expect.poll(() => focusFacts(page), "4: Playing").toEqual(onHeading("Lunar Comets", "player"));
      await spaceToggles(page, 'after "4"');
      await page.keyboard.press("Tab");
      expect((await focusFacts(page)).at, "Tab from the player's heading stays in the player").toBe("player");
    });
  });
}

test.describe("a click on a card, on Back or on a navigation item @desktop", { tag: "@desktop" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "1280x800 and 760x520, from the 1280x800 project");
  });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 760, height: 520 },
  ]) {
    test(`leaves the focus on the heading: Space plays and pauses, Ctrl+E edits the playing song (${size.width}x${size.height})`, async ({ app, page }) => {
      await page.setViewportSize(size);
      await app.open();
      await page.locator(".PlaylistCard-open").filter({ visible: true }).filter({ hasText: "Late Night" }).click();
      await expect(heading(page)).toHaveText("Late Night");
      await expect.poll(() => focusFacts(page)).toEqual(onHeading("Late Night"));
      // Under 1080 px the rows always show their More; above, only for a focus or the pointer.
      await page.mouse.move(2, 2);
      if (size.width >= 1080) await expect.poll(() => moreShown(page), "no row's More shows for a focus the user never put there").toBe(0);
      await page.keyboard.press("Control+e");
      await page.waitForTimeout(300);
      await expect(page.getByRole("dialog"), "Ctrl+E with nothing chosen and nothing playing opens nothing").toHaveCount(0);

      await playSong(app, page, "Lunar Comets");
      // Back on the narrow window, the sidebar's Playlists on the wide one.
      if (await back(page).count()) await back(page).click();
      else await goTo(page, "Playlists");
      await expect(heading(page)).toHaveText("Playlists");
      await expect.poll(() => focusFacts(page), "a click on Back or Playlists").toEqual(onHeading("Playlists"));
      await spaceToggles(page, "after a click on Back or Playlists");

      await page.locator(".PlaylistCard-open").filter({ visible: true }).filter({ hasText: "Late Night" }).click();
      await expect.poll(() => focusFacts(page)).toEqual(onHeading("Late Night"));
      await spaceToggles(page, "after a click on a card");
      await page.keyboard.press("Control+e");
      const editor = page.getByRole("dialog", { name: "Edit tags" });
      await expect(editor.getByRole("textbox", { name: "Title" }), "Ctrl+E with nothing chosen: the playing song").toHaveValue("Lunar Comets");
      await page.keyboard.press("Escape");
      await expect(editor).toHaveCount(0);

      await page.keyboard.press("1");
      await expect.poll(() => focusFacts(page), '"1"').toEqual(onHeading("Playlists"));
      await spaceToggles(page, 'after "1"');
      await page.keyboard.press("4");
      await expect(fullPlayer(page)).toBeVisible();
      await expect.poll(() => focusFacts(page), '"4"').toEqual(onHeading("Lunar Comets", "player"));
      await spaceToggles(page, 'after "4"');
      await page.keyboard.press("Escape");
      await expect(fullPlayer(page)).toHaveCount(0);
      await expect.poll(() => focusFacts(page), "the full player closed").toMatchObject({ at: "main", kind: "heading" });
    });
  }

  test("a sidebar item reached with the keyboard keeps the focus; one clicked hands it to the heading", async ({ app, page }) => {
    await app.open();
    const artists = page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Artists" });
    await artists.focus();
    await page.keyboard.press("Enter");
    await expect(heading(page)).toHaveText("Artists");
    await expect(artists, "the keyboard's place in the sidebar").toBeFocused();
    await goTo(page, "Folders");
    await expect.poll(() => focusFacts(page)).toEqual(onHeading("Folders"));
  });

  test("Back to a scrolled grid keeps its scroll and puts the focus on the heading, not on an off-screen card (760x520)", async ({ app, page }) => {
    await page.setViewportSize({ width: 760, height: 520 });
    await page.addInitScript(() =>
      window.__soundhoodMock.addPlaylists(["Acoustic Mornings", "Autumn Drive", "Bedroom Pop", "Blue Hour", "Chill Beats", "City Lights", "Deep Work", "Dinner Party", "Early Bird", "Gym Sessions", "Indie Gold", "Jazz Corner", "Workout"]),
    );
    await app.open();
    const scrollTop = () => page.locator(".Shell-main").evaluate((e) => e.scrollTop);
    const workout = page.locator(".PlaylistCard-open").filter({ hasText: "Workout" });
    // Enter follows the scroll at once, before the frame that brings its scroll event: the screen
    // notes where it is at the press too.
    await workout.scrollIntoViewIfNeeded();
    const at = await scrollTop();
    expect(at, "the grid is scrolled").toBeGreaterThan(200);
    for (const how of ["Enter", "click"]) {
      await workout.focus();
      await page.keyboard.press("Enter");
      await expect(heading(page)).toHaveText("Workout");
      if (how === "Enter") {
        await back(page).focus();
        await page.keyboard.press("Enter");
      } else await back(page).click();
      await expect(heading(page)).toHaveText("Playlists");
      await expect.poll(() => focusFacts(page), `Back by ${how}`).toEqual(onHeading("Playlists"));
      expect(await scrollTop(), `Back by ${how} keeps the scroll`).toBe(at);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await expect(heading(page), "Enter on the heading opens nothing").toHaveText("Playlists");
      expect(await scrollTop()).toBe(at);
    }
  });
});

test.describe("a tap on a card, on Back or on a tab @phone", { tag: "@phone" }, () => {
  test("leaves the focus on the heading: Space plays and pauses, Ctrl+E edits the playing song", async ({ app, page }) => {
    await app.open();
    await page.locator(".PlaylistCard-open").filter({ visible: true }).filter({ hasText: "Late Night" }).tap();
    await expect(heading(page)).toHaveText("Late Night");
    await expect.poll(() => focusFacts(page)).toEqual(onHeading("Late Night"));
    await page.keyboard.press("Control+e");
    await page.waitForTimeout(300);
    await expect(page.getByRole("dialog"), "Ctrl+E with nothing chosen and nothing playing opens nothing").toHaveCount(0);

    await playSong(app, page, "Lunar Comets");
    if (await back(page).count()) await back(page).tap();
    else await page.locator(".BottomTabs-tab, .Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Playlists" }).first().tap();
    await expect(heading(page)).toHaveText("Playlists");
    await expect.poll(() => focusFacts(page), "a tap on Back").toEqual(onHeading("Playlists"));
    await spaceToggles(page, "after a tap on Back");

    await page.locator(".PlaylistCard-open").filter({ visible: true }).filter({ hasText: "Late Night" }).tap();
    await expect.poll(() => focusFacts(page)).toEqual(onHeading("Late Night"));
    await spaceToggles(page, "after a tap on a card");
    await page.keyboard.press("Control+e");
    const editor = page.getByRole("dialog", { name: "Edit tags" });
    await expect(editor.getByRole("textbox", { name: "Title" }), "Ctrl+E with nothing chosen: the playing song").toHaveValue("Lunar Comets");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    await page.locator(".BottomTabs-tab, .Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Artists" }).first().tap();
    await expect(heading(page)).toHaveText("Artists");
    await expect.poll(() => focusFacts(page), "a tap on a tab").toEqual(onHeading("Artists"));
    await spaceToggles(page, "after a tap on a tab");
    await page.keyboard.press("1");
    await expect.poll(() => focusFacts(page), '"1"').toEqual(onHeading("Playlists"));
    await spaceToggles(page, 'after "1"');
    await page.keyboard.press("4");
    await expect(fullPlayer(page)).toBeVisible();
    await expect.poll(() => focusFacts(page), '"4"').toEqual(onHeading("Lunar Comets", "player"));
    await spaceToggles(page, 'after "4"');
  });
});

// Playing is a screen: opened with a pointer (a click or tap on the player bar's button, the mini
// player or the Playing tab or item), closing it (Esc, "1", its Close button) is a navigation like
// any other and leaves the focus on the heading of the screen under it, so Space plays and pauses
// and never opens Playing again through the button pressed. Opened with the keyboard (Enter on that
// button, "4"), the focus goes back to what opened it, or to the heading when that went with the
// screen. At 1280x800 and 760x520 (from the 1280x800 project), 834x1194 and 390x844.
test.describe("closing Playing @desktop @phone", { tag: ["@desktop", "@phone"] }, () => {
  /** The visible control named `name` in the frame (the player bar, the mini player, the tabs). */
  const frame = (page, selector, name) => page.locator(selector).filter({ visible: true }).filter({ hasText: name ?? "" });
  const opener = {
    // The player bar's button on a wide shell, the mini player on the phone.
    button: (page) => page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }).first(),
    // The Playing tab (phone), rail icon (tablet) or sidebar item (desktop).
    tab: (page) => frame(page, ".BottomTabs-tab, .Sidebar-nav .NavItem", "Playing").first(),
  };
  const closers = {
    Esc: (page) => page.keyboard.press("Escape"),
    '"1"': (page) => page.keyboard.press("1"),
    "its Close button": async (page, touch) => {
      const close = page.locator(".FullPlayer").getByRole("button", { name: "Close the player" }).filter({ visible: true });
      const target = (await close.count()) ? close.first() : page.getByRole("button", { name: "Close the player" }).filter({ visible: true }).first();
      if (touch) await target.tap();
      else await target.click();
    },
  };

  for (const size of [null, { width: 760, height: 520 }]) {
    test(`opened with a pointer, closing leaves the focus on the heading; with the keyboard, on its opener${size ? ` (${size.width}x${size.height})` : ""}`, async ({ app, page }, testInfo) => {
      const name = testInfo.project.name;
      test.skip(name === "desktop-1920x1080", "1280x800 stands for the desktop");
      test.skip(!!size && name !== "desktop-1280x800", "760x520 from the 1280x800 project");
      const touch = !!testInfo.project.use.hasTouch;
      if (size) await page.setViewportSize(size);
      await app.open();
      await openPlaylist(page, "Late Night");
      await playSong(app, page, "Lunar Comets");
      await page.mouse.move(2, 2);
      for (const [how, open] of [
        ["a pointer on the button", (page) => (touch ? opener.button(page).tap() : opener.button(page).click())],
        ["a pointer on the Playing tab", (page) => (touch ? opener.tab(page).tap() : opener.tab(page).click())],
      ]) {
        for (const [close, run] of Object.entries(closers)) {
          await open(page);
          await expect(fullPlayer(page)).toBeVisible();
          await run(page, touch);
          await expect(fullPlayer(page)).toHaveCount(0);
          await expect.poll(() => focusFacts(page), `opened by ${how}, closed by ${close}`).toEqual(onHeading("Late Night"));
          await spaceToggles(page, `after ${close} closed Playing opened by ${how}`);
          await page.waitForTimeout(150);
          await expect(fullPlayer(page), `Space after ${close} leaves Playing closed`).toHaveCount(0);
        }
      }
      // With the keyboard: "4" (its opener goes with the screen: the heading), and Enter on the
      // button (the button again, where the keyboard user was, when the keyboard closed it too; a
      // click on its Close is a pointer's close: the heading).
      for (const [close, run] of Object.entries(closers)) {
        await heading(page).focus();
        await page.keyboard.press("4");
        await expect(fullPlayer(page)).toBeVisible();
        await run(page, touch);
        await expect(fullPlayer(page)).toHaveCount(0);
        await expect.poll(() => focusFacts(page), `opened by "4", closed by ${close}`).toEqual(onHeading("Late Night"));
        await opener.button(page).focus();
        await page.keyboard.press("Enter");
        await expect(fullPlayer(page)).toBeVisible();
        await run(page, touch);
        await expect(fullPlayer(page)).toHaveCount(0);
        if (close === "its Close button")
          await expect.poll(() => focusFacts(page), `opened by Enter on its button, closed by ${close}: the heading`).toEqual(onHeading("Late Night"));
        else await expect(opener.button(page), `opened by Enter on its button, closed by ${close}: the button`).toBeFocused();
      }
    });
  }
});

// Back, "1" or closing Playing onto a grid or list scrolled down keeps the scroll and puts the focus
// on the heading, which is then out of sight. Tab from there goes to the first card or row in view,
// never back up to the header's first control (which would scroll the screen to the top). 760x520,
// from the 1280x800 project.
test.describe("Tab from a heading out of sight @desktop", { tag: "@desktop" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "760x520, from the 1280x800 project");
  });

  const scrollTop = (page) => page.locator(".Shell-main").evaluate((e) => e.scrollTop);
  /** The focused element shows whole inside the main area. */
  const focusInView = (page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      const main = document.querySelector(".Shell-main");
      if (!(el instanceof HTMLElement) || !main) return false;
      const r = el.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      return r.top >= m.top - 1 && r.bottom <= m.bottom + 1;
    });

  test("goes to the first card or row in view and keeps the scroll", async ({ app, page }) => {
    await page.setViewportSize({ width: 760, height: 520 });
    await page.addInitScript(() =>
      window.__soundhoodMock.addPlaylists(["Acoustic Mornings", "Autumn Drive", "Bedroom Pop", "Blue Hour", "Chill Beats", "City Lights", "Deep Work", "Dinner Party", "Early Bird", "Gym Sessions", "Indie Gold", "Jazz Corner", "Workout"]),
    );
    await app.open();
    const workout = page.locator(".PlaylistCard-open").filter({ hasText: "Workout" });
    await workout.scrollIntoViewIfNeeded();
    const at = await scrollTop(page);
    expect(at, "the grid is scrolled").toBeGreaterThan(200);
    for (const how of ["Back", '"1"']) {
      await workout.click();
      await expect(heading(page)).toHaveText("Workout");
      if (how === "Back") await back(page).click();
      else await page.keyboard.press("1");
      await expect(heading(page)).toHaveText("Playlists");
      await expect.poll(() => focusFacts(page), how).toEqual(onHeading("Playlists"));
      expect(await scrollTop(page), `${how} keeps the scroll`).toBe(at);
      await page.keyboard.press("Tab");
      expect((await focusFacts(page)).kind, `Tab after ${how}: a card`).toBe("card");
      expect(await focusInView(page), `Tab after ${how}: a card in view`).toBe(true);
      expect(await scrollTop(page), `Tab after ${how} keeps the scroll`).toBe(at);
    }

    // A long list scrolled down, Playing opened and closed over it.
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await page.keyboard.press("3");
    await page.locator(".Shell-main .ListRow").filter({ visible: true }).filter({ hasText: "All songs" }).click();
    await expect(heading(page)).toHaveText("All songs");
    await page.locator(".Shell-main").evaluate((e) => (e.scrollTop = 900));
    await page.waitForTimeout(200);
    const listAt = await scrollTop(page);
    expect(listAt, "the list is scrolled").toBeGreaterThan(600);
    await page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }).click();
    await expect(fullPlayer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fullPlayer(page)).toHaveCount(0);
    await expect.poll(() => focusFacts(page), "Playing closed").toEqual(onHeading("All songs"));
    expect(await scrollTop(page), "closing Playing keeps the scroll").toBe(listAt);
    await page.keyboard.press("Tab");
    expect((await focusFacts(page)).kind, "Tab after Playing closed: a row").toBe("row");
    expect(await focusInView(page), "Tab after Playing closed: a row in view").toBe(true);
    expect(await scrollTop(page), "Tab keeps the scroll").toBe(listAt);
    // From that row the keys go on from there.
    const was = await page.evaluate(() => Number(document.activeElement?.getAttribute("data-index")));
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => Number(document.activeElement?.getAttribute("data-index")))).toBe(was + 1);
  });
});

// The same rule for every sheet, list or menu, mode and pane that has an opener (useFocusReturn.ts):
// opened with a pointer, closing it leaves the focus on the heading of the screen under it, so Space
// plays and pauses and never presses the opener again (Select mode back on, the sheet or the queue
// open again). Select mode left with its X or with Esc, Settings and the queue opened and closed with
// the pointer; the player bar's button clicked after the keyboard had put the focus on it counts as
// a pointer's press too. At 1280x800, 1080x800 and 760x520 (from the 1280x800 project), 834x1194
// and 390x844.
test.describe("closing what a pointer opened @desktop @phone", { tag: ["@desktop", "@phone"] }, () => {
  const SIZES = [null, { width: 1080, height: 800 }, { width: 760, height: 520 }];
  const select = (page) => page.getByRole("button", { name: "Select", exact: true }).filter({ visible: true }).first();
  const bar = (page) => page.getByRole("toolbar", { name: "Selection" });
  /** What a pointer opens and closes: [its name, the steps, with `press` a click or a tap]. */
  const PARTS = [
    ["Select mode left with its X", async (page, press) => {
      await press(select(page));
      await expect(bar(page)).toBeVisible();
      await press(row(page, "Paper Bloom"));
      await press(bar(page).getByRole("button", { name: "Leave Select mode" }));
      await expect(bar(page)).toHaveCount(0);
    }],
    ["Select mode left with Esc", async (page, press) => {
      await press(select(page));
      await expect(bar(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(bar(page)).toHaveCount(0);
    }],
    ["Settings closed with its Close", async (page, press) => {
      await press(page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first());
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expect(settings).toBeVisible();
      await press(settings.getByRole("button", { name: "Close", exact: true }));
      await expect(settings).toHaveCount(0);
    }],
    ["the queue (pane or sheet) closed", async (page, press) => {
      const queue = page.getByRole("button", { name: "Queue", exact: true }).filter({ visible: true }).first();
      await press(queue);
      const sheet = page.getByRole("dialog", { name: "Queue" });
      await expect(page.locator(".RightPane, .QueueSheet").filter({ visible: true })).toHaveCount(1);
      if (await sheet.count()) await press(sheet.getByRole("button", { name: "Close", exact: true }));
      else await press(queue);
      await expect(page.locator(".RightPane, .QueueSheet")).toHaveCount(0);
    }],
  ];
  for (const size of SIZES) {
    for (const [what, steps] of PARTS) {
      const label = size ? ` (${size.width}x${size.height})` : "";
      test(`${what} with the pointer: the heading, and Space plays and pauses${label}`, async ({ app, page }, testInfo) => {
        const name = testInfo.project.name;
        test.skip(name === "desktop-1920x1080", "1280x800 stands for the desktop");
        test.skip(!!size && name !== "desktop-1280x800", "1080 and 760 wide from the 1280x800 project");
        const touch = !!testInfo.project.use.hasTouch;
        if (size) await page.setViewportSize(size);
        await app.open();
        await openPlaylist(page, "Late Night");
        await playSong(app, page, "Lunar Comets");
        await page.mouse.move(2, 2);
        await steps(page, (loc) => (touch ? loc.tap() : loc.click()));
        await expect.poll(() => focusFacts(page), what).toEqual(onHeading("Late Night"));
        await spaceToggles(page, `after ${what}`);
        await expect(bar(page), `Space after ${what} leaves Select mode off`).toHaveCount(0);
        await expect(page.getByRole("dialog"), `Space after ${what} opens no sheet`).toHaveCount(0);
        await expect(page.locator(".RightPane"), `Space after ${what} opens no queue`).toHaveCount(0);
      });
    }
  }

  for (const size of [null, { width: 760, height: 520 }]) {
    test(`the player bar's button clicked after the keyboard had the focus on it: Playing closes onto the heading${size ? ` (${size.width}x${size.height})` : ""}`, async ({ app, page }, testInfo) => {
      const name = testInfo.project.name;
      test.skip(name === "desktop-1920x1080", "1280x800 stands for the desktop");
      test.skip(!!size && name !== "desktop-1280x800", "760x520 from the 1280x800 project");
      const touch = !!testInfo.project.use.hasTouch;
      if (size) await page.setViewportSize(size);
      await app.open();
      await openPlaylist(page, "Late Night");
      await playSong(app, page, "Lunar Comets");
      const open = page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }).first();
      // The keyboard: Enter opens it, Esc closes it back onto the button.
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(fullPlayer(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(fullPlayer(page)).toHaveCount(0);
      await expect(open).toBeFocused();
      // Then a click or a tap on it: a pointer's press, whatever had the focus there before.
      if (touch) await open.tap();
      else await open.click();
      await expect(fullPlayer(page)).toBeVisible();
      await expect.poll(() => focusFacts(page), "opened by the pointer: the player's title").toEqual(onHeading("Lunar Comets", "player"));
      await page.keyboard.press("Escape");
      await expect(fullPlayer(page)).toHaveCount(0);
      await expect.poll(() => focusFacts(page), "closed: the heading").toEqual(onHeading("Late Night"));
      await spaceToggles(page, "after Playing opened by the pointer closed");
      await expect(fullPlayer(page), "Space leaves Playing closed").toHaveCount(0);
    });
  }
});

// Esc in an empty search field does what Esc does anywhere else at that moment: it closes the full
// player when that is open, and the focus goes to where the screen starts, never to the page.
test.describe("Esc in an empty search field @desktop @phone", { tag: ["@desktop", "@phone"] }, () => {
  test("the focus goes to the heading; with Playing open, one Esc closes it", async ({ app, page }, testInfo) => {
    const name = testInfo.project.name;
    test.skip(name === "desktop-1920x1080", "1280x800 stands for the desktop");
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await searchField(page).focus();
    await expect(searchField(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect.poll(() => focusFacts(page), "Esc in the empty field").toEqual(onHeading("Late Night"));
    await spaceToggles(page, "after Esc in the empty field");
    if (!name.startsWith("desktop")) return;
    // The sidebar's field beside Playing.
    await page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }).first().click();
    await expect(fullPlayer(page)).toBeVisible();
    await searchField(page).click();
    await page.keyboard.press("Escape");
    await expect(fullPlayer(page), "one Esc closes Playing").toHaveCount(0);
    await expect.poll(() => focusFacts(page), "never the page").not.toEqual({ at: "the page" });
  });
});

// The focus rule counts how a surface closed too (docs/DESIGN.md, Accessibility): the focus goes back
// to the opener only when the keyboard both opened and closed it; a pointer's open or close gives it
// to the screen's heading. A song row a pointer chose keeps the focus: Ctrl+click a row, then Esc or
// Ctrl+click it again, and the arrows go on from that row.
test.describe("the focus rule, by how a surface opened and closed @desktop", { tag: "@desktop" }, () => {
  const SIZES = [null, { width: 1080, height: 800 }, { width: 760, height: 520 }];
  const select = (page) => page.getByRole("button", { name: "Select", exact: true }).filter({ visible: true }).first();
  const bar = (page) => page.getByRole("toolbar", { name: "Selection" });
  const queueButton = (page) => page.getByRole("button", { name: "Queue", exact: true }).filter({ visible: true }).first();
  const playerButton = (page) => page.getByRole("button", { name: /^Open the player/ }).filter({ visible: true }).first();
  /** The title of the song row with the focus, or what has it otherwise. */
  const focusedRow = (page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      const r = el?.closest?.('.Shell-main [role="option"]');
      if (r && r === el) return r.querySelector(".TrackRow-title span:last-child")?.textContent ?? "a row";
      return el === document.body ? "the page" : `${el?.tagName} ${(el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim().slice(0, 30)}`;
    });

  for (const size of SIZES) {
    const label = size ? ` (${size.width}x${size.height})` : "";
    test(`Ctrl+click a song row, then Esc or Ctrl+click it again: the focus stays on the row and the arrows go on${label}`, async ({ app, page }, testInfo) => {
      test.skip(testInfo.project.name === "desktop-1920x1080", "1280x800 stands for the desktop");
      test.skip(!!size && testInfo.project.name !== "desktop-1280x800", "1080 and 760 wide from the 1280x800 project");
      if (size) await page.setViewportSize(size);
      await app.open();
      await openPlaylist(page, "Late Night");
      const titles = (await page.locator('.Shell-main [role="option"] .TrackRow-title span:last-child').allTextContents()).map((t) => t.trim());
      for (const [how, end] of [
        ["Esc", (page) => page.keyboard.press("Escape")],
        ["a second Ctrl+click", (page, r) => r.click({ modifiers: ["Control"] })],
      ]) {
        const name = titles[2];
        const r = row(page, name).first();
        await r.click({ modifiers: ["Control"] });
        await expect(bar(page)).toBeVisible();
        expect(await focusedRow(page), "Ctrl+click: the row").toBe(name);
        await end(page, r);
        await expect(bar(page), `${how} ends the choice`).toHaveCount(0);
        await expect.poll(() => focusedRow(page), `after ${how}: still the row`).toBe(name);
        await page.keyboard.press("ArrowDown");
        await expect.poll(() => focusedRow(page), `ArrowDown after ${how}: the next row`).toBe(titles[3]);
        await page.keyboard.press("ArrowUp");
        await expect.poll(() => focusedRow(page)).toBe(name);
      }
    });
  }

  /** Opened with the keyboard, closed with a pointer: [its name, the steps]. */
  const MIXED = [
    ["Select pressed with Enter, left with its X", async (page) => {
      await select(page).focus();
      await page.keyboard.press("Enter");
      await expect(bar(page)).toBeVisible();
      await bar(page).getByRole("button", { name: "Leave Select mode" }).click();
      await expect(bar(page)).toHaveCount(0);
    }],
    ["Select pressed with Enter, a row chosen with a click, left with its X", async (page) => {
      await select(page).focus();
      await page.keyboard.press("Enter");
      await expect(bar(page)).toBeVisible();
      await row(page, "Paper Bloom").first().click();
      await expect(bar(page)).toContainText("1 chosen");
      await bar(page).getByRole("button", { name: "Leave Select mode" }).click();
      await expect(bar(page)).toHaveCount(0);
    }],
    ["Settings opened with Ctrl+comma from a row, closed with its Close", async (page) => {
      await row(page, "Paper Bloom").first().focus();
      await page.keyboard.press("Control+Comma");
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expect(settings).toBeVisible();
      await settings.getByRole("button", { name: "Close", exact: true }).click();
      await expect(settings).toHaveCount(0);
    }],
    ["Playing opened with Enter on the player bar's button, closed with a click on it", async (page) => {
      await playerButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(fullPlayer(page)).toBeVisible();
      await page.locator(".Shell-bar").getByRole("button", { name: "Close the player" }).click();
      await expect(fullPlayer(page)).toHaveCount(0);
    }],
    ["the queue opened with Q from a row, closed with the pointer", async (page) => {
      await row(page, "Paper Bloom").first().focus();
      await page.keyboard.press("q");
      const sheet = page.getByRole("dialog", { name: "Queue" });
      await expect(page.locator(".RightPane, .QueueSheet").filter({ visible: true })).toHaveCount(1);
      if (await sheet.count()) await sheet.getByRole("button", { name: "Close", exact: true }).click();
      else await queueButton(page).click();
      await expect(page.locator(".RightPane, .QueueSheet")).toHaveCount(0);
    }],
  ];
  for (const size of SIZES) {
    for (const [what, steps] of MIXED) {
      const label = size ? ` (${size.width}x${size.height})` : "";
      test(`${what}: the heading, and Space plays and pauses${label}`, async ({ app, page }, testInfo) => {
        test.skip(testInfo.project.name === "desktop-1920x1080", "1280x800 stands for the desktop");
        test.skip(!!size && testInfo.project.name !== "desktop-1280x800", "1080 and 760 wide from the 1280x800 project");
        if (size) await page.setViewportSize(size);
        await app.open();
        await openPlaylist(page, "Late Night");
        await playSong(app, page, "Lunar Comets");
        await page.mouse.move(2, 2);
        await steps(page);
        await expect.poll(() => focusFacts(page), what).toEqual(onHeading("Late Night"));
        await spaceToggles(page, `after ${what}`);
        await expect(bar(page), `Space after ${what} leaves Select mode off`).toHaveCount(0);
        await expect(page.getByRole("dialog"), `Space after ${what} opens no sheet`).toHaveCount(0);
        await expect(page.locator(".RightPane"), `Space after ${what} opens no queue`).toHaveCount(0);
        await expect(fullPlayer(page), `Space after ${what} opens no Playing`).toHaveCount(0);
      });
    }
  }
});
