# Screenshot harness

Playwright drives the React UI on the app's Vite dev server in Chromium, with the Tauri backend
replaced by `@tauri-apps/api/mocks`. Everything the UI asks the host for comes from the made-up
fixture library in `fixture-library.json` (50 tracks, 5 playlists, aqua / purple / grey covers).
Nothing touches a real library, a phone or the network. What the suite proves, and the rules around
it, are in [TESTING](../../docs/TESTING.md#visual-suite).

`fixture-library.json` is generated, never edited by hand: it is the core's fixture library, the
same one the app's Test library switch installs and `soundhood-tools fixture-lib` writes (every
track a 3-second tone, messy names included), exported in the harness's format. After a change to
`core/src/fixtures.rs`, regenerate it from the repository root and re-record the baselines:

```
cargo run -p soundhood-core --features tools --bin soundhood-tools -- harness-json tools/screenshot/fixture-library.json
cd tools && npm run test:visual:update
```

The core test `fixtures::tests::committed_harness_json_is_current` (part of `cargo test -p
soundhood-core`, so the CI `core-test` job) fails when the committed file differs from what
`harness-json` writes. The harness draws its own covers from the `cover` names (`aqua-rings`,
`purple-bands`, `grey-grid`, ...), one per colour of the core's embedded covers.

## Running it

```
cd app && npm ci          # the dev server runs from app/node_modules
cd ../tools && npm ci
npx playwright install chromium      # the browser, once per machine
npm run test:visual                  # every spec: compare with the committed baselines, run the flow checks
npm run test:visual -- settings      # one spec: the spec files whose name holds "settings"
npm run test:visual -- settings --project=desktop-1280x800   # and one size
npm run test:visual:update           # rewrite the baselines after an intended UI change (same filters)
npm run evidence:after               # copy the parity screens' baselines to docs/evidence/phase-1/after/
npm run evidence:after -- --phase 2  # the same into another phase's folder (never an earlier one)
npm run evidence:parity -- --in <dir> --out <dir>   # phone and desktop side by side per screen
npm test                             # unit tests, including ui-logic.test.mjs and pixels.test.mjs
```

A rewrite with `test:visual:update` rewrites every baseline the run reaches; check the changed images
by eye and commit them with the change that caused them. When the UI starts sending a new command,
the suite fails with "IPC commands without a fixture answer": add the command to `answer()` in
`mock-entry.mjs`.

## Sizes and modes

The projects in `playwright.config.mjs`:

| Project | Viewport | Runs |
|---|---|---|
| `desktop-1280x800`, `desktop-1920x1080` | 1280x800, 1920x1080; a mouse; the mocked host says `windows` | tests tagged `@desktop` |
| `phone-390x844`, `tablet-834x1194` | 390x844, 834x1194; touch; the mocked host says `android` | tests tagged `@phone` |
| `phone-390x844-<mode>`, `desktop-1280x800-<mode>` | 390x844 (as `phone-390x844`), 1280x800 (as `desktop-1280x800`) | tests tagged `@modes` (the screen captures) with `reduced-motion`, `more-contrast` or `text-130` |
| `components-<size>` | the same four sizes (touch under 1000 px wide) | `components.spec.mjs`, default mode |
| `components-<size>-<mode>` | 390x844 and 1280x800 | `components.spec.mjs` with `reduced-motion`, `more-contrast` or `text-130` |

The layout follows the viewport's width, exactly as in the app: 390x844 is the phone layout, 834x1194
the tablet layout (the rail), the two wide sizes the desktop layout. The mocked `platform` command only
says what the host can do (the phone: Proton sync, the bin inside the library, a path field for the music
folder; the PC: the folder picker, the Recycle Bin). The `text-130` mode sets `--text-scale: 1.3` on
the root element: for the component pages the spec sets it, for the app the harness stores the Text
size setting at 1.3 and the app sets it as it starts (a value set by hand would be removed while the
app loads); the harness checks the value, and for the other two modes that the media query matches. Chromium runs with `--disable-lcd-text`:
ClearType's coloured fringes would otherwise trip `blue-scan` and make baselines machine-specific.

## The specs

Screens are photographed under one name per screen at every size, `<width>x<height>-<screen>.png`,
so the parity grid can pair the phone with the desktop. The screen captures tagged `@modes` are also
photographed in the three other modes at 390x844 and 1280x800, as
`screen-modes/<screen>/<width>x<height>-<mode>.png` (harness.mjs `shot`), a folder neither the parity
grid nor the evidence copy reads. The rest are behaviour checks without photographs.

