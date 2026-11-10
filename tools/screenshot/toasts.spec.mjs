// What the user causes, a toast says, every time (docs/DESIGN.md, Toasts): no toast is merged with
// another because the words are the same. Pressing A twice queues the song twice and shows two
// confirmations; A, B, C, then A again within two seconds shows that last A as the newest toast, at
// the bottom, where it is drawn. Only a notice that asks for it with a key stands for an earlier one
// of the same key (the unreadable settings at startup: ingest.spec.mjs), and then it moves to the
// newest place too.
//
// The stack holds two: at most two toasts exist, a third pushes the oldest out (gone with its timer,
// never shown later), and each toast's 4 s run from when it is shown. Every action (Undo, Cancel,
// Retry) ignores presses for 400 ms after its own toast came, moved or changed its action, so a
// double click or tap aimed at one never presses the one that came or slid under it; one whose
// toast did not change takes a press at once, whatever the other toast does. A toast leaves before
// its action runs: an Undo refused while another undo runs comes back without pushing the other
// toast out, the rest of a double click on it reaches nothing behind it, and the focus it had goes
// to the sheet on top or the screen's heading, never to the page.
import { expect, test } from "./harness.mjs";
import { openPlaylist, openSettings, playSong, row, settingRow } from "./ui.mjs";

const VIDEO = "https://www.youtube.com/watch?v=AbCdEfGhIjK";

/** The words of the toasts drawn, top to bottom. */
const drawn = (page) => page.locator(".Toast > span").allTextContents();

/** The Undo of the toast holding `text`. */
const undoIn = (page, text) => page.locator(".Toast", { hasText: text }).getByRole("button", { name: "Undo" });

/**
 * Arms a press inside the page, so it lands in the same moment as a change of the stack: once a
 * toast holding `came` is drawn (or none holding `gone` is left), the button `label` of the toast
 * holding `text` is clicked at once, before the next frame. `pressed` reads what was drawn then
 * and the button's aria-disabled; null until it fired.
 */
const armPress = (page, spec) =>
  page.evaluate(({ text, label, came, gone }) => {
    window.__press = null;
    const toasts = () => [...document.querySelectorAll(".Toast")];
    const has = (t) => toasts().some((el) => el.textContent.includes(t));
    const watch = new MutationObserver(() => {
      if ((came && !has(came)) || (gone && has(gone))) return;
      const toast = toasts().find((el) => el.textContent.includes(text));
      const button = [...(toast?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
      if (!button) return;
      watch.disconnect();
      window.__press = { drawn: toasts().map((el) => el.querySelector("span").textContent), disabled: button.getAttribute("aria-disabled") };
      button.click();
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
  }, spec);
const pressed = (page) => page.evaluate(() => window.__press);

/** Every different list of toasts drawn, sampled every 150 ms for `ms`, in the order seen. */
async function watch(page, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await drawn(page);
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(now)) seen.push(now);
    await page.waitForTimeout(150);
  }
  return seen;
}

/** How often the page called `cmd`. */
const calls = (page, cmd) => page.evaluate((c) => window.__soundhoodIpc.calls.filter((x) => x === c).length, cmd);

test.describe("toasts the user caused", { tag: "@desktop" }, () => {
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the toasts are the same at every size");
    await app.open();
    await openPlaylist(page, "Late Night");
    await playSong(app, page, "Lunar Comets");
  });

  test("A pressed twice on a song queues it twice and says so twice", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("a");
    await expect(page.locator(".Toast")).toHaveCount(1);
    await page.waitForTimeout(400);
    await page.keyboard.press("a");
    await expect.poll(() => drawn(page)).toEqual(["Added Paper Bloom to the queue", "Added Paper Bloom to the queue"]);
  });

  test("A, B, C, then A again within 2 s: the last A is the newest toast, drawn at the bottom; nothing older comes back", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowDown");
    const next = (await page.evaluate(() => document.activeElement?.querySelector(".TrackRow-title > span:not(.Equaliser)")?.textContent)) ?? "";
    expect(next, "B is another song").not.toBe("Paper Bloom");
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(150);
    await expect.poll(() => drawn(page)).toEqual([`Added ${next} to the queue`, `${next} plays next`]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("a");
    await expect.poll(() => drawn(page)).toEqual([`${next} plays next`, "Added Paper Bloom to the queue"]);
    // The first A and B were pushed out: they never come back, and the two left go in their 4 s.
    const seen = await watch(page, 5500);
    for (const list of seen) {
      expect(list.length, JSON.stringify(seen)).toBeLessThanOrEqual(2);
      expect(list, `B never comes back: ${JSON.stringify(seen)}`).not.toContain(`Added ${next} to the queue`);
      expect(list.filter((t) => t === "Added Paper Bloom to the queue").length, JSON.stringify(seen)).toBeLessThanOrEqual(1);
    }
    expect(seen.at(-1), "gone 4 s after they were shown").toEqual([]);
  });

  test("A pressed eight times: two toasts at most, the newest shown its full 4 s, all gone after it", async ({ page }) => {
    await row(page, "Paper Bloom").focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("a");
      await page.waitForTimeout(60);
    }
    const shownAt = Date.now();
    await expect.poll(() => drawn(page)).toEqual(["Added Paper Bloom to the queue", "Added Paper Bloom to the queue"]);
    const early = await watch(page, 3000);
    for (const list of early) expect(list.length, JSON.stringify(early)).toBeLessThanOrEqual(2);
    expect(early.at(-1)?.length, "the newest is still shown 3 s after it came").toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(Math.max(0, shownAt + 4800 - Date.now()));
    expect(await watch(page, 1500), "none is waiting to be shown later").toEqual([[]]);
  });
});

