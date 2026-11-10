// The harness's own load (harness.mjs, loadPage): a load in which a request to the dev server fails
// is loaded again, a bounded number of times, and logged. On Windows a socket can be refused while
// many connections open and close (net::ERR_NO_BUFFER_SPACE): one module request of the app's ~140
// fails and the page stays blank. Here the failure is injected: a route aborts the request. An app
// that crashes as it starts is never loaded again, even when it would start the second time: the
// load fails with the crash. A wait for IPC that never settles says which command it waited for.
import { expect, test } from "./harness.mjs";
import { IPC_SETTLE_MS, LOAD_ATTEMPTS, LOAD_WAIT_MS, loadPage } from "./harness.mjs";

/** Aborts the first `times` requests whose path matches `pattern`; returns how many were seen. */
async function failFirst(page, pattern, times) {
  const seen = { count: 0 };
  await page.route(pattern, (route) => (++seen.count <= times ? route.abort("failed") : route.continue()));
  return seen;
}

const retries = (testInfo) => testInfo.annotations.filter((a) => a.type === "page load").map((a) => a.description);

test.describe("app.open() and loadPage", { tag: "@desktop" }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280x800", "the harness is the same at every size");
  });

  test("the entry module's request fails once: the app is loaded again and starts", async ({ app, page }, testInfo) => {
    const entry = await failFirst(page, /\/src\/main\.tsx(\?.*)?$/, 1);
    await app.open();
    expect(entry.count, "the entry module was asked for twice").toBe(2);
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    expect(retries(testInfo)).toEqual([expect.stringMatching(/^load 1 of \/ failed: \/src\/main\.tsx net::ERR_FAILED; loading it again$/)]);
  });

  test("a module deep in the app's imports fails once: the app is loaded again and starts", async ({ app, page }, testInfo) => {
    const deep = await failFirst(page, /\/src\/design\/components\/Sheet\.tsx(\?.*)?$/, 1);
    await app.open();
    expect(deep.count).toBe(2);
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    expect(retries(testInfo)).toHaveLength(1);
  });

  test(`a load that keeps failing stops after ${LOAD_ATTEMPTS} attempts and says why`, async ({ app, page }, testInfo) => {
    const entry = await failFirst(page, /\/src\/main\.tsx(\?.*)?$/, Infinity);
    await expect(app.open()).rejects.toThrow(`/ did not load in ${LOAD_ATTEMPTS} attempts; the last one failed: /src/main.tsx net::ERR_FAILED`);
    expect(entry.count).toBe(LOAD_ATTEMPTS);
    expect(retries(testInfo)).toHaveLength(LOAD_ATTEMPTS - 1);
  });

  test("a request that never ends leaves the page empty: after LOAD_WAIT_MS the app is loaded again", async ({ app, page }, testInfo) => {
    test.setTimeout(LOAD_WAIT_MS + 45_000);
    let seen = 0;
    // The first request for the entry module is held, never answered nor failed.
    await page.route(/\/src\/main\.tsx(\?.*)?$/, (route) => (++seen === 1 ? undefined : route.continue()));
    await app.open();
    expect(seen).toBe(2);
    await expect(page.locator(".PlaylistCard")).toHaveCount(5);
    expect(retries(testInfo)).toEqual([expect.stringMatching(/^load 1 of \/ page\.waitForFunction: Timeout 15000ms exceeded/)]);
  });

  test("the app crashes as it starts on its first load only: the load fails with the crash, it is not loaded again", async ({ page }, testInfo) => {
    test.setTimeout(LOAD_WAIT_MS + 30_000);
    let loads = 0;
    // The entry module throws on the first load and is served as it is after that, so a second
    // load would start: an intermittent crash in the app itself, not a dev-server failure.
    await page.route(/\/src\/main\.tsx(\?.*)?$/, (route) =>
      ++loads === 1 ? route.fulfill({ status: 200, contentType: "text/javascript", body: 'throw new Error("startup crash on the first load");' }) : route.continue(),
    );
    // As app.open() waits for the app's first content.
    const opened = loadPage(page, testInfo, {
      url: "/",
      ready: () => page.waitForFunction(() => !!document.getElementById("root")?.firstElementChild, null, { timeout: LOAD_WAIT_MS, polling: 50 }),
    });
    await expect(opened).rejects.toThrow("/ did not start: startup crash on the first load (load 1, not loaded again)");
    expect(loads, "the entry module was asked for once").toBe(1);
    expect(retries(testInfo), "no second load hid the crash").toEqual([]);
  });

  test("a wait for IPC that never settles gives up on its own and names the command it waited for", async ({ app }) => {
    test.setTimeout(IPC_SETTLE_MS + 30_000);
    await app.open();
    await expect(app.settled("no_such_command")).rejects.toThrow(
      new RegExp(`^waited ${IPC_SETTLE_MS} ms for the IPC command "no_such_command": 0 pending; called so far: .*list_playlists`),
    );
  });

  test("a fixture page (the components spec's load) is loaded again the same way", async ({ page }, testInfo) => {
    const entry = await failFirst(page, /\/src\/design\/fixtures\/main\.tsx(\?.*)?$/, 1);
    // As components.spec.mjs keeps them: the console errors, dropped when a load is thrown away.
    const problems = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    const dropped = [];
    await loadPage(page, testInfo, {
      url: "/fixtures.html#Button",
      ready: () => page.waitForFunction(() => document.documentElement.dataset.fixture === "Button", null, { timeout: LOAD_WAIT_MS }),
      onRetry: (reason) => dropped.push(reason, ...problems.splice(0)),
    });
    expect(entry.count).toBe(2);
    expect(dropped[0]).toMatch(/^load 1 of \/fixtures\.html#Button failed: \/src\/design\/fixtures\/main\.tsx net::ERR_FAILED/);
    expect(dropped.slice(1), "the broken load's console error was dropped with it").toEqual([expect.stringMatching(/ERR_FAILED/)]);
    expect(problems, "the second load printed nothing").toEqual([]);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });
});
