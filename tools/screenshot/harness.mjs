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

/** How many times a page is loaded before the load counts as broken for good. */
export const LOAD_ATTEMPTS = 3;

/** How long a load may leave the page without its first content (a request that never ends). */
export const LOAD_WAIT_MS = 15_000;

/**
 * Loads `url` and waits for `ready()`. A load in which a request to the dev server fails, or that
 * `ready()` gives up on, is thrown away and the page loaded again from a blank document, at most
 * LOAD_ATTEMPTS times in all. On Windows a socket can be refused while many connections open and
 * close (net::ERR_NO_BUFFER_SPACE): one of the ~140 module requests of a load fails and the page
 * stays blank. Each retry is logged on stderr and as a test annotation ("page load"), and
 * `onRetry(reason)` runs before the next load so the caller can drop what the broken one reported
 * (its page errors, its console errors). Only the load is repeated: a test's own steps start after
 * this returns. A request cut short because the page navigated (net::ERR_ABORTED) is not a failure.
 */
export async function loadPage(page, testInfo, { url, ready, onRetry = () => {} }) {
  const origin = new URL(testInfo.project.use.baseURL).origin;
  for (let attempt = 1; ; attempt++) {
    const failed = [];
    let signal;
    const failure = new Promise((resolve) => (signal = resolve));
    const onFailed = (request) => {
      const why = request.failure()?.errorText ?? "failed";
      if (!request.url().startsWith(origin) || why === "net::ERR_ABORTED") return;
      failed.push(`${new URL(request.url()).pathname} ${why}`);
      signal();
    };
    page.on("requestfailed", onFailed);
    const load = (async () => {
      // Only until the response arrives: a module request that never ends would hold the load
      // event, and the goto with it, for the whole test. `ready()` waits, with its own limit.
      await page.goto(url, { waitUntil: "commit" });
      await ready();
    })();
    // A load given up on may still be waiting when the next one starts; its outcome no longer counts.
    load.catch(() => {});
    let problem = null;
    try {
      await Promise.race([load, failure]);
    } catch (e) {
      // The test is over (its timeout, the page closed): nothing to load again.
      if (page.isClosed()) throw e;
      problem = String(e?.message ?? e).split("\n")[0];
    } finally {
      page.off("requestfailed", onFailed);
    }
    if (failed.length) problem = `failed: ${failed.join(", ")}`;
    if (!problem) return;
    if (attempt >= LOAD_ATTEMPTS) throw new Error(`${url} did not load in ${LOAD_ATTEMPTS} attempts; the last one ${problem}`);
    const line = `load ${attempt} of ${url} ${problem}; loading it again`;
    testInfo.annotations.push({ type: "page load", description: line });
    console.warn(`[${testInfo.project.name}] ${testInfo.title}: ${line}`);
    // A blank document first, so the next load is a whole new one (the same URL with a #page would
    // otherwise only scroll); once it is there, everything the broken load reported has arrived,
    // and the caller drops it.
    await page.goto("about:blank");
    onRetry(line);
  }
}

/** What each mode emulates, checked once the app has loaded. */
const MEDIA = {
  "reduced-motion": "(prefers-reduced-motion: reduce)",
  "more-contrast": "(prefers-contrast: more)",
};

export const test = base.extend({
  /** What the mocked `platform` command reports: "windows" (desktop layout) or "android" (phone). */
  soundhoodPlatform: ["windows", { option: true }],

  /** The mocked app for this test's page: open(), settled(cmd), shot(screen) and the fixture data. */
  app: async ({ page, soundhoodPlatform }, use, testInfo) => {
    const data = pageData(loadFixture(), soundhoodPlatform);
    // The project's mode (playwright.config.mjs): default, reduced-motion, more-contrast or text-130.
    // 130 % text is the Text size setting stored at 1.3, so the app itself sets --text-scale: 1.3 on
    // the root element as it starts (a property set by hand would be removed while the app loads).
    const mode = testInfo.project.metadata?.mode ?? "default";
    if (mode === "text-130") data.store.text_scale = 1.3;
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
      /**
       * Loads the app (loadPage: a broken load is loaded again) and waits for the startup IPC
       * (settings store, scan, playlists) to settle, `until` among it: "list_playlists" when a
       * library opens, "platform" for a start that shows the first-launch setup.
       */
      async open({ until = "list_playlists" } = {}) {
        const errorsBefore = pageErrors.length;
        await loadPage(page, testInfo, {
          url: "/",
          ready: async () => {
            await page.waitForFunction(() => !!document.getElementById("root")?.firstElementChild, null, { timeout: LOAD_WAIT_MS, polling: 50 });
            await ipcSettled(page, until);
          },
          // Errors thrown while a broken load ran belong to it, not to the test.
          onRetry: () => pageErrors.splice(errorsBefore),
        });
        if (MEDIA[mode]) expect(await page.evaluate((q) => matchMedia(q).matches, MEDIA[mode]), `${mode} is emulated`).toBe(true);
        if (mode === "text-130") {
          expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale")), "text size").toBe("1.3");
        }
      },
      /** Waits for IPC to settle after an action, e.g. cover_art after a track starts. */
      settled: (cmd) => ipcSettled(page, cmd),
      /**
       * The baseline name for this viewport and screen: "1280x800-playlists.png" in the default
       * mode (the name the parity grid and the evidence pair), and in another mode a path below
       * screen-modes/, ["screen-modes", "playlists", "1280x800-text-130.png"], which neither reads.
       */
      shot: (screen) => (mode === "default" ? `${width}x${height}-${screen}.png` : ["screen-modes", screen, `${width}x${height}-${mode}.png`]),
    });

    const unknown = await page.evaluate(() => window.__soundhoodIpc?.unknown ?? []);
    expect(unknown, "IPC commands without a fixture answer").toEqual([]);
    expect(pageErrors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };
