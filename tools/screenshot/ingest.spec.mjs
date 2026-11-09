// Behaviour checks of adding and downloading links on the mocked UI (no screenshots): the narrow
// desktop window, the download queue after a refusal, channel links. Moved here from flows.spec.mjs.
import { readFileSync } from "node:fs";
import { expect, test } from "./harness.mjs";

// The one refusal sentence, from the vector file the UI and plugin unit tests share.
const CHANNEL_REFUSAL = JSON.parse(readFileSync(new URL("./channel-links.json", import.meta.url), "utf8")).refusal;
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const ipcCount = (page, field) => page.evaluate((f) => window.__soundhoodMock[f].length, field);

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  const status = (page) => page.locator(".topbar .status");

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

  test("a download the host refuses to start says why on the status line", async ({ app, page }) => {
    await beforeLoad(page, (reason) => {
      window.__soundhoodMock.downloadError = reason;
    }, CHANNEL_REFUSAL);
    await app.open();
    await page.locator(".downloadBar .downloadInput").fill("https://www.youtube.com/watch?v=AbCdEfGhIjK");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect(status(page)).toHaveText(`Status: ${CHANNEL_REFUSAL}`);
    await expect(page.locator(".downloadLogs")).toContainText(`[error] ${CHANNEL_REFUSAL}`);
    expect(await ipcCount(page, "downloads")).toBe(1);
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  });

});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  const status = (page) => page.locator(".topbar .status");

  async function openSettings(app, page) {
    await page.locator(".topbar .brand .iconBtn").tap();
    await expect(page.locator(".mSettings")).toBeVisible();
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

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

  // The phone plays from the file's bytes, a route that once never reported the song's length: the
  // seek bar sat at 0:00 / 0:00 and could not be dragged.
});
