// First-launch setup on the mocked UI: a new install sees three skippable steps once (Library,
// Online lookups, YouTube helper) and the downloader stays off until it is turned on; an existing
// install (anything in the settings store) keeps working exactly as before: no setup, the downloader
// on; one with no folder is asked for the folder alone. Photographed at every size (the first step).
// A link shared into the phone before startup has read the stored downloader switch waits for it,
// then goes the way the stored switch says.
import { expect, test } from "./harness.mjs";
import { openSettings, settle } from "./ui.mjs";

/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
const setup = (page) => page.locator(".Onboarding");
const downloadItem = (page) => page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Download" });
const toast = (page, text) => page.locator(".Toast").filter({ hasText: text }).last();
const where = (page) => page.getByRole("dialog", { name: "Where should this go?" });

/**
 * A cold start with a link shared into the app, with the downloader stored `on` or off.
 * MainActivity hands the link over as soon as window.__soundhoodShare exists (it retries until
 * then). Here it is handed over the moment the app defines it, from a setter, which is always
 * before startup has read the stored switch: the app defines it in its first effects, where the
 * store reads only start. (A timer that polled for it raced startup and lost about one run in
 * seven under load.) window.__shared holds what the hand-over returned.
 */
async function coldShare(page, on) {
  await beforeLoad(
    page,
    (enabled) => {
      const m = window.__soundhoodMock;
      m.store.set("downloader_enabled", enabled);
      m.store.set("onboarding_done", true);
      window.__shared = [];
      let share;
      Object.defineProperty(window, "__soundhoodShare", {
        configurable: true,
        get: () => share,
        set(fn) {
          share = fn;
          if (typeof fn !== "function" || window.__shared.length > 0) return;
          window.__shared.push(fn("https://www.youtube.com/watch?v=AbCdEfGhIjK"));
        },
      });
    },
    on,
  );
}

/** A new install: nothing in the settings store; the folder picker answers `pick`. */
async function newInstall(app, page) {
  await beforeLoad(page, () => {
    const m = window.__soundhoodMock;
    m.store.clear();
    m.pickFolder = window.__SOUNDHOOD_FIXTURE__.root;
  });
  await app.open({ until: "platform" });
}

