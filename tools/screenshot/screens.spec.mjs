// The rebuilt screens, photographed at every size under one name per screen so the parity grid can
// pair the phone with the desktop (npm run evidence:parity): playlists, artists, folders, tracks (a
// playlist open, a song playing), playing and search. Each test runs at 390x844 and 834x1194
// (platform android, touch) and at 1280x800 and 1920x1080 (platform windows, mouse). The layout comes
// from the shell's width alone; the platform only says what the host can do.
import { expect, test } from "./harness.mjs";
import { goTo, openPlayer, openPlaylist, playSong, row, searchField, settle } from "./ui.mjs";

const PLAYLIST = "Late Night";
// Near the top of the playlist, so the header and the playing row are both on screen at every size.
const SONG = "Lunar Comets";

test.describe("screens", { tag: ["@desktop", "@phone"] }, () => {
  test("playlists", async ({ app, page }) => {
    await app.open();
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Playlists");
    await expect(page.locator(".PlaylistCard", { hasText: PLAYLIST })).toContainText("16 songs");
    await settle(app, page);
    // Four different covers make a mosaic of four; a playlist with none shows the playlist icon.
    await expect(page.locator(".PlaylistCard", { hasText: PLAYLIST }).locator(".Mosaic img")).toHaveCount(4);
    await expect(page.locator(".PlaylistCard", { hasText: "Empty" }).locator(".Mosaic.is-empty")).toHaveCount(1);
    await expect(page).toHaveScreenshot(app.shot("playlists"));
  });

  test("artists", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Artists");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Artists");
    await expect(page.locator(".ListRow").first()).toContainText("Anouk Lirr");
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("artists"));
  });

  test("folders", async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Folders");
    await expect(page.locator(".ListRow").first()).toContainText("All songs");
    await expect(page.locator(".ListRow").first()).toContainText("50 songs");
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("folders"));
  });

  test("tracks", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await expect(page.locator(".ScreenHeader-meta")).toContainText("16 songs");
    await playSong(app, page, SONG);
    await expect(row(page, SONG)).toHaveAttribute("aria-current", "true");
    // The player on screen names the song: the mini player on a phone, the player bar elsewhere.
    const now = page.locator(".MiniPlayer-title, .PlayerBar-title").filter({ visible: true });
    await expect(now).toHaveText(SONG);
    await expect(page.locator(".MiniPlayer-artist, .PlayerBar-artist").filter({ visible: true })).toHaveText("Mira Velloux");
    await expect(page.locator(".MiniPlayer .Thumb, .PlayerBar .Thumb").filter({ visible: true })).toHaveJSProperty("tagName", "IMG");
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("tracks"));
  });

  test("playing", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, PLAYLIST);
    await playSong(app, page, SONG);
    await openPlayer(page);
    const player = page.locator(".FullPlayer");
    await expect(player.locator(".FullPlayer-title, .FullPlayer-desk h1").filter({ visible: true })).toHaveText(SONG);
    await expect(player.locator("img.FullPlayer-art")).toBeVisible();
    // The length from the audio metadata: the core fixture's 3-second tone (the full player's own
    // bar shows it on a phone; wider shells leave the bar to the player bar).
    await expect(player.locator(".SliderRow-end")).toHaveText("0:03");
    await expect(page.locator(".PlayerBar .SliderRow-end")).toHaveText("0:03");
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("playing"));
  });

  test("search", async ({ app, page }) => {
    await app.open();
    await searchField(page).fill("glass");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Search");
    await expect(page.locator(".ScreenHeader-meta")).toContainText("results for glass");
    await expect(page.getByRole("toolbar", { name: "Show" }).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("section[aria-label=Artists]")).toContainText("Glasshouse Tide");
    await expect(page.locator("section[aria-label=Songs] .TrackRow")).toHaveCount(5);
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("search"));
  });
});
