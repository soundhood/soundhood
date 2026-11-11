// The layer rule for everything that floats (docs/DESIGN.md, Layers; Sheet.tsx topLayer): an open
// Dropdown list or menu is a layer, like a sheet. While one is open no key heard on the window acts
// behind it (Ctrl+K, "/", 1 to 4, Ctrl+A, the list keys, Q, Ctrl+L); Esc closes it first, and only
// it; a sheet that opens by any path (Ctrl+comma, a pasted link, a link shared to the phone, a
// button) closes it first, so it is never drawn over the newer sheet. Where the focus goes when it or
// that sheet closes is the one rule: back on the control that opened the list or menu when the
// keyboard opened it (Ctrl+comma, Ctrl+V), on where the screen or the sheet starts when a pointer
// did (a click on the list, the Settings button; a share after a click). A link shared to the phone while the
// first-launch setup is up waits until the setup closes, then opens "Where should this go?" with the
// focus in it. Checked at 390x844, 834x1194 and 1280x800 with the Sort list and a song's row menu.
import { expect, test } from "./harness.mjs";
import { openPlaylist, openSettings, playSong, row } from "./ui.mjs";

const VIDEO = "https://www.youtube.com/watch?v=AbCdEfGhIjK";
/** The keys heard on the window that act on a screen. */
const KEYS = ["Control+k", "/", "1", "2", "3", "4", "Control+a", "a", "Shift+A", "Delete", "x", "Control+e", "Control+s", "q", "Control+l"];

const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
const floating = (page) => page.locator(".Popover").filter({ visible: true });
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** What a key acting behind the list or menu would change. */
const behind = (page) =>
  page.evaluate(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0);
    const search = shown(".SearchField input")[0];
    return {
      screen: shown(".ScreenHeader h1").map((h) => h.textContent).join("|"),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.querySelector("h2")?.textContent ?? d.getAttribute("aria-label")).join(" > "),
      selected: shown(".Shell-main .TrackRow.is-selected").length,
      rows: shown(".Shell-main .TrackRow").length,
      queuePane: shown(".RightPane").length,
      toasts: [...document.querySelectorAll(".Toast > span")].map((t) => t.textContent).join(" / "),
      search: search ? `"${search.value}"${search === document.activeElement ? " focused" : ""}` : "",
    };
  });

/** "popup" while the focus is in the open list or menu or on the control that opened it. */
const focusAt = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el?.closest(".Popover") || el?.getAttribute("aria-expanded") === "true") return "popup";
    return el && el !== document.body ? `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30)}` : "the page";
  });

/** The title of the dialog the focus is in, or null. */
const focusIn = (page) => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.querySelector("h2")?.textContent ?? null);

const sortButton = (page) => page.getByRole("combobox", { name: "Sort" }).filter({ visible: true });
/** The screen's heading, where the focus goes when what a pointer opened closes. */
const screenHeading = (page) => page.locator('.Shell-main :is(h1, h2)[tabindex="-1"]').filter({ visible: true }).first();
const moreButton = (page) => row(page, "Paper Bloom").getByRole("button", { name: "More for Paper Bloom" });

const POPUPS = {
  "the Sort list": {
    anchor: sortButton,
    async open(page) {
      await sortButton(page).click();
      await expect(page.getByRole("listbox", { name: "Sort" })).toBeVisible();
    },
    async openByKey(page) {
      await sortButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("listbox", { name: "Sort" })).toBeVisible();
    },
  },
  "a row menu": {
    // Its focus goes back to the row (docs/DESIGN.md, Row menu).
    anchor: (page) => row(page, "Paper Bloom"),
    async open(page) {
      await moreButton(page).click();
      await expect(page.getByRole("menu", { name: "More for Paper Bloom" })).toBeVisible();
    },
    async openByKey(page) {
      await row(page, "Paper Bloom").focus();
      await page.keyboard.press("Shift+F10");
      await expect(page.getByRole("menu", { name: "More for Paper Bloom" })).toBeVisible();
    },
  },
};

