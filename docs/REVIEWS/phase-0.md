# Phase 0 review

Charters: [README](README.md). Round 1 ran on `367a478` (2026-10-27/28); fixes landed in a fix wave;
round 2 re-checks every blocking item and the fixes.

## Round 1: build gate (`367a478`)

Clean clone, both targets built, nothing installed.

| Check | Result |
|---|---|
| Windows build from a clean clone | 9m00s; NSIS 55.6 MB, MSI 70.5 MB; `soundhood-tools.exe` ships next to the app |
| Android release APK from a clean clone | 6m23s; 84.8 MB, arm64; signed by this PC's debug key (SHA-256 `73abd93e…c48de47f45`, v2) |
| Self-test (CLI and in-app) | 18 passed, 0 failed |
| Visual suite / blue scan / hygiene lint | 10/10 / 0 failing / 0 findings |
| Real library, read-only session (gate identity) | 2,398 tracks, 29 playlists (2,400 lines); first scan 1.2 s (debug build), warm 0.18 s; manifest before vs after **Identical**; full listing of 3,500 entries unchanged; no `_Soundhood`, no temp files |
| Fixture library, desktop runtime checklist | write + undo, move + undo (m3u8 bytes exact), delete + undo, rebuild index, diagnostics without user paths: all as specified |

**Blocking** findings: a "nothing to change" single op (save tags unchanged, add a track already in
the playlist, create an existing playlist) returned an error instead of success. **Major**: undo of a
desktop delete took 22 to 72 s with a 10k-item Recycle Bin; the Folder line showed the test library's
absolute path (account name) in screenshots. Minor: error strings carried variant prefixes; tag undo
restores values, not bytes; permission files show as modified after a build; stale docs; self-test did
not exercise the write path.

## Round 1: break the library

Held up: every user-file writer in core is `pub(crate)` and reached only from `ingest`; the journal
pre-image is fsync'd before the file is touched; nothing in the host, UI or plugin writes a user file
directly; open/scan/rebuild write nothing into the library; the lossless writer was lossless on all 32
real files it wrote (copies), refused the 8 it could not keep; read-only skips, the 3-failure abort,
kill tests, the Android bin, companions, case-only and NFD renames, undo twice all behaved.