test.describe("the toast stack", { tag: "@desktop" }, () => {
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the toasts are the same at every size");
    await app.open();
    await openPlaylist(page, "Late Night");
  });

  test("three removals with Delete: the first one's toast is pushed out and never comes back with its Undo", async ({ app, page }) => {
    for (const title of ["Amber Comets", "Static Comets", "Silver Garden"]) {
      await row(page, title).focus();
      await page.keyboard.press("Delete");
      await expect(row(page, title)).toHaveCount(0);
      await app.settled();
    }
    await expect.poll(() => drawn(page)).toEqual(["Removed Static Comets from Late Night", "Removed Silver Garden from Late Night"]);
    const seen = await watch(page, 5500);
    for (const list of seen) {
      expect(list.join(" | "), JSON.stringify(seen)).not.toContain("Amber Comets");
      expect(list.join(" | "), "no Undo of an older change answers after a newer one").not.toContain("Undo:");
    }
    expect(seen.at(-1)).toEqual([]);
    expect(await calls(page, "undo_batch")).toBe(0);
  });

  for (const [how, press] of [
    ["a double click", (button) => button.dblclick()],
    [
      "two clicks 250 ms apart at one point",
      async (button, page) => {
        const b = await button.boundingBox();
        await button.click();
        await page.waitForTimeout(250);
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      },
    ],
  ]) {
    test(`two Undo toasts, ${how} on the older one's Undo undoes only the older change`, async ({ app, page }) => {
      for (const title of ["Paper Bloom", "Quiet Bloom"]) {
        await row(page, title).focus();
        await page.keyboard.press("Delete");
        await expect(row(page, title)).toHaveCount(0);
        await app.settled();
      }
      await expect.poll(() => drawn(page)).toEqual(["Removed Paper Bloom from Late Night", "Removed Quiet Bloom from Late Night"]);
      const older = page.locator(".Toast", { hasText: "Removed Paper Bloom" }).getByRole("button", { name: "Undo" });
      await press(older, page);
      await page.waitForTimeout(600);
      await app.settled();
      expect(await calls(page, "undo_batch"), "one undo: the older toast's").toBe(1);
      // The playlist changed after the older remove, so the core leaves it (its toast says so); the
      // newer remove was never undone and its toast still offers its Undo.
      await expect(row(page, "Quiet Bloom")).toHaveCount(0);
      await expect(page.locator(".Toast", { hasText: "Removed Quiet Bloom" }).getByRole("button", { name: "Undo" })).toBeVisible();
      expect(await page.evaluate(() => window.__soundhoodMock.history.length), "both changes are still in the journal").toBe(2);
    });
  }

  test("an Undo toast that did not move takes a press at once, even as the toast above it leaves", async ({ app, page }) => {
    await row(page, "Paper Bloom").focus();
    await page.keyboard.press("a");
    await page.waitForTimeout(1000);
    await row(page, "Quiet Bloom").focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => drawn(page)).toEqual(["Added Paper Bloom to the queue", "Removed Quiet Bloom from Late Night"]);
    // Hovered, its clock stops; the toast above goes at its 4 s, and the press comes the moment it does.
    await undoIn(page, "Removed Quiet Bloom").hover();
    await armPress(page, { text: "Removed Quiet Bloom", label: "Undo", gone: "Added Paper Bloom" });
    await expect.poll(() => pressed(page), { timeout: 8000 }).toEqual({ drawn: ["Removed Quiet Bloom from Late Night"], disabled: null });
    await expect.poll(() => calls(page, "undo_batch"), "the press is taken").toBe(1);
    await expect(row(page, "Quiet Bloom")).toBeVisible();
  });

  test("an Undo toast that moved ignores a press for 400 ms, then takes one", async ({ app, page }) => {
    await row(page, "Quiet Bloom").focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => drawn(page)).toEqual(["Removed Quiet Bloom from Late Night"]);
    await page.waitForTimeout(500);
    await row(page, "Paper Bloom").focus();
    // A newer toast comes under it: it moves up, and the press comes the moment it does.
    await armPress(page, { text: "Removed Quiet Bloom", label: "Undo", came: "Added Paper Bloom" });
    await page.keyboard.press("a");
    await expect.poll(() => pressed(page)).toEqual({ drawn: ["Removed Quiet Bloom from Late Night", "Added Paper Bloom to the queue"], disabled: "true" });
    await page.waitForTimeout(150);
    await app.settled();
    expect(await calls(page, "undo_batch"), "the press as it moved is ignored").toBe(0);
    await expect(undoIn(page, "Removed Quiet Bloom")).not.toHaveAttribute("aria-disabled");
    await undoIn(page, "Removed Quiet Bloom").click();
    await expect.poll(() => calls(page, "undo_batch"), "a press 400 ms later is taken").toBe(1);
  });

  test("an Undo pressed while another undo runs comes back, and the other Undo toast stays", async ({ app, page }) => {
    for (const title of ["Paper Bloom", "Quiet Bloom"]) {
      await row(page, title).focus();
      await page.keyboard.press("Delete");
      await expect(row(page, title)).toHaveCount(0);
      await app.settled();
    }
    await expect.poll(() => drawn(page)).toEqual(["Removed Paper Bloom from Late Night", "Removed Quiet Bloom from Late Night"]);
    await page.evaluate(() => (window.__soundhoodMock.delay.undo_batch = 1500));
    await openSettings(app, page);
    await settingRow(page, "Undo last change").getByRole("button", { name: "Undo" }).click();
    // Refused (an undo runs): the toast leaves before its action runs, so coming back it pushes
    // nothing out, and the older Undo toast is still there to be pressed.
    await undoIn(page, "Removed Quiet Bloom").click();
    await expect.poll(() => drawn(page)).toEqual(["Removed Paper Bloom from Late Night", "Removed Quiet Bloom from Late Night"]);
    expect(await calls(page, "undo_batch"), "only Settings' undo runs").toBe(1);
  });
});

