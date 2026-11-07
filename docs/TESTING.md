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
own unit tests there, using synthetic values only.

## Visual suite

Playwright drives the real UI build with Tauri's IPC mocked (`mockIPC`) over the **fixture library**:
50 tracks, 5 playlists, covers in aqua, purple and greyscale so colour checks are meaningful.

- Viewports 390x844 and 834x1194 (phone layout), 1280x800 and 1920x1080 (PC layout), in the default
  mode only. Reduced motion, `prefers-contrast: more` and 130 % font size join in Phase 1, with the
  design system.
- Baselines are committed; a run fails when a screenshot differs from its baseline by more than 0.2 %.
- Run: in `tools/`, `npm run test:visual`. When a change is intended, update the baselines with
  `npm run test:visual -- --update-snapshots` and commit them with the change that caused them.
- Playwright prints one line per test (the `list` reporter, no HTML report). On failure the expected,
  actual and diff images of each failing screenshot are in `tools/screenshot/test-results/`; CI
  uploads that folder as the `visual-diff-report` artefact.
- Playwright names baselines per platform, so CI runs the suite on Windows, like the baselines.

## Lints

| Lint | Fails on |
|---|---|
| `node tools/token-lint.mjs` | a raw hex colour outside `app/src/design/tokens.css`; `appearance` changed on an input without custom styling; any character in U+1F000 to U+1FAFF, U+2600 to U+27BF or U+2B00 to U+2BFF in TSX (emoji as icons) |
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

- **The developer section** holds the switches below. It is hidden: on the phone, tap the status line
  in the top bar 7 times in a row (each tap within 1.5 s of the last) and it appears at the bottom of
  the settings sheet; on the PC, press
  Ctrl+Alt+Shift+D and it appears as a row under the top bar. The same gesture hides it again; the
  app remembers whether it is shown.
- **Test library** (the switch reads "Test library: on" or "off") installs the generated fixture
  library on the device (under the app's own data) and points the app at it. While it is on, Proton sync (Sync now, Get new, Send new) is
  switched off, so the test library never reaches the real Proton Drive. The same library can be
  generated on the PC with `soundhood-tools fixture-lib <dir>`.
- **Run self-test** runs the bundled fixture corpus through the installed app's own Rust code and
  writes pass and fail counts to the log, so the phone is checked with the same rules as the PC.
  **Copy log** shows the result. **Rebuild index** rebuilds the index from the files and logs the
  time it took.
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
- Never commit a screenshot, log or trace that shows a real library, a real path or a device
  identifier. Screenshots of a real library go only into the private owner report.
- Every acceptance item is either **agent-verified** (proved by a test, a log line or a screenshot;
  closes the phase) or **owner-verified** (needs the owner's hands, ears, accounts or car). Owner tests
  are written in [OWNER_TESTS](OWNER_TESTS.md) and tracked with a date in [OPEN](OPEN.md) until he
  ticks them; they are never marked done on anyone else's word.
- A phase closes when the four reviewers have signed its file in [REVIEWS](REVIEWS/README.md).