**Blocking** findings: OPEN.md did not list the two writers still outside the journal (yt-dlp output,
phone rclone copy). **Major**: no re-check of the file right before the rename (audio and m3u8): an
edit arriving through sync in that window was overwritten; a crash after the rename but before the
commit line left a change Undo could not reach; foreign-format playlists lost their extra lines on the
first edit; multi-valued tags lost values on undo. Minor: startup cleanup removed any
`.soundhood-tmp-*` name (even a user's own file); an unreadable sub-folder stopped `open`; exclusive
handles reported as failures; refusal reasons showed the temp's absolute path; check-then-rename;
recycle-bin edge volumes unverified; multi-select operations are N batches.

## Round 1: break the build

Green: core tests (default and all features, 233), clippy in CI form and with all targets/features,
core fmt, cargo-ndk core check, aarch64 clippy of host and plugin, tools and app gates, lints, md-links,
visual suite, both targets incl. the R8 release APK; merged manifest correct; plugin ACL consistent;
`patch-android.py` idempotent on a fresh init.

**Blocking** findings: CI typechecked the app before installing its packages; the owner's snapshot
wrappers used `$IsWindows`, which fails under Windows PowerShell 5.1. **Major**: release workflow
checked sidecars before building them; DEV.md dev loop and keystore keys wrong; a fresh clone could not
build without `soundhood-tools`; LEGAL/CHANGELOG described Phase 2 behaviour as present.

## Round 1: break the design

Green: visual suite, token lint (exactly the pre-rebuild violations), blue scan, hygiene lint; no new
native controls, emoji, colours or blue; developer section hidden by default; pixel diffs show only the
sanctioned changes.

**Blocking** findings: every journaled edit opened the desktop log panel (a visible change); with the
test library shown, phone sync still ran against the real Proton library. **Major**: committed
evidence was mocked Chromium, not the real app; the desktop Copy log button was undocumented and caused
a 4 px horizontal scroll at 760 px; the hygiene lint ignored its configured deny list.

## Round 1: break the network

**Blocking**: the WebView2 runtime under the desktop app contacted Microsoft at every launch
(experimentation config with a persistent client id, component-updater checks, NEL policy, WPAD
lookups) and opened one more TLS connection outside Chromium's stack. **Major**: LEGAL.md described
unbuilt features in the present tense; the bundled yt-dlp was below the pinned floor; the download queue
kept requesting after a refusal; channel links were not refused; the phone relay has no auth token.
Minor: sidecar loopback check by string prefix; no asset size cap; deno extraction took the first match
at any depth; the error classifier matched song titles.

## Dispositions

| Item | Disposition |
|---|---|
| All 7 blocking items | fixed in the fix wave; re-checked in round 2 |
| Re-check before rename (audio, m3u8), crash recovery, foreign playlists, multi-value tags | fixed |
| Test-library path, error strings, cleanup scope, refusal messages, no-replace rename | fixed |
| Recycle-bin undo speed | improved (72 s to 17 s cold, 23 s to 5 s warm on a 10k-item bin); the remainder is the trash crate's listing, tracked in OPEN |
| Release workflow, DEV.md, fresh clone, LEGAL/CHANGELOG, evidence, Copy log docs, hygiene deny list | fixed |
| WebView2 traffic | browser flags added; anything that remains is listed in DECISIONS and LEGAL |
| Bundled yt-dlp below floor, queue after refusal, channel links, sidecar hardening, classifier | fixed |
| Phone relay auth token | **accepted for Phase 0**: it changes the proven relay and cannot be tested without the phone; Phase 2, tracked in OPEN |
| Tag undo restores values, not bytes | **accepted for Phase 0** (DoD: "undoes cleanly"); Phase 2 decides on a byte pre-image store; tracked in OPEN |
| MP3 refusals (7 of 8 real yt-dlp MP3s in round 1, 4 of 5 in round 3) | **accepted**: refused, never damaged; Phase 2 own ID3v2 serialiser; tracked in OPEN |
| lofty m4a panic | found deterministic in round 2 (any MP4 tag that shrinks by exactly 8 bytes, incl. Undo); **fixed** by a one-line patch of the vendored lofty (`third_party/lofty`), test 7/8/9/16 bytes; OPEN until upstream ships it |
| Multi-select = N batches | **accepted**; Phase 1/2 batch IPC; tracked in OPEN |
| Phone checks, device evidence, Rebuild index < 2 min on the phone | owner-verified; tracked in OPEN |

## Round 2 (`2dba0c7`, version 0.2.0)

Every round-1 condition was re-checked by running it.

| Reviewer | Result |
|---|---|
| Build gate | **signed**. Clean-clone builds: NSIS `Soundhood_0.2.0_x64-setup.exe`, APK versionName 0.2.0 / versionCode 2000, signer `73abd93e…c48de47f45`; installer payload carries yt-dlp `f5389d36…` (2026.10.26) and deno 2.9.8 (exe `92439780…`). The four "nothing to change" calls return Ok; an edit right after creating the test library applies; refusals are plain text without paths; self-test 28/0. Real library, read-only session: manifest **Identical**, 3,500-entry listing unchanged |
| Break the build | **signed**. Fresh-tree CI order passes (the old order gave 692 TS errors); the owner's snapshot blocks print "Identical" under Windows PowerShell 5.1; release order with a real verified fetch passes. New: one race test flaky (1 to 3 % under load) |
| Break the design | **signed**. In the real WebView2 build no edit opens the log panel (content top 150.8 px throughout); test-library sync is off in the UI and refused by the plugin; 0 px horizontal scroll at 760 px. New: committed gate screenshots predated the fixes |
| Break the network | **signed**. 5 launches x 150 s (release and debug): **0 remote connections**, net logs hold only `tauri.localhost`, `ipc.localhost`, `asset.localhost` (round 1: Edge config service, component updater, WPAD, Microsoft-account endpoints). New: the phone's channel rule was narrower than the PC's (11 of 49 URL shapes) |
| Break the library | **not signed**: the accepted m4a panic was deterministic (exact 8-byte shrink; Undo failed on 30 of 37 real copies); startup recovery could adopt a change made by other means |

Round-2 fixes: lofty patched (vendored), recovery decides an open entry once and finishes a tag edit only
on the exact hash journaled right before its rename, the race test made deterministic (the probabilistic
version is kept as an ignored probe), one channel rule (the core's) on PC, phone and UI with one
sentence and 92 shared test URLs, gate screenshots re-captured from the fixed build, build script order
(tools built before the fetch), deno held to its executable hash, docs and OPEN rows.

## Round 3 (`622320b`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. 303 core tests; recovery probes: 55 crash-before-rename cases never adopted a different change, a second start wrote nothing; crash after the rename recovered and undone in 5/5 formats. Real world: 40 copies, title +8 bytes: 36 applied (lossless: audio, every other atom and frame identical), 4 MP3s refused, 0 failed; Undo 36/36 (values and audio restored); 28 of 35 m4a took the formerly panicking path. Sources unchanged 40/40 |
| Regression sweep (late changes in the build, design and network areas) | **signed**. Channel parity: 202 URLs through core, `build()`, the plugin's `check_download` and the UI: 0 disagreements; fresh-tree `build-windows.ps1` builds the tools first, fetches once, verifies; `sidecars.mjs check` fails on a deno with one byte appended; gate screenshots blue-clean |

Remaining minors were fixed in the merge commit (docs, the decisions table, the hygiene lint scope on
vendored code) or recorded in [OPEN](../OPEN.md) (unix recovery unlink window; the recycle-bin test runs
only by hand).

Signed: build gate, break the build, break the design, break the network (round 2, `2dba0c7`);
break the library, regression sweep (round 3, `622320b`). Phase 0 merges as 0.2.0.
