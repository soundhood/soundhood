// Visual baselines and behaviour checks of the current UI: Chromium against the app's Vite dev
// server with the Tauri backend mocked (harness.mjs). `npm run test:visual` runs every *.spec.mjs
// and compares against the committed baselines in __screenshots__/<os>/,
// `npm run test:visual:update` rewrites them, and `npm run evidence:after` copies the default-mode
// screens of the parity grid to docs/evidence/phase-<n>/after/.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Pick a free port once; worker processes re-read this file and inherit it through the env.
function freePort() {
  const probe =
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})";
  return Number(execFileSync(process.execPath, ["-e", probe], { encoding: "utf8" }));
}
process.env.SOUNDHOOD_VISUAL_PORT ??= String(freePort());
const port = Number(process.env.SOUNDHOOD_VISUAL_PORT);

// The layout is chosen by the shell's width alone (a container query), as in the app. The mocked
// `platform` command only says what the host can do: the phone sizes report "android" (Proton sync,
// the app's own bin, a typed music folder), the desktop sizes "windows" (the folder picker, the
// Recycle Bin).
const desktop = (width, height) => ({
  name: `desktop-${width}x${height}`,
  grep: /@desktop/,
  use: { viewport: { width, height }, soundhoodPlatform: "windows" },
});
const phone = (kind, width, height) => ({
  name: `${kind}-${width}x${height}`,
  grep: /@phone/,
  use: { viewport: { width, height }, soundhoodPlatform: "android", isMobile: true, hasTouch: true },
});

// The three modes besides the default, with the browser options that make each one. 130 % text has
// none: the harness stores the Text size setting at 130 % and the components spec sets --text-scale.
const MODES = {
  "reduced-motion": { reducedMotion: "reduce" },
  "more-contrast": { contrast: "more" },
  "text-130": {},
};

// The screen captures (tests tagged @modes: screens.spec.mjs, the queue and the settings) again in
// each mode, at 390x844 (the phone) and 1280x800 (the desktop). harness.mjs names these baselines
// screen-modes/<screen>/<width>x<height>-<mode>.png, out of the parity grid's way.
const screenModes = (project) =>
  Object.entries(MODES).map(([mode, contextOptions]) => ({
    ...project,
    name: `${project.name}-${mode}`,
    grep: /@modes/,
    metadata: { mode },
    use: { ...project.use, contextOptions },
  }));

// The design system's fixture pages (components.spec.mjs). There the layout follows the width only,
// as in the rebuilt app; the two narrow sizes are touch devices, the two wide ones use a mouse.
// Every size in the default mode; 390x844 and 1280x800 also with reduced motion, more contrast and
// 130 % text (the spec sets --text-scale for that mode).
const component = (width, height, mode = "default", contextOptions = {}) => ({
  name: `components-${width}x${height}${mode === "default" ? "" : `-${mode}`}`,
  testMatch: "components.spec.mjs",
  grep: /@component/,
  metadata: { mode },
  use: {
    viewport: { width, height },
    ...(width < 1000 ? { isMobile: true, hasTouch: true } : {}),
    contextOptions,
  },
});
const componentModes = (width, height) => Object.entries(MODES).map(([mode, options]) => component(width, height, mode, options));

export default defineConfig({
  testDir: HERE,
  testMatch: "*.spec.mjs",
  outputDir: path.join(HERE, "test-results"),
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    // Grayscale text antialiasing: ClearType's coloured subpixel fringes read as blue pixels to
    // blue-scan and differ between machines. Phones render grayscale text anyway.
    launchOptions: { args: ["--disable-lcd-text"] },
  },
  projects: [
    desktop(1280, 800),
    desktop(1920, 1080),
    phone("phone", 390, 844),
    phone("tablet", 834, 1194),
    component(390, 844),
    component(834, 1194),
    component(1280, 800),
    component(1920, 1080),
    ...componentModes(390, 844),
    ...componentModes(1280, 800),
    ...screenModes(phone("phone", 390, 844)),
    ...screenModes(desktop(1280, 800)),
  ],
  webServer: {
    // Needs app/node_modules (`npm ci` in app/). --strictPort: a taken port must fail, not drift.
    command: `npx vite --port ${port} --strictPort --host 127.0.0.1`,
    cwd: path.resolve(HERE, "..", "..", "app"),
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
