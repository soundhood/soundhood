// The settings sheet on the mocked UI: photographed at every size over Folders (the parity grid
// pairs <size>-settings.png; over Playlists the blurred cover grid mixes aqua and purple into blue
// pixels that fail the blue scan) and in the three other modes at 390x844 and 1280x800 (@modes),
// Ctrl+comma, the text size, the log (View log, Copy log on every device, the change lines only in
// what Copy log carries), a partial undo, Make playlists from folders (how many it made; with
// nothing to make, no Undo), the test library switch and what it turns off, the self-test wording.
import { expect, test } from "./harness.mjs";
import { goTo, openPlaylist, openSettings, playSong, report, row, settingRow, settle, status } from "./ui.mjs";

const SYNC_OFF = "Sync is off while the test library is shown";
/** The settings store as the mock holds it. */
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const ipcCount = (page, field) => page.evaluate((f) => window.__soundhoodMock[f].length, field);
/** The newest toast with this text. */
const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const sheet = (page) => page.locator(".SettingsSheet");
const testSwitch = (page) => sheet(page).getByRole("switch", { name: "Test library" });
/** The Music folder row's help line: the folder, by name for the test library. */
const folderLine = (page) => settingRow(page, "Music folder").locator(".SettingRow-help");
const developer = (page) => sheet(page).locator("section", { has: page.locator("h3", { hasText: "Developer" }) });

/** Adds Quiet Bloom from Late Night to Focus with the mouse (Ctrl+click selects it). */
async function addQuietBloomToFocus(page) {
  await openPlaylist(page, "Late Night");
  await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Add to playlist" }).click();
  await page.getByRole("dialog", { name: "Add to playlist" }).locator(".ListRow", { hasText: "Focus" }).click();
  await expect(page.locator(".Toast")).toContainText("Added Quiet Bloom to Focus");
}

/** Opens View log, a sub-sheet of Settings. */
async function openLog(page) {
  await sheet(page).getByRole("button", { name: /^View log/ }).click();
  await expect(page.getByRole("dialog", { name: "Log" })).toBeVisible();
  return page.getByRole("dialog", { name: "Log" });
}

