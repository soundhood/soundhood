// Where the focus goes after a navigation (docs/DESIGN.md, Accessibility; docs/SHORTCUTS.md): Enter
// on a card or a row, Back, the tab digits, "4" for Playing, and a click or tap on a card, on Back or
// on a navigation item. The focus lands on the new screen's heading (the full player's on Playing):
// never on a button, a card or a row, so Space stays play and pause, Ctrl+E with nothing chosen
// edits the playing song, Tab leads into the screen, no row's More button shows for a focus the user
// never put there, and Back to a scrolled grid keeps its scroll. At 1280x800 and 760x520 (from the
// 1280x800 project), 834x1194 and 390x844.
import { expect, test } from "./harness.mjs";
import { goTo, openPlaylist, playSong, row } from "./ui.mjs";

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
