# Screenshot harness

Playwright drives the React UI on the app's Vite dev server in Chromium, with the Tauri backend
replaced by `@tauri-apps/api/mocks`. Everything the UI asks the host for comes from the made-up
fixture library in `fixture-library.json` (50 tracks, 5 playlists, aqua / purple / grey covers).
Nothing touches a real library, a phone or the network.

```
cd app && npm ci          # the dev server runs from app/node_modules
cd ../tools && npm ci
npm run test:visual           # every spec: compare with the committed baselines, run the flow checks
npm run test:visual:update    # rewrite the baselines after an intended UI change
npm run evidence:after        # copy them to docs/evidence/phase-0/after/
npm run evidence:parity -- --in <dir> --out <dir>   # phone and desktop side by side per screen
npm test                      # unit tests, including ui-logic.test.mjs and pixels.test.mjs
```

| File | Role |
|---|---|
| `playwright.config.mjs` | viewports (desktop 1280x800, 1920x1080 as `windows`; phone 390x844, tablet 834x1194 as `android`), dev server on a free port, diff threshold 0.2 % |
| `harness.mjs` | the `app` fixture: bundles `mock-entry.mjs` with esbuild and injects it with `page.addInitScript`, serves desktop audio URLs, waits for IPC to settle, fails on unmocked commands or page errors |
| `mock-entry.mjs` | runs in the page before the app: `mockIPC` (with event mocking), `mockConvertFileSrc("windows")`, `HTMLMediaElement.play` stubbed. The journaled commands (`write_tags`, `playlist_add`, `undo_last`) change the mocked library, answer `last_change` and emit `core:batch` with the real core's labels ("Edited tags of <file name>", "Added 1 track to <playlist>", "Restored tags of <file name>", "Restored playlist <name>"). `dev_fixture_root` answers a fixture root under the app's data folder. A test steers the mock through `window.__soundhoodMock` (settings store, Proton status, download results, a partial undo) and sends host events with `window.__soundhoodEmit(event, payload)` |
| `fixture.mjs`, `wav.mjs` | scan / playlist results as the host returns them, generated cover PNGs, silent WAV audio |
| `baseline.spec.mjs` | the screens of the old UI: desktop library with a playlist open and a track playing; phone browse, tracks, settings sheet, full player |
| `undo.spec.mjs` | what Phase 0 adds: Undo enabled after a tag edit (desktop) and in the settings sheet (phone), then undone; the developer section open on both; the desktop after a playlist add, checked pixel for pixel against the screen before it (only the Undo button, the status and that playlist's count may change) |
| `flows.spec.mjs` | behaviour without screenshots: change lines stay out of the visible log and travel with Copy log, the desktop copy-failure text, no sideways scroll at 760 px, the test library switch (folder line, top-bar note, sync off), the queue stopping after a refused download, channel links refused |
| `parity.mjs`, `parity-grid.mjs` | the parity grid (`npm run evidence:parity`): pairs `390x844-<screen>.png` with `1280x800-<screen>.png`, draws each pair side by side at one height on `#0f0f0f` with a 16 px gap (`parity-<screen>.png`) and stacks them (`parity-all.png`); lists screens found at one size only ([TESTING](../../docs/TESTING.md#evidence-rules)) |
| `pixels.mjs` | counts the pixels that changed between two screenshots outside the regions a flow may change |
| `ui-logic.test.mjs` | unit tests of the UI's pure helpers in `app/src` (links, download output, test library, Copy log text, undo wording, folder names) |
| `__screenshots__/<os>/` | committed baselines, one set per OS (fonts differ); only `win32` exists so far |

The layout is chosen by the mocked `platform` command, not by the viewport width, exactly as in the
app. Chromium runs with `--disable-lcd-text`: ClearType's coloured fringes would otherwise trip
`blue-scan` and make baselines machine-specific.

Evidence: `docs/evidence/phase-0/before-0.1.0/` holds the screens of the last build before the
rebuild (0.1.0); `npm run evidence:after` rewrites `docs/evidence/phase-0/after/` from the
baselines and never touches the `before-0.1.0` set.

When the UI starts sending a new command, the suite fails with "IPC commands without a fixture
answer": add the command to `answer()` in `mock-entry.mjs`.