test.describe("both layouts", { tag: ["@desktop", "@phone"] }, () => {
  test("settings", { tag: "@modes" }, async ({ app, page }, testInfo) => {
    const phone = testInfo.project.use.soundhoodPlatform === "android";
    await app.open();
    await goTo(page, "Folders");
    await expect(page.locator(".ScreenHeader h1")).toHaveText("Folders");
    await openSettings(app, page);
    if (phone) await app.settled("plugin:soundhood-ytdl|ytdlp_version");
    // The groups in DESIGN.md's order, only those with a working row; Proton Drive only where the
    // host syncs (the phone); the developer section hidden.
    const groups = sheet(page).locator(".SettingGroup > h3");
    await expect(groups).toHaveText(
      phone ? ["Library", "YouTube", "Proton Drive", "Appearance", "Tools", "About"] : ["Library", "YouTube", "Appearance", "Tools", "About"],
    );
    await expect(folderLine(page)).toHaveText(app.data.root);
    await expect(settingRow(page, "Undo last change").locator(".SettingRow-help")).toHaveText("Nothing to undo");
    await expect(sheet(page).getByRole("button", { name: "Copy log" })).toBeVisible();
    await expect(status(page)).toHaveText("Found 50 songs");
    await expect(sheet(page).locator(".VersionRow")).toContainText("Version 0.3.0");
    await expect(sheet(page)).toContainText("Inter typeface, SIL Open Font License 1.1");
    if (phone) {
      await expect(settingRow(page, "Download helper")).toContainText(`yt-dlp ${app.data.ytdlpVersion}`);
      await expect(sheet(page).getByRole("textbox", { name: "Password" })).toBeVisible(); // Proton login form
    }
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("settings"));
  });

  test("the text size sets --text-scale on the root and is remembered", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    await sheet(page).getByRole("combobox", { name: "Text size" }).click();
    await page.getByRole("option", { name: "130%" }).click();
    const scale = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"));
    await expect.poll(scale).toBe("1.3");
    await expect.poll(async () => (await storeOf(page)).text_scale).toBe(1.3);
    await sheet(page).getByRole("combobox", { name: "Text size" }).click();
    await page.getByRole("option", { name: "100%" }).click();
    await expect.poll(scale).toBe("");
  });

  test("a stored text size applies at start", async ({ app, page }) => {
    await beforeLoad(page, () => window.__soundhoodMock.store.set("text_scale", 1.15));
    await app.open();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"))).toBe("1.15");
  });
});

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("Ctrl+comma opens the settings", async ({ app, page }) => {
    await app.open();
    await expect(sheet(page)).toHaveCount(0);
    await page.keyboard.press("Control+Comma");
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("Copy log carries the change lines below the visible log; a refused copy says how to copy by hand", async ({ app, page }) => {
    await app.open();
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await addQuietBloomToFocus(page);
    await openSettings(app, page);
    // Copy log is in Tools with or without a log; the add put no line in the visible log.
    await expect(sheet(page).getByRole("button", { name: "Copy log" })).toBeVisible();
    await expect(status(page)).toHaveText("Found 50 songs");
    await app.settled();

    // Download output still goes to the log, as before.
    await emit(page, "ytdlp:stdout", "[download] Destination: Downloads/A - B.m4a");
    await expect(status(page)).toHaveText("[download] Destination: Downloads/A - B.m4a");
    let log = await openLog(page);
    await expect(log.locator(".LogText")).toContainText("[download] Destination");
    await expect(log.locator(".LogText")).not.toContainText("[change]");
    await log.getByRole("button", { name: "Copy log" }).click();
    await expect(toast(page, "Log copied")).toBeVisible();
    const copied = await page.evaluate(() => window.__copied[0]);
    expect(copied.startsWith("appVersion: 0.3.0\n")).toBe(true);
    const at = (s) => copied.indexOf(s);
    expect(at("[download] Destination")).toBeGreaterThan(at("sidecars:"));
    expect(at("[change] Added 1 track to Focus")).toBeGreaterThan(at("[download] Destination"));

    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
      document.execCommand = () => false;
    });
    await log.getByRole("button", { name: "Copy log" }).click();
    await expect(toast(page, "Copy failed: select the log text and press Ctrl+C")).toBeVisible();

    // Clear log clears both: the next copy has no change lines.
    await log.getByRole("button", { name: "Clear log" }).click();
    await expect(log.locator(".LogText")).toHaveCount(0);
    await log.getByRole("button", { name: "Close", exact: true }).click();
    await expect(status(page)).toHaveText("Nothing logged yet");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await emit(page, "ytdlp:stdout", "[download] 100%");
    await sheet(page).getByRole("button", { name: "Copy log" }).click();
    await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
    expect(await page.evaluate(() => window.__copied.at(-1))).not.toContain("[change]");
    log = await openLog(page);
    await expect(log.locator(".LogText")).toHaveText("[download] 100%");
  });

  test("a partial undo says how much was left and shows why in the report and the log", async ({ app, page }) => {
    await app.open();
    await addQuietBloomToFocus(page);
    await openSettings(app, page);
    await expect(settingRow(page, "Undo last change").locator(".SettingRow-help")).toHaveText("Added 1 song to Focus");
    await page.evaluate(() => {
      window.__soundhoodMock.undoSkipped = [{ path: "_Playlists/Focus.m3u8", reason: "changed since, not undone" }];
    });
    await settingRow(page, "Undo last change").getByRole("button", { name: "Undo" }).click();
    // Nothing closes silently: the report stays until Done, and an undo has no undo of its own.
    const r = report(page);
    await expect(r.getByRole("heading")).toHaveText("Undo: 0 restored, 1 left as they are (see the log)");
    await expect(r.locator(".BatchRow.is-skipped .BatchRow-main")).toHaveText("Focus");
    await expect(r.locator(".BatchRow.is-skipped")).toContainText("changed since, not undone");
    await expect(r.getByRole("button", { name: "Undo this batch" })).toHaveCount(0);
    await page.waitForTimeout(5000);
    await expect(r).toBeVisible();
    await r.getByRole("button", { name: "Done" }).last().click();
    await expect(report(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("[skipped] _Playlists/Focus.m3u8 - changed since, not undone");
  });

  test("Make playlists from folders says how many it made; with nothing to make, no Undo; its Undo is its own", async ({ app, page }) => {
    const history = () => page.evaluate(() => window.__soundhoodMock.history.map((h) => h.summary.label));
    await app.open();
    // A tag edit first: no Undo below may take it back.
    await openPlaylist(page, "Late Night");
    await row(page, "Quiet Bloom").click({ modifiers: ["Control"] });
    await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Edit tags" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit tags" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Quiet Bloom (Night Edit)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await report(page).getByRole("button", { name: "Done" }).last().click();
    await page.keyboard.press("Escape");
    await goTo(page, "Folders");
    await openSettings(app, page);
    const make = settingRow(page, "Make playlists from folders").getByRole("button", { name: "Make" });

    // Five folders without a playlist of their name: five made, said as five, with Undo.
    await make.click();
    const made = toast(page, "Created 5 playlist files in _Playlists");
    await expect(made).toBeVisible();
    expect(await history()).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg", "Made 5 playlists from folders"]);

    // Again: nothing to make, nothing journaled, and no Undo to press.
    await make.click();
    const none = toast(page, "Every folder already has its playlist");
    await expect(none).toBeVisible();
    expect(await none.getByRole("button").count()).toBe(0);
    expect(await history()).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg", "Made 5 playlists from folders"]);

    // The first toast's Undo takes back the five playlists, and only them.
    await made.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Undone: Made 5 playlists from folders")).toBeVisible();
    expect(await history()).toEqual(["Edited tags of Quiet Bloom - Anouk Lirr.ogg"]);
    await expect(report(page)).toHaveCount(0);
  });

  test("the test library: named, not printed; on follows the shown folder; off goes back", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    const fixtureRoot = await page.evaluate(() => window.__soundhoodMock.fixtureRoot);
    await expect(developer(page)).toHaveCount(0);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(developer(page)).toBeVisible();
    const sw = testSwitch(page);
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(settingRow(page, "Test library")).toContainText("Off: your own library is shown");
    await expect(folderLine(page)).toHaveText(app.data.root);
    await expect(page.locator(".TestBadge")).toHaveCount(0);

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(settingRow(page, "Test library")).toContainText("On: the generated test library is shown, and sync is off");
    await expect(folderLine(page)).toHaveText("test library");
    await expect(page.locator(".TestBadge").filter({ visible: true })).toHaveText("Test library");
    await expect(page.locator("body")).not.toContainText("AppData");
    // The switch's own lines go only to what Copy log carries.
    await expect(status(page)).not.toContainText("[dev]");
    let s = await storeOf(page);
    expect(s).toMatchObject({ library_dir: fixtureRoot, fixture_root: fixtureRoot, real_library_dir: app.data.root });

    // The note stays when the developer section is hidden.
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    await expect(developer(page)).toHaveCount(0);
    await expect(page.locator(".TestBadge").filter({ visible: true })).toBeVisible();
    await page.keyboard.press("Control+Alt+Shift+KeyD");

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(folderLine(page)).toHaveText(app.data.root);
    await expect(page.locator(".TestBadge")).toHaveCount(0);
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
    await expect(folderLine(page)).toHaveText("test library");
    await expect(page.locator(".TestBadge").filter({ visible: true })).toBeVisible();
    await expect(testSwitch(page)).toHaveAttribute("aria-checked", "true");
    await testSwitch(page).click();
    await expect(folderLine(page)).toHaveText("C:/Music");
    await expect(testSwitch(page)).toHaveAttribute("aria-checked", "false");
  });

  test("no real library known: on then off closes the library instead of keeping the test one", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await app.open({ until: "platform" });
    // An install that ran before but has no folder: the setup asks for the folder alone.
    await expect(page.locator(".Onboarding")).toContainText("Step 1 of 1");
    await page.locator(".Onboarding").getByRole("button", { name: "Skip" }).click();
    await expect(page.locator(".Onboarding")).toHaveCount(0);
    await openSettings(app, page);
    await expect(folderLine(page)).toHaveText("None chosen yet");
    const sw = testSwitch(page);
    await sw.click();
    await expect(folderLine(page)).toHaveText("test library");
    expect((await storeOf(page)).real_library_dir).toBeUndefined();

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(folderLine(page)).toHaveText("None chosen yet");
    await expect(toast(page, "Test library off: choose your library folder again")).toBeVisible();
    await expect(page.locator(".TestBadge")).toHaveCount(0);
    await expect(page.locator(".TrackRow, .PlaylistCard")).toHaveCount(0);
    expect((await storeOf(page)).library_dir).toBe("");
  });

  test("the self-test result reads in sentence case", async ({ app, page }) => {
    await beforeLoad(page, () => window.__soundhoodMock.store.set("dev_mode", true));
    await app.open();
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: "Run self-test" }).click();
    await expect(toast(page, "Self-test: 2 passed, 0 failed")).toBeVisible();
    await expect(status(page)).toHaveText("Self-test: 2 passed, 0 failed");
  });
});

