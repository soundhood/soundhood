// What the user causes, a toast says, every time (docs/DESIGN.md, Toasts): no toast is merged with
// another because the words are the same. Pressing A twice queues the song twice and shows two
// confirmations; A, B, C, then A again within two seconds shows that last A as the newest toast, at
// the bottom, where it is drawn. Only a notice that asks for it with a key stands for an earlier one
// of the same key (the unreadable settings at startup: ingest.spec.mjs), and then it moves to the
// newest place too.
import { expect, test } from "./harness.mjs";
import { openPlaylist, playSong, row } from "./ui.mjs";

/** The words of the toasts drawn, top to bottom. */
const drawn = (page) => page.locator(".Toast > span").allTextContents();

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

  test("A, B, C, then A again within 2 s: the last A is the newest toast, drawn at the bottom", async ({ page }) => {
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
  });
});
