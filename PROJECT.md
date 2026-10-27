# Soundhood

## One line

A local-first music player with an optional, user-invoked download helper: one library of plain
files, played and edited the same way on the PC and the phone.

## Principles

- **Files are the truth.** Who a track is lives in its tags; which playlists it is in lives in
  `_Playlists/*.m3u8`; folders are storage only and the app never restructures them. Any database is
  a cache that can be rebuilt from the files alone.
- **Never damage the library.** Every change to a music file or playlist is journaled before it
  happens, verified, applied atomically and can be undone. Bulk tools start as a dry run, and a batch
  ends with a report you can undo. Nothing is deleted except to a bin.
- **No accounts, no telemetry.** No analytics, no crash reports, no update pings. The network is used
  only for what the user started or switched on.
- **Proton Drive is the only sync.** On the PC the Proton Drive app mirrors the library folder; on the
  phone the app syncs through rclone. Sync stays optional.
- **PC and phone at parity.** One component set, one look; differences come only from screen size and
  pointer type.
- **Keyboard-first on the PC, touch-first on the phone.** Shortcuts are documented, never shown as
  on-screen legends; a tap plays.
- **Transparent tooling.** Plain file formats, documented ([LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md)),
  readable by other players and tools.

## How it should feel

Musicolet is the functional reference, Spotify the layout reference.

- Everything is one gesture away; adding to the queue is always one gesture faster than playing now.
- The queue is first-class: visible one tap or one key away, editable, savable as a playlist, kept
  across restarts.
- Search is instant and covers songs, artists, playlists and folders.
- Actions live where the hand already is: on the row (right-click or the row's menu), on the keyboard,
  and for a whole selection at once.
- Defaults do not fight the user: nothing appears in the library that the user did not ask for, and
  nothing interrupts a download with questions; clean-up proposals wait in one place (Tidy).
- Folders stay browsable exactly as they are on disk.

## Scope

Windows and Android fully. By Phase 7, Linux is built and smoke-tested in CI and macOS is built but
untested on hardware. iOS is deferred: a sideloaded app there gets neither the file access nor the
download helper this design needs.

## Phases

Each phase merged to `main` bumps the minor version, in merge order ([CHANGELOG](CHANGELOG.md)).

| Phase | Goal |
|---|---|
| 0 | Foundation: shared Rust core, one journaled write path with undo, SQLite index, fixtures, CI, docs; no visible change except "Undo last change" |
| 1 | Design system and PC/phone parity |
| 2 | Add music: land downloads at once, tidy later; rename rules, clean-ups, duplicates, the bin, a sturdier download helper |
| 3 | Listen anywhere: native playback on the phone (lock screen, Bluetooth, car), gapless playback and media keys on the PC |
| 4 | A growing library: search with filters, smart playlists, play history, metadata lookups |
| 5 | Lyrics: synced lyrics, honest "generated" transcripts made on the PC |
| 6 | Sync hardening: the two-round Proton Drive plan ([LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md#sync-plan-planned-phase-6)) |
| 7 | Packaging and 1.0.0: installers for Windows, Linux and macOS from CI |

## Not goals

- Hosting, streaming or redistributing music.
- Getting around DRM, accounts or paywalls.
- Downloading whole channels: a playlist link is the ceiling.
- Any sync other than Proton Drive.
