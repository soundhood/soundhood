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
| `library.spec.mjs` | what loads at start; a tap or click plays; Ctrl+click and Shift+click choose without playing; Select mode and its actions; adding and removing with the toast's Undo; the sort order, remembered; a new playlist opens empty; search groups, chips, a result opening its list, the field filtering it, Back; Playing opens over the list and closes back to it, "Playing from" worded alike on every shell; Playing greyed and inert while nothing plays, the tab, the rail icon and the sidebar item alike; the sidebar's width and fold, remembered; the Test library badge; the mini player opening Playing; below the desktop width the selection bar's four buttons, its two actions the first ones the selection can use (Remove from in place of a disabled Edit tags for two songs), and its More menu (Select all and the other actions); Remove from and Leave Select mode drawn with different icons |
| `player.spec.mjs` | the phone's time line (the song's length, moving, seeking where tapped); the phone's full player sliding down when closed; the full player's more menu (the song menu's items for the playing song, its keys and ARIA, Esc onto the player's title when a click opened it and onto More when Enter did) at every size; only the newest of two quickly chosen songs playing; a position tick re-rendering no song row; the artwork tint fading over 500 ms |
| `queue.spec.mjs` | photographs `queue` (the sheet on the phone and the tablet, the right pane on the desktop), also in the three other modes; Next after Play next and Add to queue, then the rest of the list; Previous; the sheet from the mini player, the player bar and the full player; a row played, moved with Alt+Down, taken out with Delete and put back with Undo; Clear asking first; Save as playlist; the pane remembered; Repeat; Previous restarting a song past 3 s; the row menu; songs dragged onto a playlist in the sidebar |
| `keyboard.spec.mjs` | the keyboard map ([SHORTCUTS](../../docs/SHORTCUTS.md)) on the desktop: the playback keys, Q, 1 to 4, Ctrl+K and /, Esc, A, Shift+A, X, Ctrl+L, Enter, Delete, Ctrl+E, Ctrl+S, single keys quiet while typing |
| `settings.spec.mjs` | photographs `settings` (over Folders) at every size, also in the three other modes; the groups in order, Proton Drive on the phone only; Ctrl+comma; Text size setting `--text-scale` and remembered; View log, Copy log (the change lines only in the copy, the copy-failure text, Clear log); a partial undo's report; Make playlists from folders (how many it made, nothing to make without Undo, its own Undo); the Test library switch (folder line, badge, store keys, off going back or closing the library); the self-test wording; on the phone, sync off under the test library and a failed Proton login with Retry |
| `ingest.spec.mjs` | Ctrl+V outside a text field opening "Where should this go?" and downloading into the remembered folder and playlists; the sidebar's Download item; the download's toast; a new folder's name checked; no sideways scroll at 760 px; a refused download stopping the queue with an error row and Retry; channel links refused; the Downloader switch hiding the download UI, ending a queue run after the download in flight and turning a Retry away; Enter in the New folder field never downloading; Links waiting with Copy and Remove; on the phone, a shared link with Cancel and a refused queue; a stopped queue's Retry downloading that link alone, then saying how many links still wait; one download at a time on the PC and the phone (a failed link's Retry pressed while another download runs starts nothing, keeps its error row and says so; the running one is filed into its own playlists only; Undo last change waits for its end) |
| `undo.spec.mjs` | photographs `after-playlist-add` (desktop: a playlist add changes nothing on screen but its toast, checked pixel for pixel), `settings-undo` and `settings-developer`; a tag edit's report and its undo; a toast's Undo undoing its own change only (an older remove toast under a newer one, a newer tag edit, a report open); a double press on Undo last change and on a toast's Undo undoing one change; a refused tag write keeping the dialog open; the developer section's gestures (Ctrl+Alt+Shift+D, 7 taps on the version row) |
| `writes.spec.mjs` | a move of three songs ending in one report whose Undo this batch puts all three back; the batch undo by id, a newer change or a finished download's playlist add left alone; a refused step stopping it and counted; a double press undoing each change once; a delete naming the Recycle Bin (the bin on the phone, in its undo too), a refused file as a failed row, the player stopped; a deleted playlist as a toast with Undo; Ctrl+S onto a playlist that holds the song (no change, no Undo); Create and add undone in one |
| `navigation.spec.mjs` | where the focus goes after a navigation: Enter on a card or a row, Back, the tab digits, "4", a click or tap on a card, on Back, on a sidebar item or tab, at every size: the new screen's heading, Space playing and pausing, Tab leading in; Playing opened with a pointer and closed (Esc, "1", its Close) leaving the focus on the heading under it, opened with the keyboard on its opener (1280x800, 760x520, 834x1194, 390x844); Select mode left with its X or Esc, Settings and the queue opened and closed with the pointer, and the player bar's button clicked after the keyboard had reached it, all leaving the focus on the heading with Space playing and pausing (1280x800, 1080x800, 760x520, 834x1194, 390x844); Esc in an empty search field putting the focus on the heading and closing Playing at once; Tab from a heading out of sight going to the first card or row in view (760x520) |
| `focus.spec.mjs` | Tab through Playlists, an open playlist with a song playing, and Settings at every size: every stop shows the 2 px aqua ring (the element's outline, its `::after`, or the search field's frame); the search field's ring in pixels after Tab, Ctrl+K and /; the search field before the screen's New playlist in Tab order; the focus never on the page after Esc twice from the selection bar's More menu, Esc closing the full player (1280x800 and 760x520), and the setup's Done; the full player closed by Esc onto the heading when a click opened it, onto its button when Enter did; Select under 1080 px giving the focus to the selection bar, and Esc from Select mode onto Select when Enter pressed it, onto the heading when a pointer did; the selection bar's More menu closed onto the heading when a click opened it, onto More when Enter did |
| `scrollbars.spec.mjs` | Chromium launched with its scrollbars shown (the suite hides them otherwise): on the desktop the track list and the settings dialog draw the custom 8 px bar (no `scrollbar-width` or `scrollbar-color`, no `::-webkit-scrollbar-button`, nothing drawn at the bar's ends, the `--scrollbar` thumb in its middle); on touch no bar |
| `sheets.spec.mjs` | a sheet opened from another one is drawn on top with the focus in it, and when it closes the one below is on top again with the focus (on the sheet when a click opened the one above, on its opener when Enter did): Settings with "Where should this go?", the log and the links waiting, the queue sheet with New playlist (Save as playlist) and "Clear the queue?" (Ctrl+L), at 390x844, 834x1194 and 760x520 (the 1280x800 project resized); closing "Where should this go?" with Cancel or Esc gives the focus back to Settings although Add is disabled, Tab stays in Settings and Esc closes it, at every size; a focus given behind the sheet or fallen to the page coming back to the field that had it, at every size; a submitting Enter (New playlist from the sidebar's "+", "Where should this go?" from the Download item, Edit tags) never pressing what the focus goes back to |
| `layers.spec.mjs` | the layer rule ([DESIGN](../../docs/DESIGN.md), Layers): with the Sort list or a row menu open no key heard on the window acts behind it, Esc closes it first, a sheet opened by any path closes it; the focus back on the list's or menu's control when the keyboard opened it (or the sheet: Ctrl+comma, Ctrl+V), on the screen's heading or the sheet it is in when a pointer did; a link shared during the setup waits for it, at 390x844, 834x1194 and 1280x800 |
| `presses.spec.mjs` | a held key is one press: held Enter on Remove in Links waiting, Undo last change, an emptied playlist's menu, the Sort list, the Downloader and queue-pane switches, Edit tags (opened, never saved), and on the phone a song row and the mini player's play; ArrowDown held in a list still moves down the rows; a held Space on a screen's heading playing or pausing once and scrolling nothing (1280x800, 760x520); a held "/" focusing the sidebar's search field and typing nothing into it (1280x800, 1920x1080) |
| `reach.spec.mjs` | every option of a long list: 29 playlists in "Where should this go?" at 390x844, 834x1194, 760x520 and 1280x800, each scrolled into view, under its own centre and picked by a click or a tap, the list inside the window and clear of its button; Home, End and type-ahead keep the active option in view; a list follows its button when the sheet scrolls a little and closes once the button has scrolled out of sight |
| `toasts.spec.mjs` | the toasts the user caused: A pressed twice shows two confirmations; A, B, C, then A again shows that A as the newest toast, at the bottom; the stack of two; every action (Undo, Cancel, Retry) ignoring a press for 400 ms after its own toast came, moved or changed, never for another toast or a download's progress; toasts arriving one after another never keeping Cancel unpressable for longer than one window, a tap every 500 ms taken; a double tap on Cancel or Retry pressing nothing under it; a slow double click (second click 460 to 490 ms later, detail 2) on the top toast's Undo undoing nothing more, the newer toast's change kept, and playing no song row behind; a toast closed by its action shielding its place (no song played behind it) and giving its focus to the sheet on top or the heading |
| `onboarding.spec.mjs` | photographs `onboarding` (the first step) at every size; a new install's three steps, the downloader staying off; skipping; an existing install asked nothing; a phone without a folder asked for the folder alone, the standard Music folder offered; a link shared before startup has read the settings waiting for them (off: not taken; on: the sheet), the link handed over by a setter the moment the app defines `window.__soundhoodShare`, so it always arrives first; Tab and Shift+Tab staying inside the setup on every step, a focus given behind it coming back |
| `harness.spec.mjs` | the harness's own load (`loadPage`, used by `app.open()` and the component pages), with the failure injected by a route: the entry module's request or one deep in the imports failing once, then the app loaded again and starting; a request that never ends, the app loaded again after `LOAD_WAIT_MS`; a load that keeps failing stopping after `LOAD_ATTEMPTS` with the reason; an app that crashes as it starts on its first load only failing with the crash, never loaded again; a wait for IPC that never settles naming the command after `IPC_SETTLE_MS`; a fixture page loaded again the same way |

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
| `harness.mjs` | the `app` fixture: bundles `mock-entry.mjs` with esbuild and injects it with `page.addInitScript`, serves desktop audio URLs, loads the app with `loadPage` (a load in which a request to the dev server fails, as `net::ERR_NO_BUFFER_SPACE` does on Windows under many parallel connections, or that draws nothing within `LOAD_WAIT_MS`, is loaded again from a blank page, at most `LOAD_ATTEMPTS` times, each retry logged on stderr and as a "page load" annotation; only the load is repeated, never a test's steps; a load that drew nothing and threw a page error fails at once with that error), waits for IPC to settle (at most `IPC_SETTLE_MS`, then an error naming the command it waited for), applies and checks the project's mode, names a screen's baseline (`shot`: under `screen-modes/` outside the default mode), fails on unmocked commands or page errors |
| `ui.mjs` | the steps the specs share, one per thing a user does, found by what is on screen at any size: go to a tab, open a playlist, play a song, open the player or Settings, the search field, settle the page before a photograph |
| `mock-entry.mjs` | runs in the page before the app: `mockIPC` (with event mocking), `mockConvertFileSrc("windows")`, `HTMLMediaElement.play` stubbed. The journaled commands (`write_tags`, `playlist_add`, `playlist_remove`, `playlist_create`, `playlist_delete`, `playlists_from_folders`, `move_track`, `delete_track`, `undo_last`, `undo_batch`) change the mocked library, answer `last_change` and emit `core:batch` before they return, as the host does, with the core's labels ("Edited tags of <file name>", "Added 1 track to <playlist>", "Moved <file name> to <folder>", "Deleted <file name> (in the bin)", "Deleted playlist <name>", "Created playlist <name>", and the undo labels such as "Restored tags of <file name>"); a write that was already in effect (the tags a file already has, after trimming; a song already in the playlist, a name that exists, every folder with its playlist) answers Ok, journals nothing and sends nothing, like the host. `undo_batch` undoes one change by its id and refuses one undone already or unknown, in the host's plain words. `dev_fixture_root` answers a fixture root under the app's data folder. A test steers the mock through `window.__soundhoodMock` (settings store, Proton status and login error, download results and errors, the journal, a partial undo, refused deletes and tag writes, a slow answer to a command, a held phone download, the folder picker's answer, more playlists with `addPlaylists`) and sends host events with `window.__soundhoodEmit(event, payload)` |
| `fixture.mjs`, `wav.mjs` | scan / playlist results as the host returns them, generated cover PNGs, silent WAV audio |
| `channel-links.json` | the channel-link vectors and the one refusal sentence, shared by the UI's unit tests, `ingest.spec.mjs` and the phone plugin's Rust tests |
| `parity.mjs`, `parity-grid.mjs` | the parity grid (`npm run evidence:parity`): pairs `390x844-<screen>.png` with `1280x800-<screen>.png`, draws each pair side by side at one height on `#0f0f0f` with a 16 px gap (`parity-<screen>.png`) and stacks them (`parity-all.png`); lists screens found at one size only ([TESTING](../../docs/TESTING.md#evidence-rules)) |
| `pixels.mjs` | counts the pixels that changed between two screenshots outside the regions a flow may change |
| `copy-evidence.mjs` | `npm run evidence:after -- [--phase <n>] [--os <name>]`: copies the default-mode baselines of the parity screens (playlists, artists, folders, tracks, playing, queue, search, settings) at the four sizes from `__screenshots__/<os>/` to `docs/evidence/phase-<n>/after/` (default the current phase, 1) and removes any other PNG there; flow captures, `screen-modes/` and `components/` stay out. It fails when one of the 32 is missing and refuses a phase before the current one, whose folder is a record. Its choices are unit-tested in `copy-evidence.test.mjs` |
| `ui-logic.test.mjs` | unit tests of the UI's pure helpers in `app/src` (channel links, why a queue stopped, the test library's name, Copy log text, undo wording, folder names) |
| `fixture.test.mjs`, `parity.test.mjs`, `pixels.test.mjs`, `copy-evidence.test.mjs` | unit tests of the fixture data, the parity grid, the pixel count and the evidence copy |
| `config.test.mjs` | the suite's failure limit: 25 failures stop a CI run (`CI_MAX_FAILURES`), none locally |
| `__screenshots__/<os>/` | committed baselines, one set per OS (fonts differ); only `win32` exists so far. The screens at the top, the same screens in the other modes under `screen-modes/<screen>/<width>x<height>-<mode>.png`, the fixture pages under `components/<Page>/<width>x<height>-<mode>.png` |

Evidence: `docs/evidence/phase-0/before-0.1.0/` holds the screens of the last build before the
rebuild (0.1.0) and is never rewritten by a script; Phase 1's folders are described in
[TESTING](../../docs/TESTING.md#evidence-rules).
