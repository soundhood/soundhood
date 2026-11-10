// Behaviour checks of the player on the mocked UI (no screenshots): the seek bar (moved here from
// flows.spec.mjs onto the rebuilt full player), the full player sliding away, the full player's more
// menu, only the newest of two quickly chosen songs playing, position ticks that re-render no song
// row, the artwork tint's fade.
import { expect, test } from "./harness.mjs";
import { closeSettings, openPlayer, openPlaylist, openSettings, playSong, row, status } from "./ui.mjs";

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  // The phone plays from the file's bytes, a route that once never reported the song's length: the
  // seek bar sat at 0:00 / 0:00 and could not be dragged.
  test("the seek bar has the song's length, moves with the song and seeks where tapped", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Static Garden");
    await openSettings(app, page);
    await expect(status(page)).toHaveText(/^Playing \(/);
    await closeSettings(page);
    await openPlayer(page);
    // The position bar on screen: the full player's on a phone, the player bar's on a tablet.
    const bar = page.getByRole("slider", { name: "Position" }).filter({ visible: true });
    const times = bar.locator("xpath=..");
    // Every track of the core's fixture library is the same 3-second tone.
    await expect(times.locator(".SliderRow-end")).toHaveText("0:03");
    await expect(bar).toHaveAttribute("max", "3");

    // The mock's play() makes no sound and does not advance, so the song "plays" 2.5 s by hand.
    await page.evaluate(() => { document.querySelector("audio").currentTime = 2.5; });
    await expect(times.locator(".SliderRow-start")).toHaveText("0:02");
    await expect(bar).toHaveValue("2.5");

    // A tap in the middle seeks back to about 1.5 s (35 % to 64 % of the bar, as before).
    const box = await bar.boundingBox();
    await bar.tap({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(() => page.evaluate(() => document.querySelector("audio").currentTime)).toBeLessThan(1.95);
    expect(await page.evaluate(() => document.querySelector("audio").currentTime)).toBeGreaterThan(1.05);
    await expect(times.locator(".SliderRow-start")).toHaveText("0:01");
  });

  test("the full player slides back down when closed", async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.use.viewport.width >= 720, "on wider shells the player is a pane and closes at once");
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Static Garden");
    await openPlayer(page);
    await page.locator(".FullPlayer").getByRole("button", { name: "Close the player" }).click();
    await expect(page.locator(".FullPlayer")).toHaveClass(/is-leaving/);
    await expect(page.locator(".FullPlayer")).toHaveCount(0);
    await expect(page.locator(".MiniPlayer")).toBeVisible();
  });
});

/**
 * Counts how often each song row re-renders: a stand-in for React DevTools' hook, installed before
 * React loads. After every commit it walks the tree and compares each TrackItem's props object
 * with the one it had at the previous commit; a row that rendered again has a new props object.
 */
