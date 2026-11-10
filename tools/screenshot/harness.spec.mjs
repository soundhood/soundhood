// The harness's own load (harness.mjs, loadPage): a load in which a request to the dev server fails
// is loaded again, a bounded number of times, and logged. On Windows a socket can be refused while
// many connections open and close (net::ERR_NO_BUFFER_SPACE): one module request of the app's ~140
// fails and the page stays blank. Here the failure is injected: a route aborts the request. An app
// that crashes as it starts, or hangs as it starts with every request answered, is never loaded
// again, even when it would start the second time: the load fails with the crash, or with the wait
// that gave up (naming the IPC command it waited for). A load's own time is added to the test's
// timeout while it runs, so a load that never succeeds still ends with its own error.
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

  test("startup IPC that hangs on the first load only, with no request failing: the load fails at once and names the command, it is not loaded again", async ({ app, page }, testInfo) => {
    test.setTimeout(IPC_SETTLE_MS + 30_000);
    // On the first load only, list_playlists is never recorded as called: startup waits for it in
    // vain, as an app that hangs only sometimes would. A second load would start, and hide it.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("hung-once")) return;
      sessionStorage.setItem("hung-once", "1");
      const iv = setInterval(() => {
        const ipc = window.__soundhoodIpc;
        if (!ipc || !Array.isArray(ipc.calls)) return;
        clearInterval(iv);
        const push = ipc.calls.push.bind(ipc.calls);
        ipc.calls.push = (...calls) => push(...calls.filter((c) => c !== "list_playlists"));
      }, 0);
    });
    await expect(app.open()).rejects.toThrow(
      new RegExp(`^/ did not start: waited ${IPC_SETTLE_MS} ms for the IPC command "list_playlists": .*\\(load 1; no request to the dev server failed or was left waiting, so it is not loaded again\\)$`),
    );
    expect(retries(testInfo), "no second load hid the hang").toEqual([]);
  });

  test("a page that shows nothing on its first load only, with every request answered: the load fails at once, it is not loaded again", async ({ page }, testInfo) => {
    test.setTimeout(LOAD_WAIT_MS + 30_000);
    let loads = 0;
    // The entry module is answered, runs without an error and renders nothing, on the first load only.
    await page.route(/\/src\/main\.tsx(\?.*)?$/, (route) =>
      ++loads === 1 ? route.fulfill({ status: 200, contentType: "text/javascript", body: "export {};" }) : route.continue(),
    );
    const opened = loadPage(page, testInfo, {
      url: "/",
      ready: () => page.waitForFunction(() => !!document.getElementById("root")?.firstElementChild, null, { timeout: LOAD_WAIT_MS, polling: 50 }),
    });
    await expect(opened).rejects.toThrow(/^\/ did not start: page\.waitForFunction: Timeout 15000ms exceeded.*\(load 1; no request to the dev server failed or was left waiting, so it is not loaded again\)$/);
    expect(loads).toBe(1);
    expect(retries(testInfo)).toEqual([]);
  });

  test(`a load that stalls every time ends with its own error, though the test's timeout is shorter than the ${LOAD_ATTEMPTS} attempts`, async ({ app, page }, testInfo) => {
    // Shorter than LOAD_ATTEMPTS x LOAD_WAIT_MS: the load's time is added to the test's while it runs.
    test.setTimeout(30_000);
    let seen = 0;
    // Every request for the entry module is held, never answered nor failed.
    await page.route(/\/src\/main\.tsx(\?.*)?$/, () => void ++seen);
    await expect(app.open()).rejects.toThrow(
      new RegExp(`^/ did not load in ${LOAD_ATTEMPTS} attempts; the last one page\\.waitForFunction: Timeout ${LOAD_WAIT_MS}ms exceeded.*still waiting for /src/main\\.tsx`),
    );
    expect(seen).toBe(LOAD_ATTEMPTS);
    expect(retries(testInfo)).toHaveLength(LOAD_ATTEMPTS - 1);
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
