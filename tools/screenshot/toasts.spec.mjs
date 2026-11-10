// What the user causes, a toast says, every time (docs/DESIGN.md, Toasts): no toast is merged with
// another because the words are the same. Pressing A twice queues the song twice and shows two
// confirmations; A, B, C, then A again within two seconds shows that last A as the newest toast, at
// the bottom, where it is drawn. Only a notice that asks for it with a key stands for an earlier one
// of the same key (the unreadable settings at startup: ingest.spec.mjs), and then it moves to the
// newest place too.
//
// The stack holds two: at most two toasts exist, a third pushes the oldest out (gone with its timer,
// never shown later), and each toast's 4 s run from when it is shown. An action in a toast ignores
// presses for a moment after the stack moves, so a double click on an older toast's Undo never
// presses the newer one's that slid under the pointer.
import { expect, test } from "./harness.mjs";
import { openPlaylist, playSong, row } from "./ui.mjs";

/** The words of the toasts drawn, top to bottom. */
const drawn = (page) => page.locator(".Toast > span").allTextContents();

/** Every different list of toasts drawn, sampled every 150 ms for `ms`, in the order seen. */
async function watch(page, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await drawn(page);
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(now)) seen.push(now);
    await page.waitForTimeout(150);
  }
  return seen;
}

/** How often the page called `cmd`. */
const calls = (page, cmd) => page.evaluate((c) => window.__soundhoodIpc.calls.filter((x) => x === c).length, cmd);

test.describe("toasts the user caused", { tag: "@desktop" }, () => {
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the toasts are the same at every size");
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
  });

  test("A pressed twice on a song queues it twice and says so twice", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("a");
    await expect(page.locator(".Toast")).toHaveCount(1);
    await page.waitForTimeout(400);
    await page.keyboard.press("a");
    await expect.poll(() => drawn(page)).toEqual(["Added Paper Bloom to the queue", "Added Paper Bloom to the queue"]);
  });

  test("A, B, C, then A again within 2 s: the last A is the newest toast, drawn at the bottom; nothing older comes back", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowDown");
    const next = (await page.evaluate(() => document.activeElement?.querySelector(".TrackRow-title > span:not(.Equaliser)")?.textContent)) ?? "";
    expect(next, "B is another song").not.toBe("Paper Bloom");
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(150);
    await expect.poll(() => drawn(page)).toEqual([`Added ${next} to the queue`, `${next} plays next`]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("a");
    await expect.poll(() => drawn(page)).toEqual([`${next} plays next`, "Added Paper Bloom to the queue"]);
    // The first A and B were pushed out: they never come back, and the two left go in their 4 s.
    const seen = await watch(page, 5500);
    for (const list of seen) {
      expect(list.length, JSON.stringify(seen)).toBeLessThanOrEqual(2);
      expect(list, `B never comes back: ${JSON.stringify(seen)}`).not.toContain(`Added ${next} to the queue`);
      expect(list.filter((t) => t === "Added Paper Bloom to the queue").length, JSON.stringify(seen)).toBeLessThanOrEqual(1);
    }
    expect(seen.at(-1), "gone 4 s after they were shown").toEqual([]);
  });

  test("A pressed eight times: two toasts at most, the newest shown its full 4 s, all gone after it", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("a");
      await page.waitForTimeout(60);
    }
    const shownAt = Date.now();
    await expect.poll(() => drawn(page)).toEqual(["Added Paper Bloom to the queue", "Added Paper Bloom to the queue"]);
    const early = await watch(page, 3000);
    for (const list of early) expect(list.length, JSON.stringify(early)).toBeLessThanOrEqual(2);
    expect(early.at(-1)?.length, "the newest is still shown 3 s after it came").toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(Math.max(0, shownAt + 4800 - Date.now()));
    expect(await watch(page, 1500), "none is waiting to be shown later").toEqual([[]]);
  });
});

test.describe("the toast stack", { tag: "@desktop" }, () => {
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the toasts are the same at every size");
    await app.open();
    await openPlaylist(page, "Late Night");
  });

  test("three removals with Delete: the first one's toast is pushed out and never comes back with its Undo", async ({ app, page }) => {
    for (const title of ["Amber Comets", "Static Comets", "Silver Garden"]) {
      await row(page, title).focus();
      await page.keyboard.press("Delete");
      await expect(row(page, title)).toHaveCount(0);
      await app.settled();
    }
    await expect.poll(() => drawn(page)).toEqual(["Removed Static Comets from Late Night", "Removed Silver Garden from Late Night"]);
    const seen = await watch(page, 5500);
    for (const list of seen) {
      expect(list.join(" | "), JSON.stringify(seen)).not.toContain("Amber Comets");
      expect(list.join(" | "), "no Undo of an older change answers after a newer one").not.toContain("Undo:");
    }
    expect(seen.at(-1)).toEqual([]);
    expect(await calls(page, "undo_batch")).toBe(0);
  });

  for (const [how, press] of [
    ["a double click", (button) => button.dblclick()],
    [
      "two clicks 250 ms apart at one point",
      async (button, page) => {
        const b = await button.boundingBox();
        await button.click();
        await page.waitForTimeout(250);
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      },
    ],
  ]) {
    test(`two Undo toasts, ${how} on the older one's Undo undoes only the older change`, async ({ app, page }) => {
      for (const title of ["Paper Bloom", "Quiet Bloom"]) {
        await row(page, title).focus();
        await page.keyboard.press("Delete");
        await expect(row(page, title)).toHaveCount(0);
        await app.settled();
      }
      await expect.poll(() => drawn(page)).toEqual(["Removed Paper Bloom from Late Night", "Removed Quiet Bloom from Late Night"]);
      const older = page.locator(".Toast", { hasText: "Removed Paper Bloom" }).getByRole("button", { name: "Undo" });
      await press(older, page);
      await page.waitForTimeout(600);
      await app.settled();
      expect(await calls(page, "undo_batch"), "one undo: the older toast's").toBe(1);
      // The playlist changed after the older remove, so the core leaves it (its toast says so); the
      // newer remove was never undone and its toast still offers its Undo.
      await expect(row(page, "Quiet Bloom")).toHaveCount(0);
      await expect(page.locator(".Toast", { hasText: "Removed Quiet Bloom" }).getByRole("button", { name: "Undo" })).toBeVisible();
      expect(await page.evaluate(() => window.__soundhoodMock.history.length), "both changes are still in the journal").toBe(2);
    });
  }
});
