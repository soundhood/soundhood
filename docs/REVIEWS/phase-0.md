# Phase 0 review

Charters: [README](README.md). Round 1 ran on `bca3e4c` (2026-10-27/28); fixes landed in a fix wave;
round 2 re-checks every blocking item and the fixes.

## Round 1 — build gate (`bca3e4c`)

Clean clone, both targets built, nothing installed.

| Check | Result |
|---|---|
| Windows build from a clean clone | 9m00s; NSIS 55.6 MB, MSI 70.5 MB; `soundhood-tools.exe` ships next to the app |
| Android release APK from a clean clone | 6m23s; 84.8 MB, arm64; signed by this PC's debug key (SHA-256 `73abd93e…c48de47f45`, v2) |
| Self-test (CLI and in-app) | 18 passed, 0 failed |
| Visual suite / blue scan / hygiene lint | 10/10 / 0 failing / 0 findings |
| Real library, read-only session (gate identity) | 2,398 tracks, 29 playlists (2,400 lines); first scan 1.2 s (debug build), warm 0.18 s; manifest before vs after **Identical**; full listing of 3,500 entries unchanged; no `_Soundhood`, no temp files |
| Fixture library, desktop runtime checklist | write + undo, move + undo (m3u8 bytes exact), delete + undo, rebuild index, diagnostics without user paths: all as specified |

Findings: **blocking** — a "nothing to change" single op (save tags unchanged, add a track already in
the playlist, create an existing playlist) returned an error instead of success. **Major** — undo of a
desktop delete took 22–72 s with a 10k-item Recycle Bin; the Folder line showed the test library's
absolute path (account name) in screenshots. Minor: error strings carried variant prefixes; tag undo
restores values, not bytes; permission files show as modified after a build; stale docs; self-test did
not exercise the write path.

## Round 1 — break the library

Held up: every user-file writer in core is `pub(crate)` and reached only from `ingest`; the journal
pre-image is fsync'd before the file is touched; nothing in the host, UI or plugin writes a user file
directly; open/scan/rebuild write nothing into the library; the lossless writer was lossless on all 32
real files it wrote (copies), refused the 8 it could not keep; read-only skips, the 3-failure abort,
kill tests, the Android bin, companions, case-only and NFD renames, undo twice all behaved.

Findings: **blocking** — OPEN.md did not list the two writers still outside the journal (yt-dlp output,
phone rclone copy). **Major** — no re-check of the file right before the rename (audio and m3u8): an
edit arriving through sync in that window was overwritten; a crash after the rename but before the
commit line left a change Undo could not reach; foreign-format playlists lost their extra lines on the
first edit; multi-valued tags lost values on undo. Minor: startup cleanup removed any
`.soundhood-tmp-*` name (even a user's own file); an unreadable sub-folder stopped `open`; exclusive
handles reported as failures; refusal reasons showed the temp's absolute path; check-then-rename;
recycle-bin edge volumes unverified; multi-select operations are N batches.

## Round 1 — break the build

Green: core tests (default and all features, 233), clippy in CI form and with all targets/features,
core fmt, cargo-ndk core check, aarch64 clippy of host and plugin, tools and app gates, lints, md-links,
visual suite, both targets incl. the R8 release APK; merged manifest correct; plugin ACL consistent;
`patch-android.py` idempotent on a fresh init.

Findings: **blocking** — CI typechecked the app before installing its packages; the owner's snapshot
wrappers used `$IsWindows`, which fails under Windows PowerShell 5.1. **Major** — release workflow
checked sidecars before building them; DEV.md dev loop and keystore keys wrong; a fresh clone could not
build without `soundhood-tools`; LEGAL/CHANGELOG described Phase 2 behaviour as present.

## Round 1 — break the design

Green: visual suite, token lint (exactly the pre-rebuild violations), blue scan, hygiene lint; no new
native controls, emoji, colours or blue; developer section hidden by default; pixel diffs show only the
sanctioned changes.

Findings: **blocking** — every journaled edit opened the desktop log panel (a visible change); with the
test library shown, phone sync still ran against the real Proton library. **Major** — committed
evidence was mocked Chromium, not the real app; the desktop Copy log button was undocumented and caused
a 4 px horizontal scroll at 760 px; the hygiene lint ignored its configured deny list.

## Round 1 — break the network

**Blocking** — the WebView2 runtime under the desktop app contacted Microsoft at every launch
(experimentation config with a persistent client id, component-updater checks, NEL policy, WPAD
lookups) and opened one more TLS connection outside Chromium's stack. **Major** — LEGAL.md described
unbuilt features in the present tense; the bundled yt-dlp was below the pinned floor; the download queue
kept requesting after a refusal; channel links were not refused; the phone relay has no auth token.
Minor: sidecar loopback check by string prefix; no asset size cap; deno extraction took the first match
at any depth; the error classifier matched song titles.

## Dispositions

| Item | Disposition |
|---|---|
| All 7 blocking items | fixed in the fix wave; re-checked in round 2 |
| Re-check before rename (audio, m3u8), crash recovery, foreign playlists, multi-value tags | fixed |
| Recycle-bin undo speed, test-library path, error strings, cleanup scope, refusal messages, no-replace rename | fixed |
| Release workflow, DEV.md, fresh clone, LEGAL/CHANGELOG, evidence, Copy log docs, hygiene deny list | fixed |
| WebView2 traffic | browser flags added; anything that remains is listed in DECISIONS and LEGAL |
| Bundled yt-dlp below floor, queue after refusal, channel links, sidecar hardening, classifier | fixed |
| Phone relay auth token | **accepted for Phase 0**: it changes the proven relay and cannot be tested without the phone; Phase 2, tracked in OPEN |
| Tag undo restores values, not bytes | **accepted for Phase 0** (DoD: "undoes cleanly"); Phase 2 decides on a byte pre-image store; tracked in OPEN |
| MP3 refusals (7 of 8 real yt-dlp MP3s), lofty m4a panic (1 of 32) | **accepted**: refused, never damaged; Phase 2 own ID3v2 serialiser; tracked in OPEN |
| Multi-select = N batches | **accepted**; Phase 1/2 batch IPC; tracked in OPEN |
| Phone checks, device evidence, Rebuild index < 2 min on the phone | owner-verified; tracked in OPEN |
