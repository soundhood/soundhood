// Dialogs over dialogs (docs/DESIGN.md, Modal / Sheet): one opened from another goes on top with its
// own backdrop, so only the newest reads as open, whatever order the overlays slot mounts them in;
// the focus is in it, and when it closes the focus goes back to what opened it or, when that can no
// longer take it (Settings' Add once its link is taken), to the sheet below. Checked for every pair
// the app has: Settings with "Where should this go?", the log and the links waiting; the queue sheet
// with New playlist (Save as playlist) and "Clear the queue?" (Ctrl+L). The pairs are drawn at the
// phone (390x844), the tablet (834x1194) and the smallest PC window (760x520), where the queue is a
// sheet too; "Where should this go?" over Settings also at the desktop sizes.
import { expect, test } from "./harness.mjs";
import { goTo, openPlaylist, openSettings, playSong } from "./ui.mjs";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** What is drawn on top at the centre of `locator`: inside which dialog, or a backdrop. */
const topAt = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      backdrop: !!hit?.classList.contains("Backdrop"),
      dialog: hit?.closest('[role="dialog"]')?.querySelector("h2")?.textContent ?? null,
    };
  });

/** The title of the dialog the focus is in, or null when it is not in one. */
const focusIn = (page) => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.querySelector("h2")?.textContent ?? null);

const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
const title = (page, name) => dialog(page, name).getByRole("heading", { name, exact: true, level: 2 });

/** Every sheet and backdrop has finished coming in (a phone sheet starts below the screen). */
const still = (page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.target instanceof Element && a.effect.target.matches(".Sheet, .Backdrop"))
        .map((a) => a.finished.catch(() => {})),
    ),
  );

/**
 * `name` is the dialog on top: its title is what is drawn at the title's centre and the focus is in
 * it; `below`, still open, shows nothing of its own at its title any more (a backdrop covers it).
 */
async function expectOnTop(page, name, below) {
  await expect(dialog(page, name)).toBeVisible();
  await still(page);
  expect(await topAt(title(page, name)), `"${name}" is drawn on top`).toEqual({ backdrop: false, dialog: name });
  expect(await focusIn(page), `the focus is in "${name}"`).toBe(name);
  if (below) {
    await expect(dialog(page, below)).toBeAttached();
    expect((await topAt(title(page, below))).dialog, `"${below}" is under "${name}"`).not.toBe(below);
  }
}

/** The queue sheet over Late Night, Lunar Comets playing (the rest of the list is upcoming). */
async function queueSheet(app, page) {
  await app.open();
  await openPlaylist(page, "Late Night");
  await playSong(app, page, "Lunar Comets");
  await page.getByRole("button", { name: "Queue", exact: true }).filter({ visible: true }).first().click();
  await expectOnTop(page, "Queue");
}

/**
 * The phone and the tablet projects as they are; the 1280x800 project at 760x520, the smallest PC
 * window (Settings at 760 wide, the queue a sheet there). The 1920x1080 project has nothing to add.
 */
async function smallSizes(page, testInfo) {
  if (!testInfo.project.name.startsWith("desktop-")) return;
  test.skip(testInfo.project.name !== "desktop-1280x800", "760x520 once, from the 1280x800 project");
  await page.setViewportSize({ width: 760, height: 520 });
}

