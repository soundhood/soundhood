# Screenshot harness

Playwright drives the React UI on the app's Vite dev server in Chromium, with the Tauri backend
replaced by `@tauri-apps/api/mocks`. Everything the UI asks the host for comes from the made-up
fixture library in `fixture-library.json` (50 tracks, 5 playlists, aqua / purple / grey covers).
Nothing touches a real library, a phone or the network.

```
cd app && npm ci          # the dev server runs from app/node_modules
cd ../tools && npm ci
npm run test:visual           # compare with the committed baselines
npm run test:visual:update    # rewrite the baselines after an intended UI change
npm run evidence:baseline     # copy them to docs/evidence/phase-0/baseline/
```

| File | Role |
|---|---|
| `playwright.config.mjs` | viewports (desktop 1280x800, 1920x1080 as `windows`; phone 390x844, tablet 834x1194 as `android`), dev server on a free port, diff threshold 0.2 % |
| `harness.mjs` | the `app` fixture: bundles `mock-entry.mjs` with esbuild and injects it with `page.addInitScript`, serves desktop audio URLs, waits for IPC to settle, fails on unmocked commands or page errors |
| `mock-entry.mjs` | runs in the page before the app: `mockIPC` (with event mocking), `mockConvertFileSrc("windows")`, `HTMLMediaElement.play` stubbed; the Phase 0 commands (`last_change`, `undo_last` followed by a `core:batch` event, `rebuild_index`, `dev_fixture_root`, `self_test`, `diagnostics`) answer from a journal that starts empty, which a test can set through `window.__soundhoodMock`; `window.__soundhoodEmit(event, payload)` sends a host event |
| `fixture.mjs`, `wav.mjs` | scan / playlist results as the host returns them, generated cover PNGs, silent WAV audio |
| `baseline.spec.mjs` | the screens: desktop library with a playlist open and a track playing; phone browse, tracks, settings sheet, full player |
| `__screenshots__/<os>/` | committed baselines, one set per OS (fonts differ); only `win32` exists so far |

The layout is chosen by the mocked `platform` command, not by the viewport width, exactly as in the
app. Chromium runs with `--disable-lcd-text`: ClearType's coloured fringes would otherwise trip
`blue-scan` and make baselines machine-specific.

When the UI starts sending a new command, the suite fails with "IPC commands without a fixture
answer": add the command to `answer()` in `mock-entry.mjs`.
