# Phase 1 review

Charters: [README](README.md). Phase 1 (0.3.0): the design system, the rebuilt interface on the PC and
the phone, the queue, Settings, downloads, the reports after writes, first-launch setup. Round 1 ran
on `afc8d4c` (2026-11-10), each reviewer on its own clean checkout, read-only.

## Build gate (`bfd88d5`, before round 1)

A clean clone of `phase-1`, both targets built, nothing installed.

| Check | Result |
|---|---|
| Fresh-clone preparation | yt-dlp 2026.10.26 and deno 2.9.8 fetched and checked against the pins |
| Core tests, default and all features | 262 passed (2 ignored); 329 passed (3 ignored) |
| fmt, clippy (workspace, all targets), host and plugin tests | clean; 0 warnings; 29 passed |
| `cargo ndk` check and phone clippy | ok; 0 warnings |
| Tools typecheck, lint, unit tests | ok; 0 errors; 318 passed |
| Lints: token, contrast, hygiene, md-links | 0 violations; 0 pairs below their minimum; 0 findings; 0 broken links |
| Visual suite, blue scan | 642 passed, 14 skipped; 536 screenshots, 0 failing |
| Windows installer | `Soundhood_0.3.0_x64-setup.exe`, 59.9 MB |
| Android release APK | 60.6 MB, versionCode 3000, signer SHA-256 `73abd93e…c48de47f45`, the key of the app on the phone |
| PC network check, 120 s, test identity | pass: `tauri.localhost`, `ipc.localhost`, `asset.localhost` only; no remote TCP |
| Real PC window screenshots | **not taken**: a person at the PC clicked through the test window's first-launch setup and chose a real library folder; the run stopped, closed the window and deleted the test identity's data (only an index, in app data). To be taken in a quiet slot with the phone attached |

## Round 1 (`afc8d4c`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. Every CI gate green on a fresh preparation; the visual suite 694 passed in four full runs (2, 8, 8 and 16 workers, two while a release build ran) and 236 of 236 in a stress run of the download and settings specs; desktop installer 59.9 MiB, release APK 63.5 MB with the expected signer, debug APK as in CI. Major: the Phase 1 suite (708 tests) has never run on GitHub's runners, so Phase 1 merges through a pull request with CI green. Minors: stale comments and docs, dev-only audit notices, the Vite favicon, repository growth from the baselines |
| Break the network | **signed**. No call at start, on a timer, on focus or after setup; every download follows a press of Download, Download queue or Retry; a refused download stops the queue; host and phone code unchanged since Phase 0 apart from the version; fonts bundled; nothing remote in the bundle; net-log check passed with the test library and on first-launch setup. Majors: a link shared to a phone in the first moment after start could be downloaded with the Downloader switch stored off; switching it off during a Download queue run did not stop the run |
| Break the library | **blocked**. Every write still goes through the journaled host commands and no new host command or file write was added, but a toast's Undo undid the newest change instead of its own, and was offered for gestures that changed nothing: an Undo on "already in the playlist" reverted an earlier tag edit (a tier-1 write nobody confirmed). Majors: a double press on Undo last change undid two changes; a report took its batch from the newest change after each operation, so a download finishing in between could be adopted and reverted |
| Break the design | **blocked**. The search field had no focus ring; the PC drew native scrollbars with arrow buttons (Chromium lets `scrollbar-width` override the custom scrollbar; headless screenshots hide scrollbars, so the suite could not see it). Majors: "Playing" with nothing loaded was disabled on the phone but not on the PC (a parity exception); one icon for two actions in the Select bar. Clean: at most one aqua fill on every screen and sheet, purple never text, nothing clipped at 130 % text, no emoji, native controls, legends, J/K or double-tap |


### Round-1 fixes

- **Undo by the change's own id.** A thin host command `undo_batch` over the core's existing
  `Core::undo_batch`; each write's own batch report is collected as it happens
  (`app/src/lib/journal.ts`); a toast and a report undo only their own changes; no Undo when nothing
  changed ("Already in Late Night"); undo buttons lock on the first press. 14 new tests fail on
  `afc8d4c` and pass after.