// One press guard for every toast action: Cancel, Retry and Settings as Undo. An action ignores a
// press for 400 ms after its own toast came, moved or changed its action, never because another
// toast changed; a download's progress is no change.
test.describe("a download's Cancel and Retry", { tag: ["@desktop", "@phone"] }, () => {
  // `app` first: its mock is in the page before this script changes it.
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(!["desktop-1280x800", "phone-390x844"].includes(testInfo.project.name), "one PC and one phone size");
    void app;
    await page.addInitScript(() => {
      window.__soundhoodMock.store.set("downloader_enabled", true);
      window.__soundhoodMock.holdPhoneDownload = true;
    });
  });

  const where = (page) => page.getByRole("dialog", { name: "Where should this go?" });
  const downloads = (page) => page.evaluate(() => window.__soundhoodMock.downloads.length);
  const cancels = (page) => page.evaluate(() => window.__soundhoodMock.cancels.length);
  const action = (page, label) => page.locator(".Toast").getByRole("button", { name: label, exact: true });

  /** On the phone: a shared link, Download, and the download's toast with Cancel. */
  async function startPhoneDownload(page) {
    expect(await page.evaluate((u) => window.__soundhoodShare(u), VIDEO)).toBe(true);
    await where(page).getByRole("button", { name: "Download", exact: true }).tap();
    await expect.poll(() => downloads(page)).toBe(1);
    await expect(action(page, "Cancel")).toBeVisible();
  }

  /** Taps (or clicks) at one point at each of `offsets` ms from the first; what was under it each time. */
  async function pressesAt(page, locator, offsets, touch) {
    const b = await locator.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const t0 = Date.now();
    const seen = [];
    for (const ms of offsets) {
      await page.waitForTimeout(Math.max(0, t0 + ms - Date.now()));
      seen.push(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim().slice(0, 30) ?? "", [x, y]));
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    }
    return seen;
  }

  test("Cancel ignores a press the moment its toast comes, then takes one", async ({ app, page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "the PC host cannot cancel");
    await app.open();
    expect(await page.evaluate((u) => window.__soundhoodShare(u), VIDEO)).toBe(true);
    await armPress(page, { text: "Downloading", label: "Cancel", came: "Downloading" });
    await where(page).getByRole("button", { name: "Download", exact: true }).tap();
    await expect.poll(() => pressed(page)).toMatchObject({ disabled: "true" });
    await page.waitForTimeout(150);
    expect(await cancels(page), "the press as it came is ignored").toBe(0);
    await expect(action(page, "Cancel")).not.toHaveAttribute("aria-disabled");
    await action(page, "Cancel").tap();
    await expect.poll(() => cancels(page), "a press 400 ms later is taken").toBe(1);
    await page.evaluate(() => window.__soundhoodMock.finishPhoneDownload());
  });

  test("Retry ignores a press the moment its toast comes, then takes one", async ({ app, page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "the PC's download, failed by its host events");
    await app.open();
    await page.locator(".Sidebar-nav .NavItem").filter({ visible: true }).filter({ hasText: "Download" }).click();
    await where(page).getByRole("textbox", { name: "Link" }).fill(VIDEO);
    await where(page).getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => downloads(page)).toBe(1);
    await armPress(page, { text: "Download failed", label: "Retry", came: "Download failed" });
    await page.evaluate(() => window.__soundhoodEmit("ytdlp:stderr", "ERROR: [youtube] AbCdEfGhIjK: Video unavailable"));
    await page.evaluate(() => window.__soundhoodEmit("ytdlp:done", 1));
    await expect.poll(() => pressed(page)).toMatchObject({ disabled: "true" });
    await page.waitForTimeout(150);
    expect(await downloads(page), "the press as it came is ignored").toBe(1);
    await action(page, "Retry").click();
    await expect.poll(() => downloads(page), "a press 400 ms later tries the link again").toBe(2);
  });

  test("a double tap on Cancel never presses the Retry that comes under it", async ({ app, page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "the PC host cannot cancel");
    await app.open();
    await startPhoneDownload(page);
    await page.waitForTimeout(600);
    // The download ends with a failure 30 ms after the cancel: its Retry comes where Cancel was.
    await page.evaluate(() => {
      const internals = window.__TAURI_INTERNALS__;
      const invoke = internals.invoke;
      internals.invoke = (cmd, args, options) => {
        if (cmd === "plugin:soundhood-ytdl|cancel") {
          setTimeout(() => {
            window.__soundhoodMock.phoneDownload = { exitCode: 1, files: [], log: "ERROR: cancelled\n" };
            window.__soundhoodMock.finishPhoneDownload();
          }, 30);
        }
        return invoke(cmd, args, options);
      };
    });
    const seen = await pressesAt(page, action(page, "Cancel"), [0, 90, 180, 270], true);
    await page.waitForTimeout(800);
    expect(await cancels(page), `one cancel: ${JSON.stringify(seen)}`).toBe(1);
    expect(await downloads(page), `no Retry: ${JSON.stringify(seen)}`).toBe(1);
  });

  test("a double tap on Retry never cancels the download it started", async ({ app, page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "the PC host cannot cancel");
    await app.open();
    await startPhoneDownload(page);
    await page.evaluate(() => {
      window.__soundhoodMock.phoneDownload = { exitCode: 1, files: [], log: "ERROR: [youtube] AbCdEfGhIjK: Video unavailable\n" };
      window.__soundhoodMock.finishPhoneDownload();
    });
    await expect(action(page, "Retry")).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await pressesAt(page, action(page, "Retry"), [0, 120, 240], true);
    await page.waitForTimeout(500);
    expect(await downloads(page), `one Retry: ${JSON.stringify(seen)}`).toBe(2);
    expect(await cancels(page), `no Cancel: ${JSON.stringify(seen)}`).toBe(0);
    await page.evaluate(() => window.__soundhoodMock.finishPhoneDownload());
  });

  test("Cancel on a toast that has been showing acts at once when another toast comes and leaves it in place", async ({ app, page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "the PC host cannot cancel");
    await app.open();
    await openPlaylist(page, "Late Night");
    await startPhoneDownload(page);
    await page.waitForTimeout(600);
    // A toast comes under the download's: the download's moves up, and its Cancel ignores a press then.
    await row(page, "Paper Bloom").focus();
    await armArrival(page, { text: "Downloading", label: "Cancel" });
    await page.keyboard.press("a");
    await expect.poll(() => pressed(page)).toMatchObject({ disabled: "true" });
    await page.waitForTimeout(150);
    expect(await cancels(page), "moved: the press is ignored").toBe(0);
    await page.waitForTimeout(400);
    // Another comes and pushes the older one out: the download's stays where it is, and takes the press.
    await armArrival(page, { text: "Downloading", label: "Cancel" });
    await page.keyboard.press("a");
    await expect.poll(() => pressed(page)).toMatchObject({ disabled: null });
    await expect.poll(() => cancels(page), "in place: the press is taken").toBe(1);
    await page.evaluate(() => window.__soundhoodMock.finishPhoneDownload());
  });

  test("a download's progress is no change: Cancel takes a press as its words change", async ({ app, page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "the PC host cannot cancel");
    await app.open();
    await startPhoneDownload(page);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.__press = null;
      const toast = [...document.querySelectorAll(".Toast")].find((el) => el.textContent.includes("Downloading"));
      const watch = new MutationObserver(() => {
        const button = [...toast.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
        if (!button) return;
        watch.disconnect();
        window.__press = { drawn: toast.querySelector("span").textContent, disabled: button.getAttribute("aria-disabled") };
        button.click();
      });
      watch.observe(toast, { childList: true, subtree: true, characterData: true });
    });
    // The download's words change every second ("Downloading (1 s)"); the press lands as they do.
    await expect.poll(() => pressed(page), { timeout: 3000 }).toMatchObject({ disabled: null });
    await expect.poll(() => cancels(page)).toBe(1);
    await page.evaluate(() => window.__soundhoodMock.finishPhoneDownload());
  });
});