test.describe("every layout", { tag: ["@desktop", "@phone"] }, () => {
  for (const close of ["Cancel", "Escape"]) {
    test(`"Where should this go?" over Settings; closed with ${close}, the focus goes back to Settings although Add is disabled`, async ({ app, page }) => {
      await app.open();
      await goTo(page, "Folders");
      await openSettings(app, page);
      const settings = dialog(page, "Settings");
      expect(await topAt(title(page, "Settings"))).toEqual({ backdrop: false, dialog: "Settings" });

      await settings.getByRole("textbox", { name: "Link" }).fill(VIDEO);
      await settings.getByRole("button", { name: "Add", exact: true }).click();
      const where = dialog(page, "Where should this go?");
      // Settings stays open underneath, but nothing of it is on top any more: the new backdrop is.
      await expectOnTop(page, "Where should this go?", "Settings");
      for (const control of [title(page, "Settings"), settings.getByRole("button", { name: "Close", exact: true })]) {
        const top = await topAt(control);
        expect(top.backdrop || top.dialog === "Where should this go?", "the newest backdrop or dialog covers Settings").toBe(true);
      }

      // Closing it brings Settings back on top, with the focus in it: Add, which opened it, is
      // disabled now that the link is taken, so the focus goes to the Settings sheet itself.
      if (close === "Cancel") await where.getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      await expect(where).toHaveCount(0);
      await expect(settings.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
      await expectOnTop(page, "Settings");
      // Tab walks Settings, not the page behind it; Esc closes Settings next.
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        expect(await focusIn(page), `Tab ${i + 1} stays in Settings`).toBe("Settings");
      }
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
    });
  }
});

test.describe("phone, tablet and the smallest PC window", { tag: ["@desktop", "@phone"] }, () => {
  test.beforeEach(async ({ page }, testInfo) => smallSizes(page, testInfo));

  test('Settings, then Add: "Where should this go?" on top; closed, Settings on top', async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    await dialog(page, "Settings").getByRole("textbox", { name: "Link" }).fill(VIDEO);
    await dialog(page, "Settings").getByRole("button", { name: "Add", exact: true }).click();
    await expectOnTop(page, "Where should this go?", "Settings");
    await dialog(page, "Where should this go?").getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page, "Where should this go?")).toHaveCount(0);
    await expectOnTop(page, "Settings");
  });

  test("Settings, then View log: the log on top; closed, Settings on top with the focus on View log", async ({ app, page }) => {
    await app.open();
    await openSettings(app, page);
    const viewLog = dialog(page, "Settings").locator(".LogRow");
    await viewLog.click();
    await expectOnTop(page, "Log", "Settings");
    await dialog(page, "Log").getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog(page, "Log")).toHaveCount(0);
    await expectOnTop(page, "Settings");
    await expect(viewLog).toBeFocused();
  });

  test("Settings, then Links waiting: the links on top; closed, Settings on top", async ({ app, page }) => {
    await page.addInitScript((url) => window.__soundhoodMock.store.set("share_queue", [{ url, added: 1 }]), VIDEO);
    await app.open();
    await openSettings(app, page);
    await dialog(page, "Settings").locator(".SettingRow", { hasText: "Links waiting" }).click();
    await expectOnTop(page, "Links waiting", "Settings");
    await dialog(page, "Links waiting").getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(dialog(page, "Links waiting")).toHaveCount(0);
    await expectOnTop(page, "Settings");
  });

  test("the queue sheet, then Save as playlist: New playlist on top, typing into its own field", async ({ app, page }) => {
    await queueSheet(app, page);
    const save = dialog(page, "Queue").getByRole("button", { name: "Save as playlist" });
    await save.click();
    await expectOnTop(page, "New playlist", "Queue");
    const name = dialog(page, "New playlist").getByRole("textbox", { name: "Playlist name" });
    await expect(name).toBeFocused();
    expect((await topAt(name)).dialog, "the name field is the one on screen").toBe("New playlist");

    await dialog(page, "New playlist").getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page, "New playlist")).toHaveCount(0);
    await expectOnTop(page, "Queue");
    await expect(save).toBeFocused();
  });

  test('the queue sheet, then Ctrl+L: "Clear the queue?" on top; Cancel, the queue on top', async ({ app, page }) => {
    await queueSheet(app, page);
    await page.keyboard.press("Control+l");
    await expectOnTop(page, "Clear the queue?", "Queue");
    await dialog(page, "Clear the queue?").getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page, "Clear the queue?")).toHaveCount(0);
    await expectOnTop(page, "Queue");
  });
});