/** The phone's settings sheet, once the helper's version is in. */
async function openPhoneSettings(app, page) {
  await openSettings(app, page);
  await app.settled("plugin:soundhood-ytdl|ytdlp_version");
}

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("the test library turns Proton sync off and names the library", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.proton = { bundled: true, connected: true, username: "tester@example.com" };
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await app.open();
    await goTo(page, "Folders");
    await openPhoneSettings(app, page);
    const buttons = ["Sync now", "Get new", "Send new"].map((name) => sheet(page).getByRole("button", { name, exact: true }));
    for (const b of buttons) await expect(b).toBeEnabled();
    await expect(sheet(page)).not.toContainText(SYNC_OFF);

    await testSwitch(page).tap();
    await expect(folderLine(page)).toHaveText("test library");
    for (const b of buttons) await expect(b).toBeDisabled();
    await expect(sheet(page)).toContainText(SYNC_OFF);
    await expect(page.locator(".TestBadge").filter({ visible: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("fixture-library");
    expect(await ipcCount(page, "protonSyncs")).toBe(0);

    await testSwitch(page).tap();
    await expect(folderLine(page)).toHaveText(app.data.root);
    for (const b of buttons) await expect(b).toBeEnabled();
    await expect(sheet(page)).not.toContainText(SYNC_OFF);
  });

  test("a failed Proton login shows an error row with Copy log and Retry; Retry logs in", async ({ app, page }) => {
    await beforeLoad(page, () => (window.__soundhoodMock.protonLoginError = "Proton refused the login: wrong password"));
    await app.open();
    await openPhoneSettings(app, page);
    await sheet(page).getByRole("textbox", { name: "Proton email" }).fill("tester@example.com");
    await sheet(page).getByRole("textbox", { name: "Password" }).fill("test-password");
    await sheet(page).getByRole("button", { name: "Connect" }).tap();
    const error = sheet(page).locator(".ErrorRow");
    await expect(error).toContainText("Proton login failed");
    await expect(error).toContainText("Proton refused the login: wrong password");
    await expect(error.getByRole("button", { name: "Copy log" })).toBeVisible();
    await page.evaluate(() => (window.__soundhoodMock.protonLoginError = ""));
    await error.getByRole("button", { name: "Retry" }).tap();
    await expect(sheet(page).locator(".ErrorRow")).toHaveCount(0);
    await expect(toast(page, "Connected to Proton Drive as tester@example.com")).toBeVisible();
    await expect(settingRow(page, "Account")).toContainText("tester@example.com");
  });
});

test.describe("tablet and phone: View log", { tag: "@phone" }, () => {
  test("View log shows the visible log and its newest line", async ({ app, page }) => {
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Static Garden");
    await openPhoneSettings(app, page);
    // The phone plays from the file's bytes, and says so in the log.
    await expect(status(page)).toHaveText(/^Playing \(/);
    const log = await openLog(page);
    await expect(log.locator(".LogText")).toContainText("Found 50 songs");
    await expect(log.locator(".LogText")).toContainText("Playing (");
  });
});
