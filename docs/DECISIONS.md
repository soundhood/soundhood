# Decisions

Each entry: date, decision, reason, evidence. Entries marked **decided** in the build brief are not
re-litigated; later entries may refine them. Newest phase at the bottom of each section.

## Settled before the rebuild

| Date | Decision | Reason | Evidence |
|---|---|---|---|
| 2026-01 | Tauri 2 + React + Rust (not Electron) | small installer, Rust for tags and files, mobile target | the app ships on Windows and Android from one codebase |
| 2026-09-08 | Library model: identity in tags, membership in `_Playlists/*.m3u8` (root-relative, forward slashes), folders are storage only; the app is the sole writer of `_Playlists` | playlists become a cheap, mergeable set; nothing needs to move on disk | 29 playlists in daily use since Sept 2026 |
| 2026-09-08 | Any batch that writes into the library ships with a snapshot, a conservative default and a modal report the user can undo | one early batch tag-write damaged 349 files (all restored from a snapshot) | incident record; this is "the 349 rule" |
| 2026-09-09 | Phone downloads: youtubedl-android 0.18.1 behind a Kotlin plugin, all yt-dlp traffic through an in-app 127.0.0.1 relay | Python's own networking stalls on the test phone while the Java stack works | downloads work on the phone since 2026-09-09 |
| 2026-09-09 | Phone sync: rclone `protondrive` backend inside the app; on the PC the Proton Drive app mirrors the library | Proton Drive's Android app exposes no files to other apps; Syncthing rejected by the owner | first phone login to Proton worked 2026-09-09 |
| 2026-10-13 | Desktop yt-dlp gets `--cookies <app config>/cookies.txt` when that file exists | YouTube's bot wall on the home connection | confirmed working 2026-10-13 |

## Rebuild (from 2026-10-27)

| Date | Decision | Reason | Evidence |
|---|---|---|---|
| 2026-10-27 | **Decided:** keep Tauri 2 and restructure (Rust core + thin hosts + one React UI) rather than rewrite in Flutter or React Native | every hard problem lives in a Kotlin layer any framework would need; the Rust core and the UI rules are already proven on both devices | build brief §4.1 |
| 2026-10-27 | **Decided:** files are the truth; SQLite (FTS5) is a per-device, rebuildable index | "Rebuild index" must always produce the same library from the files alone | build brief §1.1 |
| 2026-10-27 | **Decided:** on desktop, yt-dlp and deno are fetched from upstream on first enable and verified against the release's published checksums, instead of being redistributed; ffmpeg (LGPL build) is bundled | not redistributing yt-dlp; the pin table is a floor, never a ceiling | build brief §1.5, [LEGAL](../LEGAL.md) |
| 2026-10-27 | **Decided:** Proton Drive is the only sync; Syncthing, Google, Dropbox, iCloud, WebDAV and LAN sync are out | owner requirement | build brief §1.3 |
| 2026-10-27 | **Decided:** Android playback moves to a Media3 `MediaLibraryService`; the webview becomes a remote control | lock screen, Bluetooth, process death, Android Auto | build brief §4.4 |
| 2026-10-27 | **Decided:** iOS is deferred: sandbox-only file access, no yt-dlp/rclone, CarPlay needs an Apple entitlement, a paid developer account is needed. `core` stays free of desktop-isms and `PlayerBackend` free of Android-isms so a Swift host stays possible | not viable for a sideloaded personal app | build brief §5 |
| 2026-10-27 | **Decided:** versioning by merge order: each phase merge to `main` bumps the minor; only Phase 7 sets 1.0.0 | Phases 2 and 3 may land in either order | build brief §4.8 |
| 2026-10-27 | Baseline: the October working tree (cookies, rclone tuning, tag cache) committed as `1bc30ab` on top of `53b33fb` before any rebuild work | start from what runs on both devices | `git log` |
| 2026-10-27 | Baseline builds from a clean tree: desktop NSIS installer 3m08s, Android release APK 4m29s, both green; the release APK comes out **unsigned** | signing must be wired in Phase 0 so one key installs over the existing app | build logs |
