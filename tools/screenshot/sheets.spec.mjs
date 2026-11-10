// Dialogs over dialogs (docs/DESIGN.md, Modal / Sheet): one opened from another puts its backdrop over
// the first, so only the newest reads as open. "Where should this go?" from Settings is the case the
// app has; the stacking is the Sheet's own, so it holds for any pair.
import { expect, test } from "./harness.mjs";
import { goTo, openSettings } from "./ui.mjs";

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

test.describe("every layout", { tag: ["@desktop", "@phone"] }, () => {
  test('"Where should this go?" opened from Settings dims Settings under its backdrop', async ({ app, page }) => {
    await app.open();
    await goTo(page, "Folders");
    await openSettings(app, page);
    const settings = page.getByRole("dialog", { name: "Settings" });
    const title = settings.getByRole("heading", { name: "Settings" });
    expect(await topAt(title)).toEqual({ backdrop: false, dialog: "Settings" });

    await settings.getByRole("textbox", { name: "Link" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await settings.getByRole("button", { name: "Add", exact: true }).click();
    const where = page.getByRole("dialog", { name: "Where should this go?" });
    await expect(where).toBeVisible();
    // Settings stays open underneath, but nothing of it is on top any more: the new backdrop is.
    await expect(settings).toBeAttached();
    expect(await topAt(title)).not.toMatchObject({ dialog: "Settings" });
    for (const control of [title, settings.getByRole("button", { name: "Close", exact: true })]) {
      const top = await topAt(control);
      expect(top.backdrop || top.dialog === "Where should this go?", "the newest backdrop or dialog covers Settings").toBe(true);
    }

    // Closing it brings Settings back on top.
    await where.getByRole("button", { name: "Cancel" }).click();
    await expect(where).toHaveCount(0);
    expect(await topAt(title)).toEqual({ backdrop: false, dialog: "Settings" });
  });
});
