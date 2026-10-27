// Playwright fixtures for the screenshot suite: the app (Vite dev server) with the Tauri backend
// replaced by @tauri-apps/api/mocks answering from the fixture library.
//
// How the mock gets in first: Store.load() runs while App.tsx is being imported, so the IPC bridge
// must exist before any app script evaluates. mock-entry.mjs is bundled by esbuild into one IIFE,
// with @tauri-apps/api resolved from app/node_modules so the mock always matches the api version
// the app runs, and registered with page.addInitScript, which runs in every new document before
// the page's own scripts. That needs no change to the app or its Vite config, and works the same
// against the dev server, a production build or a WebView2 attached over CDP.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import { loadFixture, pageData } from "./fixture.mjs";
import { silentWav } from "./wav.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The app package whose dev server the suite drives. */
export const APP_DIR = path.resolve(HERE, "..", "..", "app");

// Resolve @tauri-apps/api imports as if they came from app/, whatever is installed elsewhere.
const resolveFromApp = {
  name: "resolve-tauri-api-from-app",
  setup(b) {
    b.onResolve({ filter: /^@tauri-apps\/api(\/|$)/ }, async (args) => {
      if (args.pluginData === "from-app") return undefined;
      const r = await b.resolve(args.path, { resolveDir: APP_DIR, kind: args.kind, pluginData: "from-app" });
      return r.errors.length ? { errors: r.errors } : { path: r.path };
    });
  },
};

let bundle;
/** The browser-side mock as one IIFE script, built once per worker. */
function mockBundle() {
  bundle ??= build({
    entryPoints: [path.join(HERE, "mock-entry.mjs")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    logLevel: "silent",
    plugins: [resolveFromApp],
  }).then((r) => r.outputFiles[0].text);
  return bundle;
}

/** Resolves once the app has been quiet on IPC for `quietMs` and `mustHave` (if any) was called. */
async function ipcSettled(page, mustHave = null, quietMs = 300) {
  await page.waitForFunction(
    ([cmd, quiet]) => {
      const ipc = window.__soundhoodIpc;
      return !!ipc && ipc.pending === 0 && (!cmd || ipc.calls.includes(cmd)) && performance.now() - ipc.lastAt > quiet;
    },
    [mustHave, quietMs],
    { polling: 50 },
  );
}

export const test = base.extend({
  /** What the mocked `platform` command reports: "windows" (desktop layout) or "android" (phone). */
  soundhoodPlatform: ["windows", { option: true }],

  /** The mocked app for this test's page: open(), settled(cmd), shot(screen) and the fixture data. */
  app: async ({ page, soundhoodPlatform }, use, testInfo) => {
    const data = pageData(loadFixture(), soundhoodPlatform);
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // The desktop player loads asset URLs directly: answer with silent audio of the track's length.
    await page.route("http://asset.localhost/**", (route) => {
      const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      const seconds = data.durationOf[file];
      if (seconds === undefined) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from(silentWav(seconds)) });
    });
    await page.addInitScript({ content: `window.__SOUNDHOOD_FIXTURE__ = ${JSON.stringify(data)};\n${await mockBundle()}` });

    const { width, height } = testInfo.project.use.viewport;
    await use({
      data,
      /** Loads the app and waits for the startup IPC (settings store, scan, playlists) to settle. */
      async open() {
        await page.goto("/");
        await ipcSettled(page, "list_playlists");
      },
      /** Waits for IPC to settle after an action, e.g. cover_art after a track starts. */
      settled: (cmd) => ipcSettled(page, cmd),
      /** The baseline name for this viewport and screen, e.g. "1280x800-library.png". */
      shot: (screen) => `${width}x${height}-${screen}.png`,
    });

    const unknown = await page.evaluate(() => window.__soundhoodIpc?.unknown ?? []);
    expect(unknown, "IPC commands without a fixture answer").toEqual([]);
    expect(pageErrors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };
