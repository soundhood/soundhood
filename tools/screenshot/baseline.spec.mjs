// Baselines of the current (pre-design-system) UI with the fixture library, default mode. Phase 1
// rebuilds these screens; until then a diff here means the old UI changed by accident.
import { expect, test } from "./harness.mjs";

const PLAYLIST = "Late Night Drive";

// Tags pick the projects: @desktop runs at the desktop viewports, @phone at the phone and tablet ones.
test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("library with a playlist open and a track playing", async ({ app, page }) => {
    await app.open();
    await expect(page.locator(".pill.artistPill")).toHaveCount(5);
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).click();
    await expect(page.locator(".headerTitle")).toContainText(PLAYLIST);

    await page.locator(".trackRow", { hasText: "Glass Tides" }).dblclick();
    await expect(page.locator(".trackRow.active")).toHaveText(/Glass Tides/);
    await app.settled("cover_art");
    await expect(page.locator(".player .npTitle")).toHaveText("Glass Tides - Neon Harbor");
    await expect(page.locator(".npArt img")).toBeVisible();
    await expect(page.locator(".player .timeline .time").last()).toHaveText("2:18"); // duration from the audio metadata
    await page.keyboard.press("Escape"); // drop the click selection, keep the playing state
    await expect(page.locator(".trackRow.selected")).toHaveCount(0);
    await page.mouse.move(0, 0);

    await expect(page).toHaveScreenshot(app.shot("library"));
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  /** Opens the playlist and taps a track, which plays it (tap = play on the phone). */
  async function playFromPlaylist(app, page) {
    await page.locator(".pill.artistPill", { hasText: PLAYLIST }).tap();
    await expect(page.locator(".headerTitle")).toContainText(PLAYLIST);
    await page.locator(".trackRow", { hasText: "Tin Roof Rain" }).tap();
    await expect(page.locator(".topbar .status")).toHaveText(/^Playing \(/);
    await app.settled("cover_art");
  }

  test("browse screen", async ({ app, page }) => {
    await app.open();
    await expect(page.locator(".pill.artistPill")).toHaveCount(5);
    await expect(page.locator(".tabBar .tabBtn.active")).toHaveText("Playlists");
    await expect(page.locator(".topbar .status")).toHaveText("Found 50 tracks");

    await expect(page).toHaveScreenshot(app.shot("browse"));
  });

  test("tracks screen with a track playing", async ({ app, page }) => {
    await app.open();
    await playFromPlaylist(app, page);
    await expect(page.locator(".trackRow.active")).toHaveText(/Tin Roof Rain/);
    await expect(page.locator(".miniBar .npTitle")).toHaveText("Tin Roof Rain - Nova Tamsin");
    await expect(page.locator(".miniArt img")).toBeVisible();

    await expect(page).toHaveScreenshot(app.shot("tracks"));
  });

  test("settings sheet", async ({ app, page }) => {
    await app.open();
    await page.locator(".topbar .brand .iconBtn").tap();
    await expect(page.locator(".mSettings")).toBeVisible();
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
    await expect(page.locator(".mSettings")).toContainText(`yt-dlp ${app.data.ytdlpVersion}`);
    await expect(page.locator(".mSettings input[type=password]")).toBeVisible(); // Proton login form

    await expect(page).toHaveScreenshot(app.shot("settings"));
  });

  test("full player", async ({ app, page }) => {
    await app.open();
    await playFromPlaylist(app, page);
    await page.locator(".miniBar").tap();
    await expect(page.locator(".mPlayer")).toBeVisible();
    await expect(page.locator(".mPlayerTitle")).toHaveText("Tin Roof Rain - Nova Tamsin");
    await expect(page.locator(".mPlayerArt img")).toBeVisible();
    await expect(page.locator(".mPlayer .timeline .time").last()).toHaveText("2:52"); // duration from the audio metadata

    await expect(page).toHaveScreenshot(app.shot("player"));
  });
});
