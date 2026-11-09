// Behaviour checks of the settings and tools on the mocked UI: the log and Copy log, a partial undo,
// the test library switch and what it turns off, the self-test wording (moved here from
// flows.spec.mjs), and the settings sheet photographed (from baseline.spec.mjs). The settings and
// tools are the old ones, inside the settings sheet the rebuilt shell opens, until Settings is rebuilt.
import { expect, test } from "./harness.mjs";
import { goTo, openPlaylist, openSettings, row, settle, status } from "./ui.mjs";

const SYNC_OFF = "Sync is off while the test library is shown";
/** The settings store as the mock holds it. */
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const ipcCount = (page, field) => page.evaluate((f) => window.__soundhoodMock[f].length, field);

/** Adds Quiet Bloom from Late Night to Focus with the mouse (Ctrl+click selects it). */
async function addQuietBloomToFocus(page) {
  await openPlaylist(page, "Late Night");
  await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Add to playlist" }).click();
  await page.getByRole("dialog", { name: "Add to playlist" }).locator(".ListRow", { hasText: "Focus" }).click();
  await expect(page.locator(".Toast")).toContainText("Added Quiet Bloom to Focus");
}

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {

  test("Copy log carries the change lines below the visible log; a refused copy says how to copy by hand", async ({ app, page }) => {
    await app.open();
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await addQuietBloomToFocus(page);
    await openSettings(app, page);
    await expect(status(page)).toHaveText("Status: Added to Focus");
    await app.settled();
    await expect(page.locator(".downloadLogs")).toHaveCount(0);

    // Download output still shows, as before; Copy log appears with it.
    await emit(page, "ytdlp:stdout", "[download] Destination: Downloads/A - B.m4a");
    await expect(page.locator(".downloadLogs")).toContainText("[download] Destination");
    await expect(page.locator(".downloadLogs")).not.toContainText("[change]");
    await page.getByRole("button", { name: "Copy log" }).click();
    await expect(status(page)).toHaveText("Status: Log copied");
    const copied = await page.evaluate(() => window.__copied[0]);
    expect(copied.startsWith("appVersion: 0.1.0\n")).toBe(true);
    const at = (s) => copied.indexOf(s);
    expect(at("[download] Destination")).toBeGreaterThan(at("sidecars:"));
    expect(at("[change] Added 1 track to Focus")).toBeGreaterThan(at("[download] Destination"));

    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
      document.execCommand = () => false;
    });
    await page.getByRole("button", { name: "Copy log" }).click();
    await expect(status(page)).toHaveText("Status: Copy failed: select the log text and press Ctrl+C");

    // Clear logs clears both: the next copy has no change lines.
    await page.getByRole("button", { name: "Clear logs" }).click();
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await emit(page, "ytdlp:stdout", "[download] 100%");
    await page.getByRole("button", { name: "Copy log" }).click();
    await expect(status(page)).toHaveText("Status: Log copied");
    expect(await page.evaluate(() => window.__copied.at(-1))).not.toContain("[change]");
  });

  test("a partial undo says how much was left and shows why in the log", async ({ app, page }) => {
    await app.open();
    await addQuietBloomToFocus(page);
    await openSettings(app, page);
    await expect(status(page)).toHaveText("Status: Added to Focus");
    await page.evaluate(() => {
      window.__soundhoodMock.undoSkipped = [{ path: "_Playlists/Focus.m3u8", reason: "changed since, not undone" }];
    });
    await page.locator(".topbar .btn", { hasText: /^Undo$/ }).click();
    await expect(status(page)).toHaveText("Status: Undo: 0 restored, 1 left as they are (see the log)");
    await expect(page.locator(".downloadLogs")).toHaveText("[skipped] _Playlists/Focus.m3u8 - changed since, not undone");
  });

  test("the test library: named, not printed; on follows the shown folder; off goes back", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    const fixtureRoot = await page.evaluate(() => window.__soundhoodMock.fixtureRoot);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    const sw = page.getByRole("switch");
    await expect(sw).toHaveText("Test library: off");
    await expect(page.locator(".pathLine")).toHaveText(`Folder: ${app.data.root}`);
    await expect(page.locator(".testLibraryNote")).toHaveCount(0);

    await sw.click();
    await expect(sw).toHaveText("Test library: on");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".pathLine")).toHaveText("Folder: test library");
    await expect(page.locator(".testLibraryNote")).toHaveText("Test library");
    await expect(page.locator("body")).not.toContainText("AppData");
    await expect(page.locator(".downloadLogs")).toHaveCount(0);
    let s = await storeOf(page);
    expect(s).toMatchObject({ library_dir: fixtureRoot, fixture_root: fixtureRoot, real_library_dir: app.data.root });

    // The note stays when the developer section is hidden.
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(page.locator(".devBar")).toHaveCount(0);
    await expect(page.locator(".testLibraryNote")).toBeVisible();
    await page.keyboard.press("Control+Alt+Shift+KeyD");

    await sw.click();
    await expect(sw).toHaveText("Test library: off");
    await expect(page.locator(".pathLine")).toHaveText(`Folder: ${app.data.root}`);
    await expect(page.locator(".testLibraryNote")).toHaveCount(0);
    s = await storeOf(page);
    expect(s).toMatchObject({ library_dir: app.data.root, real_library_dir: "" });
  });

  test("restarting on the test library: the switch reads on, off returns to the real library", async ({ app, page }) => {
    await beforeLoad(page, () => {
      const m = window.__soundhoodMock;
      m.store.set("library_dir", m.fixtureRoot);
      m.store.set("fixture_root", m.fixtureRoot);
      m.store.set("real_library_dir", "C:/Music");
      m.store.set("dev_mode", true);
    });
    await app.open();
    await openSettings(app, page);
    await expect(page.locator(".pathLine")).toHaveText("Folder: test library");
    await expect(page.locator(".testLibraryNote")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveText("Test library: on");
    await page.getByRole("switch").click();
    await expect(page.locator(".pathLine")).toHaveText("Folder: C:/Music");
    await expect(page.getByRole("switch")).toHaveText("Test library: off");
  });

  test("no real library known: on then off closes the library instead of keeping the test one", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await page.goto("/");
    await app.settled("platform");
    await openSettings(app, page);
    await expect(page.locator(".pathLine")).toHaveText("Pick a folder to begin.");
    const sw = page.getByRole("switch");
    await sw.click();
    await expect(page.locator(".pathLine")).toHaveText("Folder: test library");
    expect((await storeOf(page)).real_library_dir).toBeUndefined();

    await sw.click();
    await expect(sw).toHaveText("Test library: off");
    await expect(page.locator(".pathLine")).toHaveText("Pick a folder to begin.");
    await expect(status(page)).toHaveText("Status: Test library off: choose your library folder again");
    await expect(page.locator(".testLibraryNote")).toHaveCount(0);
    await expect(page.locator(".TrackRow, .PlaylistCard")).toHaveCount(0);
    expect((await storeOf(page)).library_dir).toBe("");
  });

  test("the self-test result reads in sentence case", async ({ app, page }) => {
    await beforeLoad(page, () => window.__soundhoodMock.store.set("dev_mode", true));
    await app.open();
    await openSettings(app, page);
    await page.getByRole("button", { name: "Run self-test" }).click();
    await expect(status(page)).toHaveText("Status: Self-test: 2 passed, 0 failed");
  });
});

