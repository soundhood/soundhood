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

## Phase 0

| Date | Decision | Reason | Evidence |
|---|---|---|---|
| 2026-10-27 | Root Cargo workspace (`core`, `app/src-tauri`, the ytdl plugin); `Cargo.lock` moves to the root, so build artefacts move from `app/src-tauri/target/` to `<repo>/target/` | one lock and one target dir for core + hosts | `cargo check --workspace` green |
| 2026-10-27 | Rust style is 2-space indentation, 120 columns (`rustfmt.toml`) | matches the existing host code | — |
| 2026-10-27 | Pinned for Phase 0: tauri 2.12.5, lofty 0.25.5, rusqlite 0.41.0 (`bundled`), symphonia 0.6.1, blake3 1.8, ureq 3.5 (rustls + webpki roots), sha2 0.11, zip 9, image 0.25 | current stable releases; versions verified on crates.io the same day | crates.io API |
| 2026-10-27 | symphonia 0.6 has **no Opus decoder**: the write path verifies Opus files through lofty's stream properties instead of a decode; "Analyse library" will treat Opus like HE-AAC (ffmpeg fallback on desktop with its own `audio_hash_version`, "not analysed" on the phone) | the brief listed an `opus` feature that does not exist | symphonia 0.6.1 feature list |
| 2026-10-27 | `soundhood-core` compiles for `aarch64-linux-android` with the bundled SQLite and blake3's C/asm backends; blake3 `pure` is not needed | NDK 30 + cargo-ndk 4.1.2 | `cargo ndk -t arm64-v8a check -p soundhood-core` green in 14 s |
| 2026-10-27 | Commits from the rebuild are authored as "Soundhood" (repo-local `user.name`); the existing GitHub no-reply address stays, so GitHub still links them to the owner's account. Older history keeps its author names; rewriting public history is left to the owner | the public repo should not carry the owner's name | `git config user.name` |
| 2026-10-27 | **Refines brief §4.2/§5.1:** a stored path keeps its on-disk characters; NFC is applied only to comparison keys (`RelPath::key`) and to names the app creates itself. Re-serialising an existing playlist must be byte-identical | the real library holds an NFD file name whose playlist line is NFD too; NTFS treats NFC and NFD names as different files, so normalising would orphan the track | read-only library survey: 29 playlists, 2,400 lines, 0 unresolved, 1 NFD entry |
| 2026-10-27 | Filename convention read off the owner's files: **all credited artists on the artist side, joined with `", "`, primary first** (Spotify style); `feat.` never on the artist side; `(feat. X)` stays in the title only when the source title had it; `&` and `and` are part of names, never joiners. Stored as `meta.artist_convention = "comma-all"` | 246 of 1,978 strictly conforming names use `", "` on the artist side; 0 use `feat.`/`ft.`/` x `/` / `; 35 `" & "` and 8 `" and "` are band names | read-only survey of 2,398 files (counts only) |
| 2026-10-27 | The effective naming is `Title[ - Version] - Artist[, Artist…]`: 398 of the 420 "non-conforming" names are Spotify-era `Title - Remaster/Remix/Edit - Artist`, and 207 stems are cut at 56 characters. Parsers split on the **last** `" - "`; tags, not filenames, are the source of truth for these files | the brief's ≈517 non-conforming estimate predates this count; most are conforming by this wider rule | same survey: last-separator split yields title + artist for 2,377 of 2,398 |
| 2026-10-27 | The per-device download queue (`download-queue.<device-id>.json` with done-markers) moves to Phase 2 with the ingest work; Phase 0 keeps the single `download-queue.json` exactly as it behaves today | a half-migrated queue would re-download finished links forever on the other device | queue merge semantics in the current UI |
| 2026-10-27 | Known writers still outside the journal after Phase 0, scheduled: yt-dlp output on both devices (creates new files only; Phase 2 ingest), rclone `copy` on the phone (can overwrite a file whose size differs; Phase 6 sync plan with `--ignore-existing` and tombstones). Tracked in [OPEN](OPEN.md) | Phase 0 rewires the commands the brief lists; downloads and sync have their own phases | brief §7 |