- **Downloader switch** checked on every download path; switching it off stops a running queue after
  the current download; a link shared before the stored setting is read waits for it.
- **Design:** the custom scrollbar really renders in WebView2 (Chromium let `scrollbar-width`
  override it), checked by a spec that runs with scrollbars shown; the search field's focus ring,
  checked by a Tab walk; "Playing" disabled alike on every size; a distinct icon for removing from a
  playlist; Settings dimmed under the download sheet; the switch's edge; the playing row's bar;
  "Playing from" worded alike; dark window, page and Android theme at start; the app mark as favicon.

## Round 2 (`97c4d99`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. Every round-1 scenario fixed, on the mock and on the real core (`undo_batch` refuses an undone, unknown or since-changed change and writes nothing); event ordering of the batch report confirmed in the Tauri source. New major (older than Phase 1): change detection by whole-second time and size left the index showing the edited tags after an edit and its undo within one second |
| Break the network | **signed**. Both majors fixed; no new network path; net-log check passed twice. Minors: the switch defaulted to on until the stored setting loaded; a settings read error left it on |
| Break the design | **blocked**. Round-1 findings fixed. New: "Save as playlist" from the queue sheet opened New playlist hidden under it on narrow shells; focus was lost when the download sheet closed over Settings |
| Break the build | **blocked** on test reliability only: a cold-share spec failed 29 of 200 runs at CI's worker count; a page load could hang on a Windows socket-buffer error; a player spec was timing-dependent |

### Round-2 fixes

Every journaled batch re-reads the files it touched (`Index::refresh_touched`, proven on m4a, opus
and ogg within one second); a fence after a late batch report; the contract pins `core:batch`;
exact counts in messages; the downloader stays off until the settings load and when they cannot be
read; one sheet stack in open order; focus returns to the sheet below; deterministic specs (800 of
800, 400 of 400); the test harness reloads a page whose dev-server request failed.

## Round 3 (`7421cba`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. The three formerly flaky tests passed 1,200 runs; broad stress 987 of 987 at 10 and 16 workers. Minors: the harness reload could hide an intermittent startup crash; a stuck startup call was not named |
| Break the library | **signed**. Stale index gone in every case; forced re-reads write nothing; held Enter and double clicks on every confirm act once. Minors: recovery at start did not force its paths; typing a link by hand lost focus; Select bar slots swapped with the selection; an Undo on "Create and add" that would be refused |
| Break the network | **signed**. Minor: the phone's helper Update and Network check showed before the stored switch was read |
| Break the design | **blocked**: typing a link by hand into the download sheet threw focus out and the "/" landed in the search behind; Ctrl+K and "/" reached the search behind any sheet; Ctrl+comma during first-launch setup opened Settings under it |

### Round-3 fixes

The sheet reads its initial focus once; shortcuts do nothing behind a sheet, the setup or a menu; a
focus safety net; focus after removing a waiting link or closing a report; stable narrow Select
slots per kind of list; the remove icon drawn as add-to-playlist's counterpart; recovery re-reads its
paths on the first scan; the helper rows wait for the settings; the harness fails at once on a
startup crash and names a stuck startup call.

## Round 4 (`0a108cf`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. All gates; the suite twice and a 1,104-test stress at 12 workers, 0 failures; installer 62.8 MB; APK signer as on the phone; CI's visual job estimated at about 11 minutes. Minors: an intermittent startup hang without a failed request could still pass after a reload; the load budget is close to the test timeout |
| Break the network | **signed**. Every probe passes; paste and Ctrl+comma under the setup or a menu start nothing; net-log check passed. Observation: a phone share during the setup opened the download sheet under it |
| Break the library | **signed**. Write path untouched; forced re-reads byte-identical; recovery forces only this device's last open entry; every confirm acts once. Minors: a held Enter removed every waiting link and undid three changes in a row |
| Break the design | **blocked**: the phone's share path ignored the rule that no sheet opens under the setup or a menu; open dropdown lists were not a layer, so shortcuts and new sheets went behind them. Minors: a doubled toast; a full report for a tag save that changed nothing |
