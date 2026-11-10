// Behaviour of getting music in on the mocked UI: pasting a link anywhere (Ctrl+V outside a text
// field) opens "Where should this go?" and downloads into the remembered folder and playlists, as
// the old download box did (the owner's migration rule); the sidebar's Download item; the running
// download's toast; a refused download stops the queue with an error row; channel links; the
// downloader switch (switched off, nothing more starts: not the queue's next link, not a Retry);
// one download at a time (a Retry pressed while another runs starts nothing, keeps its error row and
// says why; the running one is filed into its own playlists; Undo last change waits for its end);
// Enter in the New folder field; the links waiting with copy and remove; the narrow window. On the
// phone: a shared link, a refused queue, Cancel, a Retry tapped while another download runs.
import { readFileSync } from "node:fs";
import { expect, test } from "./harness.mjs";
import { openSettings, settingRow, status } from "./ui.mjs";

// The one refusal sentence, from the vector file the UI and plugin unit tests share.
const CHANNEL_REFUSAL = JSON.parse(readFileSync(new URL("./channel-links.json", import.meta.url), "utf8")).refusal;
const VIDEO = "https://www.youtube.com/watch?v=AbCdEfGhIjK";
/** Sends a host event, like the Rust side does. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.__soundhoodEmit(e, p), [event, payload]);
/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const ipcCount = (page, field) => page.evaluate((f) => window.__soundhoodMock[f].length, field);
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const where = (page) => page.getByRole("dialog", { name: "Where should this go?" });
const sheet = (page) => page.locator(".SettingsSheet");

/** Ctrl+V with `text` on the clipboard, with focus on `selector` (the page itself by default). */
async function paste(page, text, selector = "body") {
  await page.evaluate(
    ([t, sel]) => {
      const target = document.querySelector(sel) ?? document.body;
      const data = new DataTransfer();
      data.setData("text/plain", t);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [text, selector],
  );
}

/** The sidebar's (or the rail's) Download item. */
const downloadItem = (page) => page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Download" });

/** A journaled change made before the app starts, so Undo last change has something to undo. */
const seedChange = (page, path) =>
  beforeLoad(page, (p) => void window.__TAURI_INTERNALS__.invoke("playlist_add", { args: { libraryDir: "", name: "Empty", paths: [p] } }), path);
/** What the journal holds, newest last, in the core's words. */
const journalLabels = (page) => page.evaluate(() => window.__soundhoodMock.history.map((h) => h.summary.label));
/** Picks or unpicks one playlist in "Where should this go?" (the pointer, or a tap on touch). */
async function togglePlaylist(page, name, touch = false) {
  const box = where(page).getByRole("combobox", { name: "Playlists" });
  await (touch ? box.tap() : box.click());
  const option = page.getByRole("option", { name });
  await (touch ? option.tap() : option.click());
  await page.keyboard.press("Escape");
}
const A_LINK = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
const B_LINK = "https://www.youtube.com/watch?v=BBBBBBBBBBB";

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("Ctrl+V outside a text field: Where should this go?, then Download into the remembered folder and playlists", async ({ app, page }) => {
    await app.open();
    // Pasting into a text field pastes there, as anywhere else.
    await page.locator(".Sidebar .SearchField input").focus();
    await paste(page, VIDEO, ".Sidebar .SearchField input");
    await expect(where(page)).toHaveCount(0);
    await page.locator(".Sidebar .SearchField input").blur();

    await paste(page, `listen to this: ${VIDEO}`);
    await expect(where(page)).toBeVisible();
    await expect(where(page).getByRole("textbox", { name: "Link" })).toHaveValue(VIDEO);
    await expect(where(page).getByRole("combobox", { name: "Folder" })).toHaveText("Downloads");
    await where(page).getByRole("combobox", { name: "Playlists" }).click();
    await page.getByRole("option", { name: "Focus" }).click();
    await page.keyboard.press("Escape");
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect(where(page)).toHaveCount(0);

    // As the old download box: straight to the host, not queued; the choices are remembered.
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    const sent = await page.evaluate(() => window.__soundhoodMock.downloads[0]);
    expect(sent).toMatchObject({ url: VIDEO, targetFolder: "Downloads", playlist: false });
    await expect.poll(async () => (await storeOf(page)).download_playlists).toEqual(["Focus"]);
    expect((await storeOf(page)).share_queue ?? []).toEqual([]);

    // The running download's toast, with the purple line once yt-dlp reports progress.
    await expect(toast(page, "Downloading")).toBeVisible();
    await emit(page, "ytdlp:stdout", "[download]  45.0% of    3.00MiB at  1.00MiB/s ETA 00:02");
    await expect(toast(page, "Downloading: 45%")).toBeVisible();
    await expect(toast(page, "Downloading").locator(".Toast-progress")).toHaveCount(1);
    await expect(toast(page, "Downloading").getByRole("button")).toHaveCount(0); // the PC host has no cancel

    // It finishes: the file joins the playlist chosen; the toast says so.
    const file = app.data.tracks.find((t) => t.name.startsWith("Quiet Bloom")).path;
    await emit(page, "ytdlp:files", [file]);
    await emit(page, "ytdlp:done", 0);
    await expect(toast(page, "Downloaded 1 and added to 1 playlist")).toBeVisible();
    await expect(page.locator(".Toast").filter({ hasText: "Downloading" })).toHaveCount(0);
  });

  test("the sidebar's Download item opens the sheet with an empty link field", async ({ app, page }) => {
    await app.open();
    await downloadItem(page).click();
    await expect(where(page)).toBeVisible();
    const link = where(page).getByRole("textbox", { name: "Link" });
    await expect(link).toBeFocused();
    await expect(where(page).getByRole("button", { name: "Download", exact: true })).toBeDisabled();
    await link.fill(VIDEO);
    // A new folder: its name is checked before anything is made.
    await where(page).getByRole("combobox", { name: "Folder" }).click();
    await page.getByRole("option", { name: "New folder" }).click();
    await where(page).getByRole("textbox", { name: "New folder name" }).fill("../Outside");
    await where(page).getByRole("button", { name: "Queue" }).click();
    await expect(where(page).locator(".ErrorRow")).toBeVisible();
    await where(page).getByRole("textbox", { name: "New folder name" }).fill("Live Sets");
    await where(page).getByRole("button", { name: "Queue" }).click();
    await expect(where(page)).toHaveCount(0);
    await expect(toast(page, "Link queued")).toBeVisible();
    expect((await storeOf(page)).share_queue).toMatchObject([{ url: VIDEO, target: "Live Sets", playlists: [] }]);
    expect(await ipcCount(page, "downloads")).toBe(0);
  });

  test("at 760 px wide nothing scrolls sideways: the settings and the download sheet", async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "one desktop size is enough");
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [{ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 1 }]);
    });
    await page.setViewportSize({ width: 760, height: 520 });
    await app.open();
    const overflow = (sel) =>
      page.evaluate((s) => {
        const doc = document.documentElement;
        const el = document.querySelector(s);
        return { page: doc.scrollWidth - doc.clientWidth, sheet: el.scrollWidth - el.clientWidth };
      }, sel);
    await openSettings(app, page);
    await emit(page, "ytdlp:stdout", "[download] Destination: Downloads/A - B.m4a");
    await expect(sheet(page).getByRole("button", { name: "Copy log" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: "Download queue (1)" })).toBeVisible();
    expect(await overflow(".SettingsSheet .Sheet-body")).toEqual({ page: 0, sheet: 0 });
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();

    // The new-folder field is the widest the download sheet gets.
    await downloadItem(page).click();
    await where(page).getByRole("combobox", { name: "Folder" }).click();
    await page.getByRole("option", { name: "New folder" }).click();
    await expect(where(page).getByRole("textbox", { name: "New folder name" })).toBeVisible();
    expect(await overflow(".WhereSheet .Sheet-body")).toEqual({ page: 0, sheet: 0 });
  });

  test("a refused download stops the queue with an error row; the link stays queued", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [
        { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 3 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", added: 2 },
        { url: "https://www.youtube.com/watch?v=ccccccccccc", added: 1 },
      ]);
    });
    await app.open();
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: "Download queue (3)" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await expect(toast(page, "Downloading 1 of 3")).toBeVisible();

    // The first link finishes: the queue moves on to the second.
    await emit(page, "ytdlp:done", 0);
    await expect.poll(() => ipcCount(page, "downloads")).toBe(2);
    await expect(sheet(page).getByRole("button", { name: "Download queue (2)" })).toBeVisible();
    await expect(toast(page, "Downloading 2 of 3")).toBeVisible();

    // The second meets the bot wall: nothing else is started.
    await emit(page, "ytdlp:stderr", "ERROR: [youtube] bbbbbbbbbbb: Sign in to confirm you're not a bot");
    await emit(page, "ytdlp:done", 1);
    await expect(toast(page, "Queue stopped: [youtube] bbbbbbbbbbb: Sign in to confirm you're not a bot")).toBeVisible();
    const error = sheet(page).locator(".ErrorRow");
    await expect(error).toContainText("Queue stopped");
    await expect(error).toContainText("[youtube] bbbbbbbbbbb: Sign in to confirm you're not a bot");
    await expect(error.getByRole("button", { name: "Copy log" })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await ipcCount(page, "downloads")).toBe(2);
    await expect(sheet(page).getByRole("button", { name: "Download queue (2)" })).toBeVisible();

    // Retry tries that link again.
    await error.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(3);
    expect(await page.evaluate(() => window.__soundhoodMock.downloads[2].url)).toBe("https://www.youtube.com/watch?v=bbbbbbbbbbb");
    await expect(sheet(page).locator(".ErrorRow")).toHaveCount(0);
  });

  test("a stopped queue's Retry downloads that link alone, and then says how many still wait, not Queue done", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [
        { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 3 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", added: 2 },
        { url: "https://www.youtube.com/watch?v=ccccccccccc", added: 1 },
      ]);
    });
    await app.open();
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: "Download queue (3)" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await emit(page, "ytdlp:stderr", "ERROR: [youtube] aaaaaaaaaaa: Sign in to confirm you're not a bot");
    await emit(page, "ytdlp:done", 1);
    const retry = toast(page, "Queue stopped").getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(2);
    await emit(page, "ytdlp:done", 0);
    await expect(toast(page, "2 links still waiting in the queue")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await page.locator(".Toast > span").allTextContents(), "never Queue done while links wait").not.toContain("Queue done");
    expect(await ipcCount(page, "downloads"), "the waiting links are not started").toBe(2);
    await expect(sheet(page).getByRole("button", { name: "Download queue (2)" })).toBeVisible();
  });

  test("a channel link is refused when pasted, in the download sheet and in the queue", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [{ url: "https://www.youtube.com/@someartist/videos", added: 1 }]);
    });
    await app.open();
    await paste(page, "https://www.youtube.com/@someartist");
    await expect(toast(page, CHANNEL_REFUSAL)).toBeVisible();
    await expect(where(page)).toHaveCount(0);
    // The common shape, then the ones only the core used to know: an uploads list, a legacy name.
    for (const url of [
      "https://www.youtube.com/channel/UC0123456789abcdefghijkl",
      "https://www.youtube.com/playlist?list=UU0123456789abcdefghijkl",
      "https://www.youtube.com/SomeLegacyName/videos",
    ]) {
      await downloadItem(page).click();
      await expect(where(page).locator(".ErrorRow")).toHaveCount(0);
      await where(page).getByRole("textbox", { name: "Link" }).fill(url);
      await where(page).getByRole("button", { name: "Download", exact: true }).click();
      await expect(where(page).locator(".ErrorRow .ErrorRow-detail")).toHaveText(CHANNEL_REFUSAL);
      await where(page).getByRole("button", { name: "Cancel" }).click();
    }
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: "Download queue (1)" }).click();
    await expect(toast(page, CHANNEL_REFUSAL)).toBeVisible();
    await expect(status(page)).toHaveText(`[error] ${CHANNEL_REFUSAL}`);
    await app.settled();
    expect(await ipcCount(page, "downloads")).toBe(0);
  });

  test("a download the host refuses to start says why in a toast and the log", async ({ app, page }) => {
    await beforeLoad(page, (reason) => {
      window.__soundhoodMock.downloadError = reason;
    }, CHANNEL_REFUSAL);
    await app.open();
    await paste(page, VIDEO);
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect(toast(page, CHANNEL_REFUSAL)).toBeVisible();
    expect(await ipcCount(page, "downloads")).toBe(1);
    await openSettings(app, page);
    await expect(status(page)).toHaveText(`[error] ${CHANNEL_REFUSAL}`);
    // Nothing is left running: the next link can download at once.
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
    await paste(page, VIDEO);
    await expect(where(page).getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  });

  test("one download at a time: a Retry pressed while another runs starts nothing, keeps its error row, and the running one is filed into its own playlists", async ({ app, page }) => {
    await seedChange(page, app.data.tracks[0].path);
    await app.open();
    // A, into Focus, fails.
    await downloadItem(page).click();
    await where(page).getByRole("textbox", { name: "Link" }).fill(A_LINK);
    await togglePlaylist(page, "Focus");
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await emit(page, "ytdlp:stderr", "ERROR: [youtube] AAAAAAAAAAA: HTTP Error 503");
    await emit(page, "ytdlp:done", 1);
    const retry = toast(page, "Download failed").getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    // B, into no playlist (the sheet offers A's Focus again: unpicked), starts and runs.
    await downloadItem(page).click();
    await where(page).getByRole("textbox", { name: "Link" }).fill(B_LINK);
    await togglePlaylist(page, "Focus");
    await expect(where(page).getByRole("combobox", { name: "Playlists" })).toHaveText("None");
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(2);
    // A's Retry, past its toast's press guard: nothing starts, and a toast says why, with Retry.
    await page.waitForTimeout(450);
    await retry.click();
    await page.waitForTimeout(400);
    expect(await ipcCount(page, "downloads"), "no second download").toBe(2);
    await expect(toast(page, "Not retried: a download is running").getByRole("button", { name: "Retry" })).toBeVisible();
    // A's error row keeps its Retry, which starts nothing either; Undo last change waits for B.
    await openSettings(app, page);
    const error = sheet(page).locator(".ErrorRow");
    await expect(error).toContainText("Download failed");
    await error.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(400);
    expect(await ipcCount(page, "downloads")).toBe(2);
    await expect(error).toContainText("Download failed");
    const undo = settingRow(page, "Undo last change").getByRole("button", { name: "Undo" });
    await expect(settingRow(page, "Undo last change")).toContainText("Added 1 song to Empty");
    await expect(undo).toBeDisabled();
    // B ends with its file; while it is filed (a slow rescan) its toast has gone and Undo still waits.
    await page.evaluate(() => (window.__soundhoodMock.delay.scan_music_folder = 1500));
    await emit(page, "ytdlp:files", [app.data.tracks[1].path]);
    await emit(page, "ytdlp:done", 0);
    await expect(page.locator(".Toast").filter({ hasText: /^Downloading/ })).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await expect(undo).toBeEnabled({ timeout: 5000 });
    expect(await journalLabels(page), "B's song never lands in A's playlist").toEqual(["Added 1 track to Empty"]);
    await expect(toast(page, "Downloaded 1 file")).toBeVisible();
    // Now A's Retry downloads A, into its own playlist.
    await page.evaluate(() => (window.__soundhoodMock.delay.scan_music_folder = 0));
    await error.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(3);
    expect(await page.evaluate(() => window.__soundhoodMock.downloads[2].url)).toBe(A_LINK);
    await expect(sheet(page).locator(".ErrorRow")).toHaveCount(0);
    await emit(page, "ytdlp:files", [app.data.tracks[2].path]);
    await emit(page, "ytdlp:done", 0);
    await expect.poll(() => journalLabels(page)).toEqual(["Added 1 track to Empty", "Added 1 track to Focus"]);
  });

  test("an end that comes while no download runs files nothing, into the last download's playlists or anywhere", async ({ app, page }) => {
    await app.open();
    await downloadItem(page).click();
    await where(page).getByRole("textbox", { name: "Link" }).fill(B_LINK);
    await togglePlaylist(page, "Focus");
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await emit(page, "ytdlp:files", [app.data.tracks[2].path]);
    await emit(page, "ytdlp:done", 0);
    await expect.poll(() => journalLabels(page)).toEqual(["Added 1 track to Focus"]);
    // A second end, with another file (in no playlist yet), for no download.
    await emit(page, "ytdlp:files", [app.data.tracks[3].path]);
    await emit(page, "ytdlp:done", 0);
    await page.waitForTimeout(600);
    expect(await journalLabels(page), "nothing filed for it").toEqual(["Added 1 track to Focus"]);
  });

  test("the downloader switched off hides the download UI; a pasted link says where to turn it on", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    await expect(downloadItem(page)).toHaveCount(1);
    await sheet(page).getByRole("switch", { name: "Downloader" }).click();
    await expect(settingRow(page, "Download a link")).toHaveCount(0);
    await expect(downloadItem(page)).toHaveCount(0);
    await expect.poll(async () => (await storeOf(page)).downloader_enabled).toBe(false);
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
    await paste(page, VIDEO);
    await expect(toast(page, "The downloader is off. Turn it on in Settings, under YouTube.")).toBeVisible();
    await expect(where(page)).toHaveCount(0);
  });

  test("before startup has read the stored switch, the Download item opens nothing; after, it does", async ({ app, page }) => {
    // Stored on (the fixture is an existing install), read slowly: the default "on" is not a choice.
    await beforeLoad(page, () => (window.__soundhoodMock.delay["plugin:store|get"] = 300));
    await page.goto("/");
    await downloadItem(page).click();
    await expect(toast(page, "The settings are still loading. Try again in a moment.")).toBeVisible();
    await expect(where(page)).toHaveCount(0);
    // Pasting a link is the same path: nothing opens either.
    await paste(page, VIDEO);
    await expect(where(page)).toHaveCount(0);
    await app.settled("list_playlists");
    expect(await ipcCount(page, "downloads")).toBe(0);
    await downloadItem(page).click();
    await expect(where(page)).toBeVisible();
  });

  test("the downloader switched off mid-run: the queue stops after the download in flight", async ({ app, page }) => {
    const [a, b, c] = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id) => `https://www.youtube.com/watch?v=${id}`);
    await beforeLoad(
      page,
      (links) => window.__soundhoodMock.store.set("share_queue", links.map((url, i) => ({ url, added: 3 - i }))),
      [a, b, c],
    );
    await app.open();
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: "Download queue (3)" }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await sheet(page).getByRole("switch", { name: "Downloader" }).click();
    await expect.poll(async () => (await storeOf(page)).downloader_enabled).toBe(false);

    // The download in flight ends as usual; the next one never starts.
    await emit(page, "ytdlp:done", 0);
    await expect.poll(async () => (await storeOf(page)).share_queue.map((q) => q.url)).toEqual([b, c]);
    await page.waitForTimeout(1000);
    expect(await ipcCount(page, "downloads")).toBe(1);
    await expect(page.locator(".Toast").filter({ hasText: /^Downloading/ })).toHaveCount(0);
    await expect(toast(page, "Downloader off: the queue stops after this download")).toBeVisible();
  });

  test("switched off after a download failed, its Retry starts nothing and says where to turn it on", async ({ app, page }) => {
    await app.open();
    await paste(page, VIDEO);
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await emit(page, "ytdlp:stderr", "ERROR: [youtube] AbCdEfGhIjK: Video unavailable");
    await emit(page, "ytdlp:done", 1);
    const failed = toast(page, "Download failed");
    await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible();
    await openSettings(app, page);
    await sheet(page).getByRole("switch", { name: "Downloader" }).click();
    await expect.poll(async () => (await storeOf(page)).downloader_enabled).toBe(false);
    await sheet(page).getByRole("button", { name: "Close", exact: true }).click();
    await failed.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(500);
    expect(await ipcCount(page, "downloads")).toBe(1);
    await expect(toast(page, "The downloader is off. Turn it on in Settings, under YouTube.")).toBeVisible();
  });

  test("Enter in the New folder field checks the name and never starts the download", async ({ app, page }) => {
    await app.open();
    await downloadItem(page).click();
    await where(page).getByRole("textbox", { name: "Link" }).fill(VIDEO);
    await where(page).getByRole("combobox", { name: "Folder" }).click();
    await page.getByRole("option", { name: "New folder" }).click();
    const name = where(page).getByRole("textbox", { name: "New folder name" });
    await name.fill("../Outside");
    await name.press("Enter");
    await expect(where(page).locator(".ErrorRow")).toBeVisible();
    await name.fill("Live Sets");
    await name.press("Enter");
    await expect(where(page).locator(".ErrorRow")).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(where(page)).toBeVisible();
    expect(await ipcCount(page, "downloads")).toBe(0);
    expect((await storeOf(page)).share_queue ?? []).toEqual([]);
    // The download starts from its own button, into the folder named.
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    expect(await page.evaluate(() => window.__soundhoodMock.downloads[0].targetFolder)).toBe("Live Sets");
  });

  test("Links waiting: each link with where it goes, Copy (only says copied when it was) and Remove", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.set("share_queue", [
        { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", added: 2, target: "Evenings", playlists: ["Focus"] },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", added: 1 },
      ]);
    });
    await app.open();
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
    });
    await openSettings(app, page);
    await sheet(page).getByRole("button", { name: /^Links waiting/ }).click();
    const links = page.getByRole("dialog", { name: "Links waiting" });
    const rows = links.getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Into Evenings, joins Focus");
    await expect(rows.last()).toContainText("Into Downloads");

    await rows.first().getByRole("button", { name: "Copy link" }).click();
    await expect(toast(page, "Link copied")).toBeVisible();
    expect(await page.evaluate(() => window.__copied)).toEqual(["https://www.youtube.com/watch?v=aaaaaaaaaaa"]);
    await page.evaluate(() => (navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))));
    await rows.last().getByRole("button", { name: "Copy link" }).click();
    await expect(toast(page, "Copy failed: select the link and copy it by hand")).toBeVisible();

    await rows.last().getByRole("button", { name: "Remove from the list" }).click();
    await expect(rows).toHaveCount(1);
    expect((await storeOf(page)).share_queue.map((q) => q.url)).toEqual(["https://www.youtube.com/watch?v=aaaaaaaaaaa"]);
    await expect(links.getByRole("button", { name: "Download queue (1)" })).toBeEnabled();
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  async function openPhoneSettings(app, page) {
    await openSettings(app, page);
    await app.settled("plugin:soundhood-ytdl|ytdlp_version");
  }

  test("a shared or typed channel link is refused before it is queued", async ({ app, page }) => {
    await app.open();
    await openPhoneSettings(app, page);
    const field = sheet(page).getByRole("textbox", { name: "Link" });
    await field.fill("https://www.youtube.com/@someartist/videos");
    await sheet(page).getByRole("button", { name: "Add", exact: true }).tap();
    await expect(toast(page, CHANNEL_REFUSAL)).toBeVisible();
    await expect(where(page)).toHaveCount(0);
    await expect(status(page)).toHaveText(`[error] ${CHANNEL_REFUSAL}`);

    const queued = await page.evaluate(() => window.__soundhoodShare("listen: https://m.youtube.com/c/SomeArtist"));
    expect(queued).toBe(false);
    await expect(where(page)).toHaveCount(0);

    // A single video still opens "Where should this go?".
    await field.fill("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    await sheet(page).getByRole("button", { name: "Add", exact: true }).tap();
    await expect(where(page)).toBeVisible();
  });

  test("a stopped download's Retry tapped while another runs starts nothing; the running one is filed into its own playlists; Undo waits for its end", async ({ app, page }) => {
    await seedChange(page, app.data.tracks[0].path);
    await beforeLoad(page, () => (window.__soundhoodMock.holdPhoneDownload = true));
    await app.open();
    // A, into Focus, fails.
    expect(await page.evaluate((u) => window.__soundhoodShare(u), A_LINK)).toBe(true);
    await togglePlaylist(page, "Focus", true);
    await where(page).getByRole("button", { name: "Download", exact: true }).tap();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(1);
    await page.evaluate(() => {
      const m = window.__soundhoodMock;
      m.phoneDownload = { exitCode: 1, files: [], log: "ERROR: [youtube] AAAAAAAAAAA: HTTP Error 503\n" };
      m.finishPhoneDownload();
    });
    const retry = toast(page, "Queue stopped").getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    // B, into no playlist, runs.
    expect(await page.evaluate((u) => window.__soundhoodShare(u), B_LINK)).toBe(true);
    await expect(where(page).getByRole("combobox", { name: "Playlists" })).toHaveText("None");
    await where(page).getByRole("button", { name: "Download", exact: true }).tap();
    await expect.poll(() => ipcCount(page, "downloads")).toBe(2);
    await page.waitForTimeout(450);
    await retry.tap();
    await page.waitForTimeout(400);
    expect(await ipcCount(page, "downloads"), "no second download").toBe(2);
    await expect(toast(page, "Not retried: a download is running")).toBeVisible();
    await openPhoneSettings(app, page);
    await expect(sheet(page).locator(".ErrorRow")).toContainText("Queue stopped");
    const undo = settingRow(page, "Undo last change").getByRole("button", { name: "Undo" });
    await expect(undo).toBeDisabled();
    // B ends with its file, filed into no playlist; then Undo is free again.
    await page.evaluate((file) => {
      const m = window.__soundhoodMock;
      m.phoneDownload = { exitCode: 0, files: [file], log: "" };
      m.finishPhoneDownload();
    }, app.data.tracks[1].path);
    await expect(undo).toBeEnabled({ timeout: 5000 });
    expect(await journalLabels(page), "B's song never lands in A's playlist").toEqual(["Added 1 track to Empty"]);
    await expect(sheet(page).locator(".ErrorRow")).toContainText("Queue stopped");
  });

  test("a settings store that cannot be read: the downloader is off, the toast says so, a shared link opens nothing", async ({ app, page }) => {
    await beforeLoad(page, () => {
      const m = window.__soundhoodMock;
      m.store.set("downloader_enabled", true);
      // One read fails (an unreadable store file): startup's catch runs before the switch is read.
      const get = m.store.get.bind(m.store);
      const has = m.store.has.bind(m.store);
      window.__failedReads = 0;
      m.store.get = (k) => {
        if (k === "text_scale") {
          window.__failedReads++;
          throw new Error("store unreadable");
        }
        return get(k);
      };
      m.store.has = (k) => k === "text_scale" || has(k);
    });
    await page.goto("/");
    // In plain words, what could not be read and what that means; the raw error only in the log.
    // Once: startup runs once, even where the dev server's StrictMode runs its effect twice, and the
    // notice carries a key, so a second one would stand for the first.
    const unreadable = page.locator(".Toast").filter({ hasText: "The settings (music folder and downloader) could not be read" });
    await expect(unreadable).toHaveCount(1);
    await page.waitForTimeout(500);
    await expect(unreadable, "one toast, never two of the same").toHaveCount(1);
    expect(await page.evaluate(() => window.__failedReads), "startup read the settings once").toBe(1);
    await expect(unreadable).toHaveText(
      "The settings (music folder and downloader) could not be read, so no library is open and the downloader is off until you turn it on. Choose the folder in Settings.",
    );
    await expect(unreadable).not.toContainText("store unreadable");
    await expect(page.getByText("No library yet")).toBeVisible();
    expect(await page.evaluate(() => window.__soundhoodShare("https://youtu.be/AbCdEfGhIjK"))).toBe(false);
    await expect(toast(page, "The downloader is off. Turn it on in Settings, under YouTube.")).toBeVisible();
    await expect(where(page)).toHaveCount(0);
    await openSettings(app, page);
    const youtube = settingRow(page, "Downloader");
    await expect(youtube).toContainText("the settings could not be read (see the log)");
    await expect(sheet(page).getByRole("switch", { name: "Downloader" })).toHaveAttribute("aria-checked", "false");
    // The log keeps the reason behind the plain sentence.
    await expect(status(page)).toContainText("store unreadable");
    expect(await ipcCount(page, "downloads")).toBe(0);
  });

  test("the download helper's Update and Network check show only once the stored switch is read, and only while it is on", async ({ app, page }) => {
    const helperButtons = () => sheet(page).getByRole("button").filter({ hasText: /^(Update|Check)$/ });
    const net = () => page.evaluate(() => window.__soundhoodIpc.calls.filter((c) => /soundhood-ytdl\|(ytdlp_update|netcheck)$/.test(c)));
    // Stored off, read slowly: Settings opens once the platform is known, before the switch is read.
    await beforeLoad(page, () => {
      const m = window.__soundhoodMock;
      m.store.set("downloader_enabled", false);
      m.store.set("onboarding_done", true);
      m.delay["plugin:store|get"] = 400;
      window.__switchRead = false;
      const get = m.store.get.bind(m.store);
      m.store.get = (k) => {
        if (k === "downloader_enabled") window.__switchRead = true;
        return get(k);
      };
    });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => window.__soundhoodIpc.calls.includes("platform")), { timeout: 15_000 }).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().tap();
    await expect(sheet(page)).toBeVisible();
    expect(await page.evaluate(() => window.__switchRead), "the stored switch is not read yet").toBe(false);
    await expect(sheet(page).getByRole("switch", { name: "Downloader" })).toBeVisible();
    expect(await helperButtons().count(), "nothing of the helper to tap before the switch is known").toBe(0);
    await app.settled("list_playlists");
    // Read: off, so still nothing; nothing reached the network.
    await expect(sheet(page).getByRole("switch", { name: "Downloader" })).toHaveAttribute("aria-checked", "false");
    expect(await helperButtons().count()).toBe(0);
    expect(await net()).toEqual([]);
    // Turned on: Update and Check are there.
    await sheet(page).getByRole("switch", { name: "Downloader" }).tap();
    await expect(helperButtons()).toHaveText(["Update", "Check"]);
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
    await openPhoneSettings(app, page);
    await sheet(page).getByRole("button", { name: "Download queue (2)" }).tap();
    await expect(toast(page, "Queue stopped: [youtube] aaaaaaaaaaa: Sign in to confirm you're not a bot")).toBeVisible();
    await expect(sheet(page).locator(".ErrorRow")).toContainText("Queue stopped");
    await page.waitForTimeout(1000);
    expect(await ipcCount(page, "downloads")).toBe(1);
    await expect(sheet(page).getByRole("button", { name: "Download queue (2)" })).toBeVisible();
  });

  test("a shared link: Where should this go?, Download, then the download's toast with Cancel", async ({ app, page }) => {
    await beforeLoad(page, () => (window.__soundhoodMock.holdPhoneDownload = true));
    await app.open();
    expect(await page.evaluate(() => window.__soundhoodShare("https://youtu.be/AbCdEfGhIjK"))).toBe(true);
    await expect(where(page)).toBeVisible();
    await where(page).getByRole("button", { name: "Download", exact: true }).tap();
    await expect(where(page)).toHaveCount(0);
    // On the phone the link is queued first, as before, and leaves the queue once downloaded.
    expect((await storeOf(page)).share_queue).toMatchObject([{ url: "https://youtu.be/AbCdEfGhIjK", target: "Downloads" }]);
    const running = toast(page, "Downloading");
    await expect(running).toBeVisible();
    await running.getByRole("button", { name: "Cancel" }).tap();
    await expect.poll(() => ipcCount(page, "cancels")).toBe(1);
    await expect(toast(page, "Cancelling the download")).toBeVisible();
    await page.evaluate(() => window.__soundhoodMock.finishPhoneDownload());
    await expect(page.locator(".Toast").filter({ hasText: /^Downloading/ })).toHaveCount(0);
    await expect.poll(async () => (await storeOf(page)).share_queue).toEqual([]);
  });
});
