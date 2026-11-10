// Steps through the rebuilt UI for the specs: one helper per thing a user does, the same at every
// shell size (the bottom tabs on a phone, the rail on a tablet, the sidebar on a desktop are found by
// what is on screen, never by the platform).
import { expect } from "./harness.mjs";

/** Only the elements on screen (the other layout's copy is display: none). */
const shown = (locator) => locator.filter({ visible: true });

/** Playlists, Artists, Folders or Playing: the bottom tab, the rail icon or the sidebar item. */
export async function goTo(page, label) {
  await shown(page.locator(".BottomTabs-tab, .Sidebar-nav .NavItem").filter({ hasText: label })).first().click();
}

/** The playlist's card on the Playlists screen opens it. */
export async function openPlaylist(page, name) {
  await shown(page.locator(".PlaylistCard-open", { hasText: name })).click();
  await expect(page.locator(".ScreenHeader h1")).toHaveText(name);
}

/** A song row in the list on screen. */
export const row = (page, title) => shown(page.locator(".TrackRow", { hasText: title }));

/** Taps or clicks a song, which plays it; waits for its cover. */
export async function playSong(app, page, title) {
  await row(page, title).click();
  await expect(row(page, title)).toHaveClass(/is-playing/);
  await app.settled("cover_art");
}

/** The search field on screen (under the title on a phone, in the sidebar on a desktop). */
export const searchField = (page) => shown(page.getByRole("textbox", { name: "Search" }));

/** Opens the Playing screen: the mini player on a phone, the player bar's button elsewhere. */
export async function openPlayer(page) {
  await shown(page.getByRole("button", { name: /^Open the player/ })).click();
  await expect(page.locator(".FullPlayer")).toBeVisible();
}

/** The settings sheet. */
export async function openSettings(app, page) {
  await shown(page.getByRole("button", { name: "Settings", exact: true })).first().click();
  await expect(page.locator(".SettingsSheet")).toBeVisible();
  await app.settled();
}

/** Closes the settings sheet. */
export async function closeSettings(page) {
  await page.locator(".SettingsSheet").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".SettingsSheet")).toHaveCount(0);
}

/**
 * The newest line of the log, which Settings shows under View log (Tools). The screens have no
 * status line: the messages it carried that are not toasts or reports go to the log.
 */
export const status = (page) => page.locator(".SettingsSheet .LogRow .SettingRow-help");

/** A settings row by its label (inside the open settings sheet). */
export const settingRow = (page, label) =>
  page.locator(".SettingsSheet .SettingRow").filter({ has: page.locator(".SettingRow-label", { hasText: new RegExp(`^${label}$`) }) });

/** The toasts on screen. */
export const toasts = (page) => page.locator(".Toast");

/** The report that ends a tier-1 write (a BatchReport). */
export const report = (page) => page.locator(".Sheet").filter({ has: page.locator(".BatchReport") });

/**
 * Ready for a photograph: fonts loaded, every image loaded and decoded (lazy ones too), the artwork
 * tint computed when a cover plays, no pointer over anything, no focus ring from the last click.
 */
export async function settle(app, page) {
  await app.settled();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  });
  await page.waitForFunction(() => {
    const shell = document.querySelector(".Shell");
    const art = document.querySelector(".PlayerBar .Thumb, .MiniPlayer .Thumb");
    // A cover plays: its tint (an oklch colour) replaces the fallback before the shot.
    return !(art instanceof HTMLImageElement) || /oklch/.test(shell?.getAttribute("style") ?? "");
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
