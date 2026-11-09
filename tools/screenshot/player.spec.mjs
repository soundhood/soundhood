// Behaviour checks of the player on the mocked UI (no screenshots): the seek bar. Moved here from
// flows.spec.mjs and moved onto the rebuilt full player.
import { expect, test } from "./harness.mjs";
import { closeSettings, openPlayer, openPlaylist, openSettings, playSong, status } from "./ui.mjs";

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
});
