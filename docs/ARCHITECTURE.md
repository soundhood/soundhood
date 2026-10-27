# Architecture

Soundhood is a local-first music player with a user-invoked YouTube capture helper. One library,
owned by the user as plain files, played the same way on a Windows PC and an Android phone
(Linux and macOS builds are produced too; iOS is deferred, see [DECISIONS](DECISIONS.md)).

The shape is **one Rust core + thin native hosts + one React UI**.

```
<repo>/
  Cargo.toml                 workspace: core, app/src-tauri, app/src-tauri/plugins/*
  core/                      soundhood-core: Rust library, no Tauri, no UI, no tokio runtime of its own
  app/src-tauri/src/         Tauri host: commands are thin wrappers over core; desktop player,
                             media keys, tray, hotkey, sidecar manager
  app/src-tauri/plugins/
    soundhood-ytdl/          Kotlin: yt-dlp on the phone, the 127.0.0.1 relay, rclone (Proton), netcheck
    soundhood-player/        Kotlin: Media3 playback service (from Phase 3)
  app/src/                   React UI, one component tree for phone and desktop
  scripts/                   owner-facing PowerShell wrappers and the Android patch script
  tools/                     CI scripts, screenshot harness, lints, fixture tooling
  docs/                      this documentation; evidence/<phase>/ holds fixture-library screenshots
```

## The library model

The user's folders are the truth; the app is a view and a careful editor of them.

| Layer | Where it lives | Who writes it |
|---|---|---|
| Identity (who a track is) | tags inside each audio file | only `core::ingest::tagwrite` |
| Membership (which playlists) | `_Playlists/*.m3u8`, root-relative, forward slashes | only the m3u8 sole-writer path |
| Location | folders | the user; the app never restructures them |
| App bookkeeping | `_Soundhood/**`, one file per device | the app, append-only or union-merged |
| Index | per-device SQLite in app data | rebuildable cache, never a source of truth |

Deleting the index and running **Rebuild index** reproduces the same library from the files alone.
The on-disk formats are specified in [LIBRARY_FORMAT](LIBRARY_FORMAT.md).

## soundhood-core

`core/` compiles for Windows, Linux, macOS and `aarch64-linux-android`. It owns no async runtime:
plain functions, `std::fs`, `rayon`. HTTP (behind the `online` feature) uses `ureq` with rustls and
bundled webpki roots, because the Android system certificate store is not readable from Rust.

| Module | Responsibility |
|---|---|
| `model` | `Track`, `RelPath` (NFC, forward slashes), ids, shared value types |
| `fs` | root handling, rel_path <-> absolute, NFC canonicalisation, scan, same-volume staging move, orphan-temp cleanup, Android bin |
| `tags` | lofty wrapper: read, and the verified write used by `tagwrite` |
| `index` | rusqlite (bundled, FTS5), `schema.sql` + numbered migrations, change detection, queries |
| `playlist` | m3u8 read/write (write-then-rename), membership updates on move/rename/delete, player state |
| `ingest` | `tagwrite` (the one write path), per-device journal, undo; later the ingest state machine and normaliser |
| `analyse` | decode, audio hash, fingerprint, loudness (Phase 2) |
| `enrich` | AcoustID, MusicBrainz, Cover Art Archive (Phase 4, feature `online`) |
| `lyrics` | LRC, LRCLIB, alignment (Phase 5) |
| `ytdlp` | argument builder, progress/error parsing, sidecar pins (pure functions) |
| `sync` | `SyncProvider`, two-round sync planner (Phase 2 stub, Phase 6 full) |
| `snapshot` | the JSON library snapshot the Android playback service reads (Phase 3) |
| `api.rs` | the surface hosts call; only the lead edits it |

Process spawning, threads, events and platform paths belong to the hosts. Kotlin never touches tags:
Rust does, on both platforms, through direct file paths (this is why the phone keeps All-files access).

## The one write path

Every write to a **user file** (audio files and `_Playlists/**/*.m3u8`) goes through
`core::ingest::tagwrite`. Writes fall into three tiers:

| Tier | What | Mechanics |
|---|---|---|
| 1 | tag write / rename / move / delete of an audio file | tagwrite + journal + verify + a batch report with Undo |
| 2 | m3u8 edits from one interactive gesture | sole-writer m3u8 path (write-then-rename) + journal entry; Undo from a toast |
| 3 | `.lrc` sidecars, `_Soundhood/**`, per-device caches | write-then-rename; no journal; never auto-deleted |

A tier-1 write: journal pre-image (`committed:false`) -> copy to a hidden `.soundhood-tmp-<job>`
in the same folder -> write tags on the copy -> re-read and verify -> fsync -> atomic rename over the
original (sharing-violation retries) -> journal `committed:true` with before/after hashes. On every
start, orphaned `.soundhood-tmp-*` files whose journal entry never committed are removed.
Deletes go to a bin: the OS recycle bin on desktop (`trash` crate), `_Soundhood/.bin/<yyyy-mm>/<rel_path>`
on Android. Every delete is journaled.

## Hosts

- **Desktop (Tauri)**: commands wrap core; yt-dlp + deno run as sidecars verified against upstream
  checksums ([LEGAL](LEGAL.md)); playback moves to libmpv (runtime-loaded) in Phase 3 with the HTML5
  engine kept as a fallback.
- **Android (Tauri + Kotlin plugins)**: `soundhood-ytdl` runs yt-dlp (youtubedl-android), the in-app
  relay proxy and rclone for Proton Drive; from Phase 3 `soundhood-player` hosts a Media3
  `MediaLibraryService` and the webview becomes a remote control.

## Shared state between devices

Everything under `_Soundhood/` is one file per device (download queue, journal, plays, lyrics queue,
device state), append-only or union-merged on read. Two devices never write the same file.
Proton Drive is the only sync: the Proton app mirrors the library root on the PC; on the phone the app
runs rclone's `protondrive` backend.

## Build and release

Semver; each phase merge bumps the minor in merge order; Phase 7 sets 1.0.0. CI gates are listed in
[DEV](DEV.md) and [TESTING](TESTING.md). One signing key for every APK installed on the phone.