/** A link pasted (Ctrl+V) where the focus is: the key's press, then the paste it makes. */
const paste = (page) =>
  page.evaluate((url) => {
    const at = document.activeElement ?? document.body;
    at.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true }));
    const data = new DataTransfer();
    data.setData("text/plain", url);
    at.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, VIDEO);

/**
 * Every way a sheet opens, the list or menu opened with a pointer before it: [what, how, the sheet
 * it opens, where the focus is once it closes]. Opened with a key, back on the list's or menu's
 * control; with a pointer, or by a share after a pointer opened the list, where the screen starts.
 */
const OPENERS = [
  ["Ctrl+comma", (page) => page.keyboard.press("Control+Comma"), "Settings", "control"],
  ["a pasted link", paste, "Where should this go?", "control"],
  ["a link shared to the phone", (page) => page.evaluate((url) => window.__soundhoodShare(url), VIDEO), "Where should this go?", "heading"],
  ["the Settings button", (page) => page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().click(), "Settings", "heading"],
];

function sizes(testInfo) {
  test.skip(testInfo.project.name === "desktop-1920x1080", "390, 834 and 1280 wide cover the three layouts");
}

/** Late Night open with Lunar Comets playing (a queue for Q, Ctrl+L and the Playing tab); on a PC also Paper Bloom chosen. */
async function start(app, page, testInfo) {
  await page.addInitScript(() => window.__soundhoodMock.store.set("downloader_enabled", true));
  await app.open();
  await openPlaylist(page, "Late Night");
  await playSong(app, page, "Lunar Comets");
  if (testInfo.project.name.startsWith("desktop")) {
    await row(page, "Paper Bloom").click({ modifiers: ["Control"] });
    await expect(row(page, "Paper Bloom")).toHaveClass(/is-selected/);
  }
}

for (const [name, popup] of Object.entries(POPUPS)) {
  test.describe(`${name} open`, { tag: ["@desktop", "@phone"] }, () => {
    test("no key heard on the window acts behind it; Esc closes it first, and only it", async ({ app, page }, testInfo) => {
      sizes(testInfo);
      await start(app, page, testInfo);
      await popup.open(page);
      const before = await behind(page);
      for (const key of KEYS) {
        await page.keyboard.press(key);
        await frame(page);
        expect(await behind(page), `${key} acts on nothing behind ${name}`).toEqual(before);
        await expect(floating(page), `${key} leaves ${name} open`).toHaveCount(1);
        expect(await focusAt(page), `${key} leaves the focus with ${name}`).toBe("popup");
      }
      await page.keyboard.press("Escape");
      await expect(floating(page)).toHaveCount(0);
      expect(await behind(page), "Esc closed the list or menu and nothing else").toEqual(before);
      // Opened with a pointer: the focus is where the screen starts, never on its control.
      await expect(screenHeading(page), "opened with a pointer: the screen's heading").toBeFocused();
      // Opened with the keyboard: back on its control.
      await popup.openByKey(page);
      await page.keyboard.press("Escape");
      await expect(floating(page)).toHaveCount(0);
      await expect(popup.anchor(page), "opened with the keyboard: its control").toBeFocused();
    });

    test("a sheet opened by any path closes it first: nothing floats over the sheet, and the focus comes back", async ({ app, page }, testInfo) => {
      sizes(testInfo);
      await start(app, page, testInfo);
      for (const [path, open, sheet, back] of OPENERS) {
        await popup.open(page);
        await open(page);
        await expect(dialog(page, sheet), `${path} opens ${sheet}`).toBeVisible();
        await expect(floating(page), `${path}: ${name} closed before ${sheet} opened`).toHaveCount(0);
        await expect.poll(() => focusIn(page), `${path}: the focus is in ${sheet}`).toBe(sheet);
        await page.keyboard.press("Escape");
        await expect(dialog(page, sheet)).toHaveCount(0);
        if (back === "control") await expect(popup.anchor(page), `${path}: ${sheet} closed, the focus is back where ${name} opened`).toBeFocused();
        else await expect(screenHeading(page), `${path}: ${sheet} closed, the focus is on the screen's heading`).toBeFocused();
      }
    });
  });
}