function countRowRenders() {
  const seen = new Map();
  const counter = { rows: 0, commits: 0 };
  window.__rowRenders = counter;
  const walk = (fiber) => {
    for (let f = fiber; f; f = f.sibling) {
      if (typeof f.type === "function" && f.type.name === "TrackItem") {
        const key = f.memoizedProps?.t?.path;
        if (seen.has(key) && seen.get(key) !== f.memoizedProps) counter.rows++;
        seen.set(key, f.memoizedProps);
      }
      if (f.child) walk(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      counter.commits++;
      walk(root.current);
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
}

/**
 * play() as Chromium runs it on a real file: it waits a moment for data, and a load() before then
 * rejects it with an AbortError ("interrupted by a new load request").
 */
function interruptiblePlay() {
  const pending = new WeakMap();
  const load = HTMLMediaElement.prototype.load;
  HTMLMediaElement.prototype.load = function () {
    const p = pending.get(this);
    if (p) {
      pending.delete(this);
      p.reject(new DOMException("The play() request was interrupted by a new load request.", "AbortError"));
    }
    return load.call(this);
  };
  HTMLMediaElement.prototype.play = function () {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      pending.set(this, entry);
      setTimeout(() => {
        if (pending.get(this) !== entry) return;
        pending.delete(this);
        resolve();
      }, 300);
    });
  };
}

/** The file the audio element holds, decoded ("" when none; "blob:" for the bytes route). */
const audioSource = (page) => page.evaluate(() => decodeURIComponent(document.querySelector("audio").src));

test.describe("every layout", { tag: ["@desktop", "@phone"] }, () => {
  test("the full player's more menu holds the song menu's actions for the playing song", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
    await openPlayer(page);
    const player = page.locator(".FullPlayer");
    const more = player.getByRole("button", { name: "More for Lunar Comets" });
    const menu = page.getByRole("menu", { name: "More for Lunar Comets" });
    await expect(more).toHaveAttribute("aria-haspopup", "menu");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(menu).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    // No Play next or Add to queue for the song already playing, no Remove from a playlist.
    await expect(menu.getByRole("menuitem")).toHaveText(["Add to playlist", "Go to artist", "Edit tags", "Delete song"]);
    // Esc closes the menu, not the player, and the button has the focus again.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(player).toBeVisible();
    await expect(more).toBeFocused();
    // The keys of the rows' menu: Down opens it, a typed letter moves to its item, Enter runs it.
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeFocused();
    await page.keyboard.press("e");
    await page.keyboard.press("Enter");
    const tags = page.getByRole("dialog", { name: "Edit tags" });
    await expect(tags).toBeVisible();
    await expect(tags.getByRole("textbox", { name: "Title" })).toHaveValue("Lunar Comets");
    await tags.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await more.click();
    await menu.getByRole("menuitem", { name: "Add to playlist" }).click();
    await expect(page.getByRole("dialog", { name: "Add to playlist" })).toBeVisible();
    await page.getByRole("dialog", { name: "Add to playlist" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await more.click();
    await menu.getByRole("menuitem", { name: "Delete song" }).click();
    await expect(page.getByRole("dialog", { name: "Delete this track?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Go to artist leaves the player for the artist's songs.
    await more.click();
    await menu.getByRole("menuitem", { name: "Go to artist" }).click();
    await expect(player).toHaveCount(0);
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Mira Velloux");
  });
});

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  // A song chosen before the previous one started used to leave the previous one playing: its
  // interrupted play() was taken for a refused file and retried through the bytes route.
  test("choosing another song before the first one starts plays only the newest", async ({ app, page }) => {
    await page.addInitScript(interruptiblePlay);
    await app.open();
    await openPlaylist(page, "Late Night");
    await row(page, "Quiet Garden").click();
    await row(page, "Paper Bloom").click();
    await expect(row(page, "Paper Bloom")).toHaveClass(/is-playing/);
    await expect(page.locator(".PlayerBar-title")).toHaveText("Paper Bloom");
    await app.settled("cover_art");
    // Long enough for a retry of the first song through the bytes route to have landed.
    await page.waitForTimeout(900);
    expect(await audioSource(page)).toMatch(/^http:\/\/asset\.localhost\/.*Paper Bloom/);
    await expect(page.locator(".PlayerBar-title")).toHaveText("Paper Bloom");
    await expect(page.locator(".PlayerBar .PlayButton")).toHaveAttribute("aria-label", "Pause");
  });

  // The tint is the music's colour on the player surfaces only, and a new cover's tint fades in.
  test("the artwork tint fades over 500 ms", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Silver Garden");
    await expect.poll(() => page.locator(".Shell").getAttribute("style")).toMatch(/--tint: oklch/);
    const transition = await page.locator(".Shell").evaluate((el) => getComputedStyle(el).transition);
    expect(transition).toMatch(/--tint 0\.5s/);
  });

  // The playing position used to live in the app-wide state: every tick (about 4 a second)
  // re-rendered the whole app, the song list with it. Now only the player's own parts follow it.
  test("a position tick re-renders no song row; the times still move", async ({ app, page }) => {
    await page.addInitScript(countRowRenders);
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Static Garden");
    await expect(page.locator(".PlayerBar .SliderRow-end")).toHaveText("0:03");
    const before = await page.evaluate(() => ({ ...window.__rowRenders }));
    expect(before.commits, "the render counter saw React commit").toBeGreaterThan(0);
    // The mocked file cannot be seeked (no range requests), so the element reports a made-up time.
    await page.evaluate(() => {
      const audio = document.querySelector("audio");
      window.__fakeTime = 0;
      Object.defineProperty(audio, "currentTime", { configurable: true, get: () => window.__fakeTime, set: (v) => (window.__fakeTime = v) });
    });
    for (const t of [0.4, 0.8, 1.2, 1.6, 2.1, 2.6]) {
      await page.evaluate((s) => {
        window.__fakeTime = s;
        document.querySelector("audio").dispatchEvent(new Event("timeupdate"));
      }, t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    }
    await expect(page.locator(".PlayerBar .SliderRow-start")).toHaveText("0:02");
    const after = await page.evaluate(() => ({ ...window.__rowRenders }));
    expect(after.rows - before.rows, "song rows rendered again by position ticks").toBe(0);
  });
});
