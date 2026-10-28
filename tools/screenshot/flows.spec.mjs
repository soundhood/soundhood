// Behaviour checks on the mocked UI (no screenshots): the log, Copy log, the narrow desktop window,
// the test library switch and what it turns off, the download queue after a refusal, channel links.
import { readFileSync } from "node:fs";
import { expect, test } from "./harness.mjs";

// The one refusal sentence, from the vector file the UI and plugin unit tests share.
const CHANNEL_REFUSAL = JSON.parse(readFileSync(new URL("./channel-links.json", import.meta.url), "utf8")).refusal;
const SYNC_OFF = "Sync is off while the test library is shown";

/** The settings store as the mock holds it. */
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const ipcCount = (page, field) => page.evaluate((f) => window.__soundhoodMock[f].length, field);

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  const status = (page) => page.locator(".topbar .status");

  test("Copy log carries the change lines below the visible log; a refused copy says how to copy by hand", async ({ app, page }) => {
    await app.open();
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await page.locator(".pill.artistPill", { hasText: "Late Night Drive" }).click();
    await page.locator(".trackRow", { hasText: "Glass Tides" }).click();
    await page.locator(".searchRow .ddBtn", { hasText: "Add to playlist" }).click();
    await page.locator(".ddMenu .ddItem", { hasText: "Morning Focus" }).click();
    await expect(status(page)).toHaveText("Status: Added to Morning Focus");
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
    expect(at("[change] Added 1 track to Morning Focus")).toBeGreaterThan(at("[download] Destination"));

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
    await page.locator(".pill.artistPill", { hasText: "Late Night Drive" }).click();
    await page.locator(".trackRow", { hasText: "Glass Tides" }).click();
    await page.locator(".searchRow .ddBtn", { hasText: "Add to playlist" }).click();
    await page.locator(".ddMenu .ddItem", { hasText: "Morning Focus" }).click();
    await expect(status(page)).toHaveText("Status: Added to Morning Focus");
    await page.evaluate(() => {
      window.__soundhoodMock.undoSkipped = [{ path: "_Playlists/Morning Focus.m3u8", reason: "changed since, not undone" }];
    });
    await page.locator(".topbar .btn", { hasText: /^Undo$/ }).click();
    await expect(status(page)).toHaveText("Status: Undo: 0 restored, 1 left as they are (see the log)");
    await expect(page.locator(".downloadLogs")).toHaveText("[skipped] _Playlists/Morning Focus.m3u8 - changed since, not undone");
  });

  test("at 760 px wide the download bar wraps instead of scrolling sideways", async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "one desktop size is enough");
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [{ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 1 }]);
    });
    await page.setViewportSize({ width: 760, height: 520 });
    await app.open();
    const overflow = () =>
      page.evaluate(() => {
        const doc = document.documentElement;
        const bar = document.querySelector(".downloadBar");
        return { page: doc.scrollWidth - doc.clientWidth, bar: bar.scrollWidth - bar.clientWidth };
      });
    await emit(page, "ytdlp:stdout", "[download] Destination: Downloads/A - B.m4a");
    await expect(page.getByRole("button", { name: "Copy log" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download queue (1)" })).toBeVisible();
    expect(await overflow()).toEqual({ page: 0, bar: 0 });

    // The new-folder box is the widest the bar gets.
    await page.locator(".downloadBar .ddBtn").first().click();
    await page.locator(".ddMenu .ddItem", { hasText: "New folder" }).click();
    await expect(page.locator(".downloadBar .targetNew")).toBeVisible();
    expect(await overflow()).toEqual({ page: 0, bar: 0 });
  });

  test("the test library: named, not printed; on follows the shown folder; off goes back", async ({ app, page }) => {
    await app.open();
    const fixtureRoot = await page.evaluate(() => window.__soundhoodMock.fixtureRoot);
    await page.keyboard.press("Control+Alt+Shift+KeyD");
    const sw = page.getByRole("switch");
    await expect(sw).toHaveText("Use fixture root: off");
    await expect(page.locator(".pathLine")).toHaveText(`Folder: ${app.data.root}`);
    await expect(page.locator(".testLibraryNote")).toHaveCount(0);

    await sw.click();
    await expect(sw).toHaveText("Use fixture root: on");
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
    await expect(sw).toHaveText("Use fixture root: off");
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
    await expect(page.locator(".pathLine")).toHaveText("Folder: test library");
    await expect(page.locator(".testLibraryNote")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveText("Use fixture root: on");
    await page.getByRole("switch").click();
    await expect(page.locator(".pathLine")).toHaveText("Folder: C:/Music");
    await expect(page.getByRole("switch")).toHaveText("Use fixture root: off");
  });

  test("no real library known: on then off closes the library instead of keeping the test one", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await page.goto("/");
    await app.settled("platform");
    await expect(page.locator(".pathLine")).toHaveText("Pick a folder to begin.");
    const sw = page.getByRole("switch");
    await sw.click();
    await expect(page.locator(".pathLine")).toHaveText("Folder: test library");
    expect((await storeOf(page)).real_library_dir).toBeUndefined();

    await sw.click();
    await expect(sw).toHaveText("Use fixture root: off");
    await expect(page.locator(".pathLine")).toHaveText("Pick a folder to begin.");
    await expect(status(page)).toHaveText("Status: Test library off: choose your library folder again");
    await expect(page.locator(".testLibraryNote")).toHaveCount(0);
    await expect(page.locator(".trackRow")).toHaveCount(0);
    expect((await storeOf(page)).library_dir).toBe("");
  });

  test("a refused download stops the queue; the link stays queued", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [
        { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 3 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", added: 2 },
        { url: "https://www.youtube.com/watch?v=ccccccccccc", added: 1 },
      ]);
    });
    await app.open();
    await page.getByRole("button", { name: "Download queue (3)" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);

    // The first link finishes: the queue moves on to the second.
    await emit(page, "ytdlp:done", 0);
    await expect.poll(() => ipcCount(page, "downloads")).toBe(2);
    await expect(page.getByRole("button", { name: "Download queue (2)" })).toBeVisible();

    // The second meets the bot wall: nothing else is started.
    await emit(page, "ytdlp:stderr", "ERROR: [youtube] bbbbbbbbbbb: Sign in to confirm you're not a bot");
    await emit(page, "ytdlp:done", 1);
    await expect(status(page)).toHaveText("Status: Queue stopped: [youtube] bbbbbbbbbbb: Sign in to confirm you're not a bot");
    await page.waitForTimeout(1000);
    expect(await ipcCount(page, "downloads")).toBe(2);
    await expect(page.getByRole("button", { name: "Download queue (2)" })).toBeVisible();
  });

  test("a channel link is refused in the download box and in the queue", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [{ url: "https://www.youtube.com/@someartist/videos", added: 1 }]);
    });
    await app.open();
    // The common shape, then the ones only the core used to know: an uploads list, a legacy name.
    for (const url of [
      "https://www.youtube.com/channel/UC0123456789abcdefghijkl",
      "https://www.youtube.com/playlist?list=UU0123456789abcdefghijkl",
      "https://www.youtube.com/SomeLegacyName/videos",
    ]) {
      // Move the status off the refusal first (the developer toggle names itself there).
      await page.keyboard.press("Control+Alt+Shift+KeyD");
      await expect(status(page)).toHaveText(/^Status: Developer tools (on|off)$/);
      await page.locator(".downloadBar .downloadInput").fill(url);
      await page.getByRole("button", { name: "Download", exact: true }).click();
      await expect(status(page)).toHaveText(`Status: ${CHANNEL_REFUSAL}`);
    }
    await page.getByRole("button", { name: "Download queue (1)" }).click();
    await expect(status(page)).toHaveText(`Status: ${CHANNEL_REFUSAL}`);
    await app.settled();
    expect(await ipcCount(page, "downloads")).toBe(0);
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  const status = (page) => page.locator(".topbar .status");

  async function openSettings(app, page) {
    await page.locator(".topbar .brand .iconBtn").tap();
    await expect(page.locator(".mSettings")).toBeVisible();
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

  test("the test library turns Proton sync off and names the library", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.proton = { bundled: true, connected: true, username: "tester@example.com" };
      window.__soundhoodMock.store.set("dev_mode", true);
    });
    await app.open();
    await openSettings(app, page);
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

  test("a shared or pasted channel link is refused before it is queued", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    await page.getByPlaceholder("Paste a YouTube link…").fill("https://www.youtube.com/@someartist/videos");
    await page.getByRole("button", { name: "Add", exact: true }).tap();
    await expect(status(page)).toHaveText(CHANNEL_REFUSAL);
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(page.locator(".mSettings .downloadLogs")).toContainText(CHANNEL_REFUSAL);

    const queued = await page.evaluate(() => window.__soundhoodShare("listen: https://m.youtube.com/c/SomeArtist"));
    expect(queued).toBe(false);
    await expect(page.locator(".modal")).toHaveCount(0);

    // A single video still opens "Where should this go?".
    await page.getByPlaceholder("Paste a YouTube link…").fill("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    await page.getByRole("button", { name: "Add", exact: true }).tap();
    await expect(page.locator(".modal .modalTitle")).toHaveText("Where should this go?");
  });

  test("a refused phone download stops the queue", async ({ app, page }) => {
    await beforeLoad(page, () => {
      const m = window.__soundhoodMock;
      m.store.set("share_queue", [
        { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 2 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", added: 1 },
      ]);
      m.phoneDownload = { exitCode: 1, files: [], log: "ERROR: [youtube] aaaaaaaaaaa: Sign in to confirm you're not a bot\n" };
    });
    await app.open();
    await openSettings(app, page);
    await page.getByRole("button", { name: "Download queue (2)" }).tap();
    await expect(status(page)).toHaveText("Queue stopped: [youtube] aaaaaaaaaaa: Sign in to confirm you're not a bot");
    await page.waitForTimeout(1000);
    expect(await ipcCount(page, "downloads")).toBe(1);
    await expect(page.getByRole("button", { name: "Download queue (2)" })).toBeVisible();
  });
});
