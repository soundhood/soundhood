// First-launch setup on the mocked UI: a new install sees three skippable steps once (Library,
// Online lookups, YouTube helper) and the downloader stays off until it is turned on; an existing
// install (anything in the settings store) keeps working exactly as before: no setup, the downloader
// on; one with no folder is asked for the folder alone. Photographed at every size (the first step).
import { expect, test } from "./harness.mjs";
import { openSettings, settle } from "./ui.mjs";

/** Changes the mock before the app's first script runs. */
const beforeLoad = (page, fn, arg) => page.addInitScript(fn, arg);
const storeOf = (page) => page.evaluate(() => Object.fromEntries(window.__soundhoodMock.store));
const setup = (page) => page.locator(".Onboarding");
const downloadItem = (page) => page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Download" });

/** A new install: nothing in the settings store; the folder picker answers `pick`. */
async function newInstall(app, page) {
  await beforeLoad(page, () => {
    const m = window.__soundhoodMock;
    m.store.clear();
    m.pickFolder = window.__SOUNDHOOD_FIXTURE__.root;
  });
  await page.goto("/");
  await app.settled("platform");
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
});

test.describe("phone layout (platform android)", { tag: "@phone" }, () => {
  test("a phone that ran before without a folder: the Library step alone, the standard Music folder offered", async ({ app, page }) => {
    await beforeLoad(page, () => {
      window.__soundhoodMock.store.delete("library_dir");
      window.__soundhoodMock.store.set("volume", 0.8);
    });
    await page.goto("/");
    await app.settled("platform");
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
});