/**
 * Arms a press inside the page for the moment a toast comes (a .Toast added to the stack): the
 * button `label` of the toast holding `text` is clicked then, before the next frame.
 */
const armArrival = (page, spec) =>
  page.evaluate(({ text, label }) => {
    window.__press = null;
    const stack = document.querySelector(".Toasts");
    const watch = new MutationObserver((records) => {
      if (!records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && n.classList.contains("Toast")))) return;
      const toast = [...document.querySelectorAll(".Toast")].find((el) => el.textContent.includes(text));
      const button = [...(toast?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
      if (!button) return;
      watch.disconnect();
      window.__press = { drawn: [...document.querySelectorAll(".Toast > span")].map((s) => s.textContent), disabled: button.getAttribute("aria-disabled") };
      button.click();
    });
    watch.observe(stack, { childList: true });
  }, spec);

// A toast closed by its own action leaves nothing to press where it was for 400 ms (the second click
// of a double click reaches no song row behind it), and when it had the focus the focus goes to the
// sheet on top, else to the screen's heading, never to the page.
test.describe("a toast closed by its own action", { tag: ["@desktop", "@phone"] }, () => {
  test.beforeEach(async ({ app, page }, testInfo) => {
    test.skip(!["desktop-1280x800", "phone-390x844"].includes(testInfo.project.name), "one PC and one phone size");
    await app.open();
    await openPlaylist(page, "Late Night");
  });

  const where = (page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return "the page";
      if (el.closest(".Sheet")) return "sheet";
      return el.matches("h1, h2") && el.closest(".Shell-main") ? `heading ${el.textContent}` : `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent}`.slice(0, 40);
    });

  test("a second click or tap where the top toast's Undo was plays no song behind it", async ({ app, page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    for (const title of ["Paper Bloom", "Quiet Bloom"]) {
      await row(page, title).focus();
      await page.keyboard.press("Delete");
      await expect(row(page, title)).toHaveCount(0);
      await app.settled();
    }
    await expect.poll(() => drawn(page)).toEqual(["Removed Paper Bloom from Late Night", "Removed Quiet Bloom from Late Night"]);
    await page.waitForTimeout(500);
    // The older toast is the top one: once it leaves, nothing is drawn in its place but the list.
    const b = await undoIn(page, "Removed Paper Bloom").boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const behind = await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).some((el) => el.matches(".TrackRow")), [x, y]);
    expect(behind, "a song row lies behind the top toast's Undo").toBe(true);
    // The undo answers after 300 ms: until then nothing is drawn where the toast was.
    await page.evaluate(() => (window.__soundhoodMock.delay.undo_batch = 300));
    for (const gap of [0, 150]) {
      if (gap > 0) await page.waitForTimeout(gap);
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    }
    await page.waitForTimeout(600);
    await app.settled();
    expect(await calls(page, "undo_batch"), "one undo").toBe(1);
    expect(await page.locator(".TrackRow.is-playing").count(), "no song played").toBe(0);
  });

  test("its Undo pressed with the pointer or Enter leaves the focus on the screen's heading", async ({ app, page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "a mouse and a keyboard");
    for (const [title, how] of [
      ["Paper Bloom", "click"],
      ["Quiet Bloom", "Enter"],
    ]) {
      await row(page, title).focus();
      await page.keyboard.press("Delete");
      await expect(undoIn(page, `Removed ${title}`)).toBeVisible();
      await page.waitForTimeout(450);
      if (how === "click") await undoIn(page, `Removed ${title}`).click();
      else {
        await undoIn(page, `Removed ${title}`).focus();
        await page.keyboard.press("Enter");
      }
      await expect(row(page, title)).toBeVisible();
      await expect.poll(() => where(page), `Undo by ${how}`).toBe("heading Late Night");
    }
  });

  test("with the queue sheet open, its Undo gives the focus back to the sheet, and Esc closes it", async ({ app, page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    if (!touch) await page.setViewportSize({ width: 760, height: 520 });
    await playSong(app, page, "Lunar Comets");
    const queueButton = page.getByRole("button", { name: "Queue", exact: true }).filter({ visible: true }).first();
    if (touch) await queueButton.tap();
    else await queueButton.click();
    const sheet = page.locator(".QueueSheet");
    await expect(sheet).toBeVisible();
    await sheet.locator('[role="option"]').nth(2).focus();
    await page.keyboard.press("Delete");
    const undo = page.locator(".Toast", { hasText: "from the queue" }).getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await page.waitForTimeout(450);
    if (touch) await undo.tap();
    else await undo.click();
    await expect.poll(() => where(page), "the queue sheet has the focus again").toBe("sheet");
    await page.keyboard.press("Escape");
    await expect(sheet, "Esc closes the queue sheet").toHaveCount(0);
  });
});
