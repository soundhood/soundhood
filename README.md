# Soundhood

A local-first music player with a download helper you invoke yourself, for the PC (Windows; Linux
builds too) and the phone (Android). Your files are the library: playlists are small text files,
artists come from tags, folders are only storage. No account with us, no cloud of ours, no DRM
circumvention, no telemetry; the only sync is your own Proton Drive.

## What this is

- A player that treats your own files as the source of truth and edits them carefully: every change
  to a music file or playlist is journaled and can be undone.
- Playlists as plain `.m3u8` files (a song can be in many), artists from tags, folders as storage.
- An optional helper: share or paste a YouTube link, pick a folder and playlists, get a tagged audio
  file (yt-dlp and ffmpeg).
- The same app on the PC and the phone, built from one codebase.

## What this is not

- A streaming service.
- A DRM bypass toolkit.
- A tracker: no accounts, no analytics, no crash reports, no update pings.

## Status

Version 0.1.0 runs on Windows and Android. A rebuild is in progress: Phase 0 (foundation, planned
0.2.0) moves the logic into a shared Rust core with one undoable write path, a SQLite index and CI.
Linux builds come from CI; a macOS build is planned (unsigned, not tested on hardware); iOS is
deferred. What changed: [CHANGELOG](CHANGELOG.md). What is not verified yet: [OPEN](docs/OPEN.md).

## Documentation

- [PROJECT](PROJECT.md): what Soundhood is for, its principles and the phase plan.
- [ARCHITECTURE](docs/ARCHITECTURE.md): one Rust core, thin hosts, one React UI.
- [LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md): exactly what the app keeps on disk.
- [FOLDER_RULES](docs/FOLDER_RULES.md): what the app does and never does with your folders.
- [DEV](docs/DEV.md): building and running on the PC and the phone, signing, CI.
- [TESTING](docs/TESTING.md): tests, lints, evidence.
- [SCREENS](docs/SCREENS.md) and [SHORTCUTS](docs/SHORTCUTS.md): the interface.
- [OWNER_GUIDE](docs/OWNER_GUIDE.md) and [OWNER_TESTS](docs/OWNER_TESTS.md): plain-language
  instructions and hand tests.
- [DECISIONS](docs/DECISIONS.md): what was decided, when and why.
- [LEGAL](LEGAL.md): the legal stance and how the download helper is verified.

## Building

Short version, from `app/`: `npm ci`, then `npm run tauri dev`. Everything else, including the phone,
is in [DEV](docs/DEV.md).
