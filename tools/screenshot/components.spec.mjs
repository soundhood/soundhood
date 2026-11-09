// The design system's fixture pages (app/fixtures.html, one per component, listed in
// app/src/design/fixtures/pages.json), photographed by the "components-*" projects of
// playwright.config.mjs: 390x844, 834x1194, 1280x800 and 1920x1080 in the default mode, and
// 390x844 and 1280x800 with reduced motion, more contrast and 130 % text. Animations are frozen by
// the suite's toHaveScreenshot settings; lazy images are loaded and decoded before each shot.
// Baselines: __screenshots__/<os>/components/<Page>/<width>x<height>-<mode>.png.
//
// The pages need no Tauri mock: the design system never talks to the host.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = JSON.parse(readFileSync(path.resolve(HERE, "../../app/src/design/fixtures/pages.json"), "utf8"));

const MEDIA = {
  "reduced-motion": "(prefers-reduced-motion: reduce)",
  "more-contrast": "(prefers-contrast: more)",
};

/** The project's mode: default, reduced-motion, more-contrast or text-130. */
const modeOf = (testInfo) => testInfo.project.metadata?.mode ?? "default";

test.beforeEach(async ({ page }, testInfo) => {
  if (modeOf(testInfo) === "text-130") {
    // The app's text size (Settings, Appearance) is --text-scale on the root element.
    await page.addInitScript(() => {
      const apply = () => document.documentElement?.style.setProperty("--text-scale", "1.3");
      apply();
      document.addEventListener("DOMContentLoaded", apply);
    });
  }
});

/** Fonts loaded, every image loaded and decoded (lazy ones too), two frames for layout effects. */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => !document.querySelector("[data-pending]"));
}

for (const name of PAGES) {
  test(`${name} @component`, async ({ page }, testInfo) => {
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => {
      // Vite's live-reload socket is the dev server's business, not the page's (it can fail when
      // the machine runs short of sockets during a parallel run).
      if (/WebSocket|\[vite\]/.test(m.text())) return;
      if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
    });

    await page.goto(`/fixtures.html#${name}`);
    await page.waitForFunction((n) => document.documentElement.dataset.fixture === n, name);
    const mode = modeOf(testInfo);
    if (MEDIA[mode]) {
      expect(await page.evaluate((q) => matchMedia(q).matches, MEDIA[mode]), `${mode} is emulated`).toBe(true);
    }
    if (mode === "text-130") {
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim())).toBe("1.3");
    }
    await settle(page);

    const { width, height } = testInfo.project.use.viewport;
    // Nothing may push the page sideways, at any size or text scale.
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "page width").toBeLessThanOrEqual(width);
    await expect(page).toHaveScreenshot(["components", name, `${width}x${height}-${mode}.png`], { fullPage: true });
    expect(problems, "errors or warnings in the page").toEqual([]);
  });
}

test("pages.json lists every fixture page @component", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "components-1280x800", "one viewport is enough");
  await page.goto("/fixtures.html");
  await page.waitForFunction(() => document.documentElement.dataset.fixture === "index");
  const registered = await page.evaluate(() => window.__FIXTURE_PAGES__);
  expect([...registered].sort()).toEqual([...PAGES].sort());
});