test.describe("a list inside a sheet", { tag: ["@desktop", "@phone"] }, () => {
  test("a newer sheet closes it first; Esc closes the list before its sheet", async ({ app, page }, testInfo) => {
    sizes(testInfo);
    await page.addInitScript(() => window.__soundhoodMock.store.set("downloader_enabled", true));
    await app.open();
    await openSettings(app, page);
    const textSize = dialog(page, "Settings").getByRole("combobox", { name: "Text size" });
    await textSize.click();
    await expect(page.getByRole("listbox", { name: "Text size" })).toBeVisible();
    for (const key of ["Control+k", "/"]) {
      await page.keyboard.press(key);
      expect(await focusAt(page), `${key} leaves the focus with the list`).toBe("popup");
    }
    await paste(page);
    await expect(dialog(page, "Where should this go?")).toBeVisible();
    await expect(floating(page), "the Text size list closed under the new sheet").toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Where should this go?")).toHaveCount(0);
    await expect(textSize, "back on Text size").toBeFocused();

    await textSize.click();
    await expect(floating(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(floating(page), "Esc closed the list").toHaveCount(0);
    await expect(dialog(page, "Settings"), "and not Settings").toBeVisible();
    // Opened with a pointer: the focus is on Settings itself, where the sheet starts.
    await expect(dialog(page, "Settings")).toBeFocused();
    // Opened with the keyboard: back on Text size.
    await textSize.focus();
    await page.keyboard.press("Enter");
    await expect(floating(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(floating(page)).toHaveCount(0);
    await expect(textSize).toBeFocused();
  });
});

/** An earlier install with no music folder: the setup shows its Library step alone, the downloader is on. */
const earlierInstall = (page) =>
  page.addInitScript(() => {
    const m = window.__soundhoodMock;
    m.store.delete("library_dir");
    m.store.set("volume", 0.8);
    m.store.set("downloader_enabled", true);
  });
const setup = (page) => page.getByRole("dialog", { name: "Set up Soundhood" });
const inSetup = (page) => page.evaluate(() => !!document.activeElement?.closest(".Onboarding"));

test.describe("a link shared while the first-launch setup is up", { tag: "@phone" }, () => {
  test('waits, then opens "Where should this go?" on top with the focus in it once the setup closes', async ({ app, page }) => {
    await earlierInstall(page);
    await app.open({ until: "platform" });
    await expect(setup(page)).toBeVisible();
    expect(await page.evaluate((url) => window.__soundhoodShare(url), VIDEO), "the link is taken").toBe(true);
    await page.waitForTimeout(300);
    await expect(dialog(page, "Where should this go?"), "nothing opens under the setup").toHaveCount(0);
    expect(await inSetup(page), "the focus stays in the setup").toBe(true);
    await setup(page).getByRole("button", { name: "Skip" }).click();
    await expect(setup(page)).toHaveCount(0);
    await expect(dialog(page, "Where should this go?")).toBeVisible();
    await expect.poll(() => focusIn(page)).toBe("Where should this go?");
    await expect(dialog(page, "Where should this go?").getByRole("textbox", { name: "Link" })).toHaveValue(VIDEO);
  });

  test("a cold start with a shared link waits for the setup as well as for the stored settings", async ({ app, page }) => {
    await earlierInstall(page);
    // Handed over the moment the app defines it, as MainActivity does (onboarding.spec.mjs, coldShare).
    await page.addInitScript((url) => {
      window.__shared = [];
      let share;
      Object.defineProperty(window, "__soundhoodShare", {
        configurable: true,
        get: () => share,
        set(fn) {
          share = fn;
          if (typeof fn === "function" && window.__shared.length === 0) window.__shared.push(fn(url));
        },
      });
    }, VIDEO);
    await app.open({ until: "platform" });
    await expect(setup(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__shared)).toEqual([true]);
    await expect(dialog(page, "Where should this go?"), "nothing opened under the setup").toHaveCount(0);
    expect(await inSetup(page)).toBe(true);
    await setup(page).getByRole("button", { name: "Skip" }).click();
    await expect(dialog(page, "Where should this go?")).toBeVisible();
    await expect.poll(() => focusIn(page)).toBe("Where should this go?");
  });
});