test.describe("both layouts", { tag: ["@desktop", "@phone"] }, () => {
  test("onboarding", async ({ app, page }) => {
    await newInstall(app, page);
    await expect(setup(page)).toContainText("Step 1 of 3");
    await expect(setup(page).getByRole("heading")).toHaveText("Where is your music?");
    await expect(setup(page).getByRole("button", { name: "Next" })).toBeDisabled();
    await settle(app, page);
    await expect(page).toHaveScreenshot(app.shot("onboarding"));
  });

  test("an existing install is asked nothing and keeps downloading", async ({ app, page }) => {
    await app.open();
    await expect(setup(page)).toHaveCount(0);
    await expect.poll(async () => await storeOf(page)).toMatchObject({ onboarding_done: true, downloader_enabled: true });
    await openSettings(app, page);
    await expect(page.locator(".SettingsSheet").getByRole("switch", { name: "Downloader" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".SettingsSheet").getByRole("textbox", { name: "Link" })).toBeVisible();
  });
});

test.describe("desktop layout (platform windows)", { tag: "@desktop" }, () => {
  test("a new install: three steps once; the downloader stays off and its controls hidden", async ({ app, page }) => {
    await newInstall(app, page);
    await setup(page).getByRole("button", { name: "Choose folder" }).click();
    await expect(setup(page).locator(".Onboarding-progress")).toHaveText(`50 songs in ${app.data.root}`);
    await setup(page).getByRole("button", { name: "Next" }).click();

    await expect(setup(page)).toContainText("Step 2 of 3");
    await expect(setup(page).getByRole("heading")).toHaveText("Online lookups");
    await expect(setup(page)).toContainText("Nothing is sent anywhere while this is off.");
    await expect(setup(page).getByRole("switch", { name: "Online lookups" })).toHaveAttribute("aria-checked", "false");
    await setup(page).getByRole("button", { name: "Next" }).click();

    await expect(setup(page)).toContainText("Step 3 of 3");
    await expect(setup(page).getByRole("switch", { name: "Enable downloader" })).toHaveAttribute("aria-checked", "false");
    await expect(setup(page).getByRole("switch", { name: "Keep download helper updated" })).toHaveAttribute("aria-checked", "false");
    await setup(page).getByRole("button", { name: "Done" }).click();
    await expect(setup(page)).toHaveCount(0);

    expect(await storeOf(page)).toMatchObject({
      library_dir: app.data.root,
      onboarding_done: true,
      downloader_enabled: false,
      online_lookups: false,
      helper_auto_update: false,
    });
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    await expect(downloadItem(page)).toHaveCount(0);
    await openSettings(app, page);
    await expect(page.locator(".SettingsSheet").getByRole("textbox", { name: "Link" })).toHaveCount(0);
  });

  test("a new install that enables the downloader and skips the rest", async ({ app, page }) => {
    await newInstall(app, page);
    await setup(page).getByRole("button", { name: "Skip" }).click();
    await setup(page).getByRole("button", { name: "Skip" }).click();
    await setup(page).getByRole("switch", { name: "Enable downloader" }).click();
    await setup(page).getByRole("switch", { name: "Keep download helper updated" }).click();
    await setup(page).getByRole("button", { name: "Done" }).click();
    await expect(setup(page)).toHaveCount(0);
    expect(await storeOf(page)).toMatchObject({ onboarding_done: true, downloader_enabled: true, helper_auto_update: true, online_lookups: false });
    expect((await storeOf(page)).library_dir).toBeUndefined();
    await expect(downloadItem(page)).toHaveCount(1);
  });

  test("while the setup is up no shortcut reaches behind it: Ctrl+comma, Ctrl+K, / and a pasted link do nothing", async ({ app, page }) => {
    // An earlier install with no folder: the Library step alone, with the downloader on, so a pasted
    // link would otherwise open "Where should this go?".
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("volume", 0.8);
    });
    await app.open({ until: "platform" });
    await expect(setup(page)).toContainText("Step 1 of 1");
    const choose = setup(page).getByRole("button", { name: "Choose folder" });
    await choose.focus();
    const inSetup = () => page.evaluate(() => !!document.activeElement?.closest(".Onboarding"));
    for (const key of ["Control+Comma", "Control+k", "/"]) {
      await page.keyboard.press(key);
      await expect(page.locator(".SettingsSheet"), `${key} opens no Settings under the setup`).toHaveCount(0);
      expect(await inSetup(), `${key} leaves the focus in the setup`).toBe(true);
    }
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://www.youtube.com/watch?v=AbCdEfGhIjK");
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(300);
    await expect(where(page), "a pasted link opens no sheet under the setup").toHaveCount(0);
    expect(await inSetup()).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("a phone that ran before without a folder: the Library step alone, the standard Music folder offered", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("volume", 0.8);
    });
    await app.open({ until: "platform" });
    await expect(setup(page)).toContainText("Step 1 of 1");
    const path = setup(page).getByRole("textbox", { name: "Music folder path" });
    await expect(path).toHaveValue("/storage/emulated/0/Music");
    await path.fill(app.data.root);
    await setup(page).getByRole("button", { name: "Use" }).tap();
    await expect(setup(page).locator(".Onboarding-progress")).toHaveText(`50 songs in ${app.data.root}`);
    await setup(page).getByRole("button", { name: "Done" }).tap();
    await expect(setup(page)).toHaveCount(0);
    expect(await storeOf(page)).toMatchObject({ library_dir: app.data.root, onboarding_done: true, downloader_enabled: true });
  });

  test("a link shared before startup read the settings, with the downloader stored off: not taken", async ({ app, page }) => {
    await coldShare(page, false);
    await app.open();
    expect(await page.evaluate(() => window.__shared)).toEqual([true]);
    await page.waitForTimeout(500);
    await expect(where(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__soundhoodMock.downloads.length)).toBe(0);
    expect((await storeOf(page)).downloader_enabled).toBe(false);
    await expect(toast(page, "The downloader is off. Turn it on in Settings, under YouTube.")).toBeVisible();
  });

  test("a link shared before startup read the settings, with the downloader stored on: the sheet", async ({ app, page }) => {
    await coldShare(page, true);
    await app.open();
    expect(await page.evaluate(() => window.__shared)).toEqual([true]);
    await expect(where(page)).toBeVisible();
    await expect(where(page).getByRole("textbox", { name: "Link" })).toHaveValue("https://www.youtube.com/watch?v=AbCdEfGhIjK");
  });
});
