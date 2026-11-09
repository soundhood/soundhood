// Behaviour checks of the player on the mocked UI (no screenshots): the seek bar. Moved here from
// flows.spec.mjs.
import { expect, test } from "./harness.mjs";

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  const status = (page) => page.locator(".topbar .status");

  test("the seek bar has the song's length, moves with the song and seeks where tapped", async ({ app, page }) => {
    await app.open();
    await page.locator(".pill.artistPill", { hasText: "Late Night" }).tap();
    await page.locator(".trackRow", { hasText: "Static Garden" }).tap();
    await expect(status(page)).toHaveText(/^Playing \(/);
    await page.locator(".miniBar").tap();
    const times = page.locator(".mPlayer .timeline .time");
    const bar = page.locator(".mPlayer .timeline input[type=range]");
    // Every track of the core's fixture library is the same 3-second tone; the bar moves in 0.25 s steps.
    await expect(times.last()).toHaveText("0:03");
    await expect(bar).toHaveAttribute("max", "3");

    // The mock's play() makes no sound and does not advance, so the song "plays" 2.5 s by hand.
    await page.evaluate(() => { document.querySelector("audio").currentTime = 2.5; });
    await expect(times.first()).toHaveText("0:02");
    await expect(bar).toHaveValue("2.5");

    // A tap in the middle seeks back to about 1.5 s (35 % to 64 % of the bar, as before).
    const box = await bar.boundingBox();
    await bar.tap({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(() => page.evaluate(() => document.querySelector("audio").currentTime)).toBeLessThan(1.95);
    expect(await page.evaluate(() => document.querySelector("audio").currentTime)).toBeGreaterThan(1.05);
    await expect(times.first()).toHaveText("0:01");
  });
});
