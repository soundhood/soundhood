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

Findings and their dispositions are recorded below once the fix wave lands.