/** The phone's settings panel, inside the settings sheet. */
async function openPhoneSettings(app, page) {
  await openSettings(app, page);
  await expect(page.locator(".mSettings")).toBeVisible();
  await app.settled("plugin:soundhood-ytdl|ytdlp_version");
}

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("settings sheet", async ({ app, page }) => {
    await app.open();
    // Over a screen without artwork: a blurred cover grid mixes aqua and purple into blue pixels.
    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    await expect(page.locator(".mSettings")).toContainText(`yt-dlp ${app.data.ytdlpVersion}`);
    await expect(page.locator(".mSettings input[type=password]")).toBeVisible(); // Proton login form
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("settings"));
  });


  test("the test library turns Proton sync off and names the library", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.proton = { bundled: true, connected: true, username: "tester@example.com" };
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await app.open();
    await openPhoneSettings(app, page);
    const buttons = ["Sync now", "Get new", "Send new"].map((name) => page.getByRole("button", { name, exact: true }));
    for (const b of buttons) await expect(b).toBeEnabled();
    await expect(page.locator(".mSettings")).not.toContainText(SYNC_OFF);

    await page.getByRole("switch").tap();
    await expect(page.locator(".mFolder")).toHaveText("Library: test library");
    for (const b of buttons) await expect(b).toBeDisabled();
    await expect(page.locator(".mSettings")).toContainText(SYNC_OFF);
    await expect(page.locator(".testLibraryNote")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("fixture-library");
    expect(await ipcCount(page, "protonSyncs")).toBe(0);

    await page.getByRole("switch").tap();
    await expect(page.locator(".mFolder")).toHaveText(`Library: ${app.data.root}`);
    for (const b of buttons) await expect(b).toBeEnabled();
    await expect(page.locator(".mSettings")).not.toContainText(SYNC_OFF);
  });

});
