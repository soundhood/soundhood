# Testing

What each kind of test proves, how to run it, and what counts as evidence. The gate list CI enforces,
with the local command for each, is in [DEV](DEV.md#ci-gates). Phase sign-off rules are in
[REVIEWS](REVIEWS/README.md).

Two rules hold for every test:

- **Never a real library.** Tests build their library in a temporary folder from the fixtures in the
  repository. Nothing in a test, a script or a gate run reads or writes the owner's real library.
- **Never the network.** Downloads, lookups and sync are tested against recorded fixtures and local
  test servers.

## Rust unit tests (core)

```powershell
cargo test -p soundhood-core
cargo test -p soundhood-core --all-features
```

- Unit tests sit next to the code (`#[cfg(test)]`); tests that span modules go in `core/tests/`.
- Scratch libraries come from `tempfile`. Template audio is in `core/fixtures/audio/` (a 3-second
  tone in m4a, mp3, flac, opus and ogg, no tags); tests copy it before writing and never modify it in
  place.
- Tag writes have a round-trip test per container: write, re-read, compare every field, and check that
  untouched fields and the duration did not change.
- Playlists have byte-exact tests: the written file is exactly `#EXTM3U`, one entry per line, LF, no
  BOM ([LIBRARY_FORMAT](LIBRARY_FORMAT.md#playlists)); lenient reading (BOM, CRLF,
  backslashes, comments) and NFC normalisation are covered.
- The journal has fold tests (pre-image line, commit line, last line wins) and undo tests (a change and
  its undo leave tags, names and playlist lines as they were; an entry whose file changed since is
  refused, not forced).

## Kill-mid-write tests (fault injection)

They prove that a crash at any point of a write leaves the original file intact and no temp file
behind.

```powershell
cargo test -p soundhood-core --features fault-injection
```

With the `fault-injection` feature, `ingest::fault::point(name)` aborts the process when the
environment variable `SOUNDHOOD_CRASH_AT` equals `name`. The points are `after_preimage`,
`after_tmp_write`, `after_verify`, `after_replace` and `after_stage_copy`. Each test runs the test
binary again as a child process with that variable set, lets it die, then asserts in the parent that
the file is either the untouched original or the complete new version (never a mix) and that startup
cleanup leaves no `.soundhood-tmp-*` file. The same matrix covers the cross-volume landing of downloads. The feature is
never enabled in a shipped build.

## Fixture corpora (later phases)

Recorded inputs, replayed inside `cargo test`, never fetched live:

- yt-dlp stdout and stderr: progress lines with the full argument set (including the `--print` and
  `--quiet` interaction), "already recorded in the archive", bot wall, rate limit, stale cookies,
  missing JavaScript runtime (Phase 2).
- LRCLIB 429 and 503 with `Retry-After` (Phase 5); Proton 429 and sync conflict and rename fixtures
  against a local rclone remote (Phase 6).
- The sidecar manager runs against a local fixture HTTP server: a good checksum, a mismatch (refused)
  and a version below the pinned minimum (refused).

## Tooling and UI unit tests

In `tools/`: `npm run typecheck`, `npm run lint`, `npm run test` (Vitest). The lints below have their
own unit tests there, using synthetic values only. The same Vitest run takes the UI's pure helpers
in `app/src/**/*.test.ts`: the keyboard map, the queue model, the audio loader and the artwork tint.

## Visual suite

Playwright drives the app's real UI, on its Vite dev server in Chromium, with Tauri's IPC mocked
(`mockIPC`) over the **fixture library**:
50 tracks, 5 playlists, covers in aqua, purple and greyscale so colour checks are meaningful. It is
the core's generated library, the one the Test library switch installs on a device, exported by
`soundhood-tools harness-json` into `tools/screenshot/fixture-library.json`; a core test fails when
that file is out of date ([the harness README](../tools/screenshot/README.md)).

It has three parts, all in `tools/screenshot/` (the spec table is in
[the harness README](../tools/screenshot/README.md)):

- **The app's screens and flows.** Every other spec runs the whole app, at up to four sizes:
  390x844 and 834x1194 with the mocked host saying `android` and a touch screen, 1280x800 and
  1920x1080 with the host saying `windows` and a mouse. The layout follows the width alone, as in the
  app, so 390x844 is the phone layout, 834x1194 the tablet layout (the rail) and the two wide sizes
  the desktop layout; the platform only says what the host can do (Proton sync, the app's bin, the
  path field on the phone; the folder picker and the Recycle Bin on the PC). Specs tagged `@phone`
  run at the two narrow sizes, `@desktop` at the two wide ones. Each screen is photographed under one
  name at every size, `<width>x<height>-<screen>.png`, so the parity grid can pair them; the rest of
  the specs check behaviour without photographs. The suite never retries a test (`retries: 0`). It
  retries only a page's load: when a request to the dev server fails while the app or a fixture page
  loads (Windows refuses a socket now and then under many parallel connections,
  `net::ERR_NO_BUFFER_SPACE`), or nothing is drawn within 15 s, the harness loads the page again, at
  most three times in all, and logs each retry (`harness.mjs`, `loadPage`; proved by
  `harness.spec.mjs`).
- **The screens in three more modes.** The screen captures (`screens.spec.mjs` and the `queue` and
  `settings` captures, tagged `@modes`) run again at 390x844 and 1280x800 with reduced motion,
  `prefers-contrast: more`, and 130 % text, which is the Text size setting stored at 1.3, so the app
  sets `--text-scale: 1.3` on the root element itself (the harness checks it, and that the media
  query matches). Baselines: `__screenshots__/<os>/screen-modes/<screen>/<width>x<height>-<mode>.png`,
  a folder the parity grid and the evidence copy never read. A 130 % capture with text cut short,
  overlapping or pushed sideways is a bug to fix in the CSS, not a baseline.
- **The component fixture pages.** `app/fixtures.html` serves one page per design-system component
  (`/fixtures.html#TrackRow`; the list is `app/src/design/fixtures/pages.json`). It runs on the dev
  server only and needs no host mock. `components.spec.mjs` photographs every page at the same four
  sizes in the default mode, and at 390x844 and 1280x800 in three more modes: reduced motion,
  `prefers-contrast: more`, and 130 % text, which sets `--text-scale: 1.3` on the root element
  exactly as the Text size setting does. Each page also fails on sideways scroll and on any error or
  warning in the console, and one test checks that `pages.json` lists every registered page.
  Baselines: `__screenshots__/<os>/components/<Page>/<width>x<height>-<mode>.png`.
- **Keyboard focus and scrollbars.** `focus.spec.mjs` tabs through the main screens and Settings at
  every size and fails on any stop without the 2 px aqua ring. Playwright starts Chromium with
  `--hide-scrollbars`, so no photograph shows a scrollbar; `scrollbars.spec.mjs` starts it without
  that switch and checks that the desktop draws the custom bar (the Windows bar with arrow buttons
  is what WebView2 draws once `scrollbar-width` or `scrollbar-color` is set) and that touch draws
  none.
- The settings sheet is photographed over Folders, never over the Playlists screen: its blurred
  backdrop mixes the aqua and purple covers of the playlist cards into blue pixels, which the blue
  scan would count.
- Baselines are committed; a run fails when a screenshot differs from its baseline by more than 0.2 %.
- Run: in `tools/`, `npm run test:visual` (every spec), or one spec by name, for example
  `npm run test:visual -- settings`, and one size with `--project=desktop-1280x800`, or one size in
  one mode with `--project=desktop-1280x800-text-130` (the project names are in
  `playwright.config.mjs`). When a change is intended, rewrite the baselines with
  `npm run test:visual:update` (the same filters work) and commit them with the change that caused
  them.
- Playwright prints one line per test (the `list` reporter, no HTML report). On failure the expected,
  actual and diff images of each failing screenshot are in `tools/screenshot/test-results/`; CI
  uploads that folder as the `visual-diff-report` artefact.
- Playwright names baselines per platform, so CI runs the suite on Windows, like the baselines.

## Lints

| Lint | Fails on |
|---|---|
| `node tools/token-lint.mjs` | a raw hex colour outside `app/src/design/tokens.css`; `appearance` changed on an input without custom styling; any character in U+1F000 to U+1FAFF, U+2600 to U+27BF or U+2B00 to U+2BFF in TSX (emoji as icons) |
| `node tools/contrast-lint.mjs` | a pair of design tokens below its WCAG 2.x contrast minimum, in the default values or in the `prefers-contrast: more` values of `app/src/design/tokens.css`: 4.5:1 for text (fg-0, fg-1, aqua, lilac, danger and warn on bg-0, bg-1 and bg-2; aqua-ink on aqua and on danger; fg-0 on purple), 3:1 for the slider knob (lilac on bg-3 and bg-1) and the edge of a switch that is on (lilac on bg-0, bg-1 and bg-2); a token of the rule list that is missing or not a colour it can read. fg-2, fg-disabled and the purple of the slider fill and the switch track are reported, never failed. `var()` and `color-mix(in oklab, ...)` are resolved, and a translucent colour is laid over its background (a translucent background over bg-0). The pairs, their minimums and the reason for each are the table at the top of `tools/lint/contrast.mjs`. Without a tokens.css it prints that it skipped and passes |
| `node tools/blue-scan.mjs` | more than 0.1 % of pixels with hue 200 to 250 degrees and saturation above 0.5. It scans only the visual suite's screenshots of the fixture library (controlled covers) and device screenshots with the artwork areas masked; artwork and the colour tint taken from it are exempt by design, not by loosening the threshold |
| `node tools/hygiene-lint.mjs` | in the text of every tracked file (binary contents and files over 8 MB are skipped): the words of the deny list (below), matched per word, also inside camelCase names; a path inside a Proton Drive folder, in any slash style or URL-encoded; private LAN addresses (10/8, 172.16/12, 192.168/16); e-mail addresses other than GitHub noreply, the commit trailer and example domains; Windows user-profile paths with a real account name; a device serial written next to `adb -s`, `adb --serial`, `ANDROID_SERIAL`, `serialno`, `serial number` or `serial:`, or as a line of `adb devices` output (6 to 20 letters and digits with at least one digit), and a 15-digit number after "IMEI"; an en or em dash (U+2013, U+2014), as a character or as an HTML entity (named, decimal or hex), except in vendored `third_party/` code; the text terms of the deny list (below). In every tracked path, binaries included: the same rules, plus file names that hold keys or secrets (`*.jks`, `*.keystore`, `*.p12`, `keystore.properties`, `key.properties`, `cookies.txt`, `.env`, `.env.*`). Names, terms and serials are never printed. It does not see inside images, so a real path in a screenshot is caught only by the evidence rules ([DEV](DEV.md#public-repository-hygiene)) |

The deny list holds the owner-specific words and terms and is never in the repository, not even as
hashes, because a published hash of a name is reversed by any list of names. It is the `HYGIENE_DENY`
environment variable (a CI secret; empty on forks) plus, when it exists, the local deny file
`%USERPROFILE%\.soundhood\hygiene-deny.txt` (or the path in `HYGIENE_DENY_FILE`), kept outside the
repository like `keystore.properties`. Entries are separated by commas or new lines. A 64-hex entry is
the SHA-256 of a lower-cased word; a word of letters only is hashed by the lint; both are matched per
word. Any other entry (a model name with digits, a serial, two words) is matched as text, ignoring case,
but not inside a longer word or number. Entries shorter than 3 characters are ignored. With neither
source the lint checks no names, so the CI secret must be set and the local file kept.

## Device runs with the fixture root

Committed screenshots and gate runs on real devices use the fixture library, never a real one.

- **The developer section** holds the switches below. It is hidden, at the bottom of Settings: on the
  phone, open Settings and tap the version row in About ("Soundhood", "Version ...") 7 times in a
  row, each tap within 1.5 s of the last; on the PC, press Ctrl+Alt+Shift+D. A toast says
  "Developer tools on" (or off), the same gesture hides it again, and the app remembers whether it
  is shown (store key `dev_mode`).
- **Test library** (a switch; its help line says which library is shown) installs the generated
  fixture library on the device (under the app's own data) and points the app at it; off goes back
  to the library that was shown before, or to none. While it is on, the folder line in Settings reads
  "test library", every list screen's header carries a "Test library" badge, and Proton sync (Sync
  now, Get new, Send new) is switched off, so the test library never reaches the real Proton Drive.
  The same library can be generated on the PC with `soundhood-tools fixture-lib <dir>`.
- **Run self-test** runs the bundled fixture corpus through the installed app's own Rust code and
  writes pass and fail counts to a toast and the log, so the phone is checked with the same rules as
  the PC. **Copy log** (Settings, Tools) carries the result. **Rebuild index** rebuilds the index from
  the files and logs the time it took.
- Desktop screenshots come from the real WebView2 window, run under a test identity so the installed
  app's data is never touched ([DEV](DEV.md#desktop)). Start it with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222 --disable-lcd-text"` and
  connect Playwright with `connectOverCDP`. `--disable-lcd-text` turns off ClearType's coloured text
  fringes, which blue-scan would count as blue. The variable is merged with the browser arguments
  the app sets itself (`additionalBrowserArgs` of the window in `app/src-tauri/tauri.conf.json`), so
  the run keeps the shipped configuration. The one exception: a `--disable-features` in the variable
  replaces the app's own `--disable-features` list instead of adding to it, so never pass one there.
- For exact-size evidence, do not use Playwright's `page.screenshot()` over CDP: it returns images
  scaled by the display's scale factor (1414x884 for a 1280x800 window at 110 %), even after
  `Emulation.setDeviceMetricsOverride` with scale 1. Set the size with
  `Emulation.setDeviceMetricsOverride` (`width`, `height`, `deviceScaleFactor: 1`, `mobile: false`),
  then capture with the protocol's own `Page.captureScreenshot` (`format: "png"`) through a CDP
  session (`page.context().newCDPSession(page)`), and write the returned base64 to the file.
- Phone screenshots, saved on the phone and then pulled (a PowerShell `>` redirect can corrupt binary
  output):

  ```powershell
  adb shell screencap -p /sdcard/soundhood-shot.png
  adb pull /sdcard/soundhood-shot.png
  adb shell rm /sdcard/soundhood-shot.png
  ```

- Driving the phone's WebView over the DevTools protocol (`adb forward tcp:9223
  localabstract:webview_devtools_remote_<pid>`) is not yet verified against Tauri's WebView; the
  fallback is deep-link commands ([OPEN](OPEN.md)).

## Per-release net-log check (PC, by hand)

Proves that the PC app makes no network connection by itself on the WebView2 runtime installed today.
The Evergreen runtime updates on its own, so the zero-traffic result is re-checked before every
release ([OPEN](OPEN.md)). It is not a CI gate: the hosted runner has no desktop session to open the
window in. On the PC, after the [fresh-clone preparation](DEV.md#after-a-fresh-clone):

```powershell
cd app
npm run tauri build -- --no-bundle --config ../tools/netlog/test-identity.conf.json
cd ..
node tools/netlog-check.mjs
```

- **The test identity.** The check runs a build whose only difference is the identifier in
  `tools/netlog/test-identity.conf.json`, so its settings, index and journal live in folders of their
  own and the installed app's data is never touched. A built exe cannot take `--config`, and Tauri
  finds its data folders through Windows' known-folder lookup with the identifier compiled in, so no
  argument or environment variable can move them. The script refuses an exe that does not carry the
  test identifier. That build replaces `target/release/soundhood.exe`; the next `npm run tauri build`
  without the overlay builds the real one again.
- **What it does.** It seeds the test identity with the fixture library (`soundhood-tools fixture-lib`
  from next to the exe, so the app scans a library as it starts), starts the app with
  `--log-net-log=<file>` in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (merged with the app's own browser
  arguments; never a `--disable-features` there) and WebView2's data in a scratch folder
  (`WEBVIEW2_USER_DATA_FOLDER`), polls `Get-NetTCPConnection` every second, waits 120 s, then closes
  the window as a user would. A killed WebView2 leaves a cut-off log, so the window is never killed
  unless it fails to close within 30 s. Afterwards it removes the scratch folder and the test
  identity's folders.
- **It fails on** a host other than `tauri.localhost`, `ipc.localhost` and `asset.localhost` anywhere
  in the net log (URLs, host lookups, socket pools); a TCP connect or a UDP exchange with a
  non-loopback address in the net log; a TCP connection with a non-loopback address owned by the app
  or any process started under it (found by parent id and creation time, so a reused process id
  does not count); a net log that is cut off or missing; a window that does not close. A UDP connect
  that sends no packet (the IPv6 reachability probe) is printed as a note, not a failure.
- **Options:** the exe as the first argument (default `target/release/soundhood.exe`), `--seconds N`
  (default 120), `--keep` (keep the net log and the test data, and print where), `--no-library`
  (start without a library). While it waits, the window can be used (play a track, open settings,
  run the self-test) to cover more of the app; what it does then is checked the same way.
- **What it does not see:** UDP outside WebView2 (`Get-NetTCPConnection` lists TCP only), a TCP
  connection of the Rust side that opens and closes between two polls, and the crash handler
  ([OPEN](OPEN.md)). The parser's rules are unit-tested on synthetic logs in
  `tools/netlog/netlog.test.mjs` (`npm run test`).

## Library safety checks

A manifest lists every audio file and playlist with its size and hash
([LIBRARY_FORMAT](LIBRARY_FORMAT.md#manifests-snapshots)). Taking one before and one after an
operation and comparing them is the proof that nothing changed, or that only the intended files did:

- A dry run, or a normal session without edits, must compare **Identical**.
- A batch rename followed by Undo must compare **Identical**.
- A batch that writes must show exactly the files it reported, and nothing else.

The owner runs the same comparison with two copy-paste blocks
([OWNER_GUIDE](OWNER_GUIDE.md#take-a-library-snapshot-and-compare-two)).

## Evidence rules

- Every phase commits screenshots under `docs/evidence/<phase>/`: the Windows app at 1280x800 and
  1920x1080 and the phone, side by side per screen, all taken with the **fixture library**.
- Phase 1 uses three folders under `docs/evidence/phase-1/`: `after/` holds the default-mode
  baselines of the parity screens (playlists, artists, folders, tracks, playing, queue, search,
  settings) at the four sizes (`<width>x<height>-<screen>.png`), copied by `npm run evidence:after`
  in `tools/` (`-- --phase <n>` for another phase; an earlier phase's folder is never rewritten),
  `parity/` the parity grid made from them (below), and `gate/` the gate's screenshots of the real
  WebView2 window and the phone, with a README saying how and from which build they were taken, as
  `docs/evidence/phase-0/gate/` does. Phase 0's folders stay as they are.
- The side-by-side images come from the parity grid. In `tools/`:
  `npm run evidence:parity -- --in <folder of screenshots> --out <folder>` (optional `--phone 390x844`
  and `--desktop 1280x800`, the defaults), for example
  `npm run evidence:parity -- --in ../docs/evidence/phase-1/after --out ../docs/evidence/phase-1/parity`. It reads screenshots named as the visual suite names them,
  `<width>x<height>-<screen>.png`, and for every screen that exists at both sizes writes
  `parity-<screen>.png`: the phone on the left and the desktop on the right, both scaled to the
  smaller of the two heights (never enlarged), on the canvas colour `#0f0f0f` with a 16 px gap
  between and around them, no text. `parity-all.png` stacks every screen in name order. It lists the
  screens found at only one of the two sizes (each one a parity exception until it exists at both)
  and fails when no screen pairs up. The parity grid covers the parity screens: Phase 1 closes with
  Playlists, Artists, Folders, an open playlist (tracks), Playing, Queue, Search and Settings at both
  sizes, and a grid made from `after/` lists nothing as one-sided. A grid made from the whole baseline
  folder also pairs the flow captures, and lists `after-playlist-add` as desktop only: that flow (a
  playlist add changes nothing on screen but its toast) is checked on the desktop by nature, not a
  parity exception.
- Never commit a screenshot, log or trace that shows a real library, a real path or a device
  identifier. Screenshots of a real library go only into the private owner report.
- Every acceptance item is either **agent-verified** (proved by a test, a log line or a screenshot;
  closes the phase) or **owner-verified** (needs the owner's hands, ears, accounts or car). Owner tests
  are written in [OWNER_TESTS](OWNER_TESTS.md) and tracked with a date in [OPEN](OPEN.md) until he
  ticks them; they are never marked done on anyone else's word.
- A phase closes when the four reviewers have signed its file in [REVIEWS](REVIEWS/README.md).