| Spec | What it covers |
|---|---|
| `components.spec.mjs` | every fixture page of the design system (below), photographed per size and mode; no sideways scroll at any size or text scale; no console error or warning; `pages.json` lists every registered page |
| `screens.spec.mjs` | photographs `playlists`, `artists`, `folders`, `tracks` (a playlist open, a song playing), `playing` and `search` at every size, and in the three other modes (`@modes`) |
| `library.spec.mjs` | what loads at start; a tap or click plays; Ctrl+click and Shift+click choose without playing; Select mode and its actions; adding and removing with the toast's Undo; the sort order, remembered; a new playlist opens empty; search groups, chips, a result opening its list, the field filtering it, Back; Playing opens over the list and closes back to it, "Playing from" worded alike on every shell; Playing greyed and inert while nothing plays, the tab, the rail icon and the sidebar item alike; the sidebar's width and fold, remembered; the Test library badge; the mini player opening Playing; below the desktop width the selection bar's four buttons and its More menu (Select all, Remove from); Remove from and Leave Select mode drawn with different icons |
| `player.spec.mjs` | the phone's time line (the song's length, moving, seeking where tapped); the phone's full player sliding down when closed; the full player's more menu (the song menu's items for the playing song, its keys and ARIA) at every size; only the newest of two quickly chosen songs playing; a position tick re-rendering no song row; the artwork tint fading over 500 ms |
| `queue.spec.mjs` | photographs `queue` (the sheet on the phone and the tablet, the right pane on the desktop), also in the three other modes; Next after Play next and Add to queue, then the rest of the list; Previous; the sheet from the mini player, the player bar and the full player; a row played, moved with Alt+Down, taken out with Delete and put back with Undo; Clear asking first; Save as playlist; the pane remembered; Repeat; Previous restarting a song past 3 s; the row menu; songs dragged onto a playlist in the sidebar |
| `keyboard.spec.mjs` | the keyboard map ([SHORTCUTS](../../docs/SHORTCUTS.md)) on the desktop: the playback keys, Q, 1 to 4, Ctrl+K and /, Esc, A, Shift+A, X, Ctrl+L, Enter, Delete, Ctrl+E, Ctrl+S, single keys quiet while typing |
| `settings.spec.mjs` | photographs `settings` (over Folders) at every size, also in the three other modes; the groups in order, Proton Drive on the phone only; Ctrl+comma; Text size setting `--text-scale` and remembered; View log, Copy log (the change lines only in the copy, the copy-failure text, Clear log); a partial undo's report; Make playlists from folders (how many it made, nothing to make without Undo, its own Undo); the Test library switch (folder line, badge, store keys, off going back or closing the library); the self-test wording; on the phone, sync off under the test library and a failed Proton login with Retry |
| `ingest.spec.mjs` | Ctrl+V outside a text field opening "Where should this go?" and downloading into the remembered folder and playlists; the sidebar's Download item; the download's toast; a new folder's name checked; no sideways scroll at 760 px; a refused download stopping the queue with an error row and Retry; channel links refused; the Downloader switch hiding the download UI, ending a queue run after the download in flight and turning a Retry away; Enter in the New folder field never downloading; Links waiting with Copy and Remove; on the phone, a shared link with Cancel and a refused queue |
| `undo.spec.mjs` | photographs `after-playlist-add` (desktop: a playlist add changes nothing on screen but its toast, checked pixel for pixel), `settings-undo` and `settings-developer`; a tag edit's report and its undo; a toast's Undo undoing its own change only (an older remove toast under a newer one, a newer tag edit, a report open); a double press on Undo last change and on a toast's Undo undoing one change; a refused tag write keeping the dialog open; the developer section's gestures (Ctrl+Alt+Shift+D, 7 taps on the version row) |
| `writes.spec.mjs` | a move of three songs ending in one report whose Undo this batch puts all three back; the batch undo by id, a newer change or a finished download's playlist add left alone; a refused step stopping it and counted; a double press undoing each change once; a delete naming the Recycle Bin (the bin on the phone, in its undo too), a refused file as a failed row, the player stopped; a deleted playlist as a toast with Undo; Ctrl+S onto a playlist that holds the song (no change, no Undo); Create and add undone in one |
| `focus.spec.mjs` | Tab through Playlists, an open playlist with a song playing, and Settings at every size: every stop shows the 2 px aqua ring (the element's outline, its `::after`, or the search field's frame); the search field's ring in pixels after Tab, Ctrl+K and /; the search field before the screen's New playlist in Tab order |
| `scrollbars.spec.mjs` | Chromium launched with its scrollbars shown (the suite hides them otherwise): on the desktop the track list and the settings dialog draw the custom 8 px bar (no `scrollbar-width` or `scrollbar-color`, no `::-webkit-scrollbar-button`, nothing drawn at the bar's ends, the `--scrollbar` thumb in its middle); on touch no bar |
| `sheets.spec.mjs` | "Where should this go?" opened from Settings puts its backdrop over Settings (nothing of Settings on top) and leaves Settings on top again when it closes |
| `onboarding.spec.mjs` | photographs `onboarding` (the first step) at every size; a new install's three steps, the downloader staying off; skipping; an existing install asked nothing; a phone without a folder asked for the folder alone, the standard Music folder offered; a link shared before startup has read the settings waiting for them (off: not taken; on: the sheet) |

## The component fixture pages

`app/fixtures.html` is a second entry of the app's dev server (never part of the production build):
one page per design-system component, chosen by the hash, `/fixtures.html#TrackRow`. Without a hash
it lists the pages. The pages are in `app/src/design/fixtures/pages/` and listed in
`app/src/design/fixtures/pages.json`; a page sets `data-fixture` on `<html>` once it has rendered,
and the spec waits for it. They need no host mock: the design system never talks to the host. To see
one by hand, run `npm run dev` in `app/` and open `/fixtures.html#<Page>`. A new component gets a page
there and a line in `pages.json`, then `npm run test:visual:update -- components` records it.

## Files

| File | Role |
|---|---|
| `playwright.config.mjs` | the projects above, the dev server on a free port, diff threshold 0.2 %, baselines under `__screenshots__/<os>/` |
| `harness.mjs` | the `app` fixture: bundles `mock-entry.mjs` with esbuild and injects it with `page.addInitScript`, serves desktop audio URLs, waits for IPC to settle, applies and checks the project's mode, names a screen's baseline (`shot`: under `screen-modes/` outside the default mode), fails on unmocked commands or page errors |
| `ui.mjs` | the steps the specs share, one per thing a user does, found by what is on screen at any size: go to a tab, open a playlist, play a song, open the player or Settings, the search field, settle the page before a photograph |
| `mock-entry.mjs` | runs in the page before the app: `mockIPC` (with event mocking), `mockConvertFileSrc("windows")`, `HTMLMediaElement.play` stubbed. The journaled commands (`write_tags`, `playlist_add`, `playlist_remove`, `playlist_create`, `playlist_delete`, `playlists_from_folders`, `move_track`, `delete_track`, `undo_last`, `undo_batch`) change the mocked library, answer `last_change` and emit `core:batch` before they return, as the host does, with the core's labels ("Edited tags of <file name>", "Added 1 track to <playlist>", "Moved <file name> to <folder>", "Deleted <file name> (in the bin)", "Deleted playlist <name>", "Created playlist <name>", and the undo labels such as "Restored tags of <file name>"); a write that was already in effect (the tags a file already has, after trimming; a song already in the playlist, a name that exists, every folder with its playlist) answers Ok, journals nothing and sends nothing, like the host. `undo_batch` undoes one change by its id and refuses one undone already or unknown, in the host's plain words. `dev_fixture_root` answers a fixture root under the app's data folder. A test steers the mock through `window.__soundhoodMock` (settings store, Proton status and login error, download results and errors, the journal, a partial undo, refused deletes and tag writes, a slow answer to a command, a held phone download, the folder picker's answer) and sends host events with `window.__soundhoodEmit(event, payload)` |
| `fixture.mjs`, `wav.mjs` | scan / playlist results as the host returns them, generated cover PNGs, silent WAV audio |
| `channel-links.json` | the channel-link vectors and the one refusal sentence, shared by the UI's unit tests, `ingest.spec.mjs` and the phone plugin's Rust tests |
| `parity.mjs`, `parity-grid.mjs` | the parity grid (`npm run evidence:parity`): pairs `390x844-<screen>.png` with `1280x800-<screen>.png`, draws each pair side by side at one height on `#0f0f0f` with a 16 px gap (`parity-<screen>.png`) and stacks them (`parity-all.png`); lists screens found at one size only ([TESTING](../../docs/TESTING.md#evidence-rules)) |
| `pixels.mjs` | counts the pixels that changed between two screenshots outside the regions a flow may change |
| `copy-evidence.mjs` | `npm run evidence:after -- [--phase <n>] [--os <name>]`: copies the default-mode baselines of the parity screens (playlists, artists, folders, tracks, playing, queue, search, settings) at the four sizes from `__screenshots__/<os>/` to `docs/evidence/phase-<n>/after/` (default the current phase, 1) and removes any other PNG there; flow captures, `screen-modes/` and `components/` stay out. It fails when one of the 32 is missing and refuses a phase before the current one, whose folder is a record. Its choices are unit-tested in `copy-evidence.test.mjs` |
| `ui-logic.test.mjs` | unit tests of the UI's pure helpers in `app/src` (channel links, why a queue stopped, the test library's name, Copy log text, undo wording, folder names) |
| `fixture.test.mjs`, `parity.test.mjs`, `pixels.test.mjs`, `copy-evidence.test.mjs` | unit tests of the fixture data, the parity grid, the pixel count and the evidence copy |
| `__screenshots__/<os>/` | committed baselines, one set per OS (fonts differ); only `win32` exists so far. The screens at the top, the same screens in the other modes under `screen-modes/<screen>/<width>x<height>-<mode>.png`, the fixture pages under `components/<Page>/<width>x<height>-<mode>.png` |

Evidence: `docs/evidence/phase-0/before-0.1.0/` holds the screens of the last build before the
rebuild (0.1.0) and is never rewritten by a script; Phase 1's folders are described in
[TESTING](../../docs/TESTING.md#evidence-rules).
