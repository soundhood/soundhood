# Changelog

All notable changes to Soundhood are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions follow merge order: each phase merged to `main` bumps the minor version, whatever the
phase's number, and only Phase 7 sets 1.0.0 ([DEV](docs/DEV.md#versions-and-releases)).

| Version | Phase | Tagged |
|---|---|---|
| 0.2.0 (planned) | Phase 0: foundation | not yet |
| 0.1.0 | the app before the rebuild | never tagged |

## [Unreleased]

Planned as 0.2.0, Phase 0: foundation. The app looks the same; what changes is how it writes to your
files.

<!-- The lead trims this list to what actually merged before tagging v0.2.0. -->

### Added

- "Undo last change": a row in the phone's settings sheet and a button on the PC that name the last
  change made on that device in plain words and take it back as a whole.
- A per-device change journal in `_Soundhood/journal/`: every tag edit, move, delete and playlist
  change is recorded before the file is touched
  ([LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md#the-journal)).
- An app-managed bin on the phone (`_Soundhood/.bin/`), so deletes on the phone can be undone.
- On every start, temp files left by an interrupted write are cleaned up.
- A SQLite index with full-text search replaces the JSON tag cache; "Rebuild index" rebuilds it from
  the files alone.
- Library snapshots: `soundhood-tools manifest` and PowerShell wrappers that take a snapshot and
  compare two in one line ([OWNER_GUIDE](docs/OWNER_GUIDE.md#take-a-library-snapshot-and-compare-two)).
- The fixture library, the "Use fixture root" developer switch and "Run self-test".
- The desktop sidecar manager: yt-dlp and deno are fetched from upstream and verified against their
  published checksums instead of being shipped in the installer ([LEGAL](LEGAL.md)).
- CI on every pull request, and a tag-triggered release workflow (skeleton).
- Documentation: [DEV](docs/DEV.md), [LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md),
  [TESTING](docs/TESTING.md), [OWNER_GUIDE](docs/OWNER_GUIDE.md), [OWNER_TESTS](docs/OWNER_TESTS.md),
  [OPEN](docs/OPEN.md) and this changelog.

### Changed

- Every write to a music file or a playlist goes through one write path: journal entry first, then a
  hidden temp copy, verification, an atomic replace, and the commit entry.
- Deleting a track on the phone moves it to the app's bin instead of erasing it.
- The Rust code is a Cargo workspace with a separate `soundhood-core` crate; build output moves to
  `<repo>/target/`.
- Tauri 2.12; the tag library moves to lofty 0.25.
- Every APK installed on the phone is signed with one key, kept outside the repository.
- [LEGAL](LEGAL.md) states the legal framing honestly and documents how the download helper is
  verified.
- Folder rules, screens and keyboard shortcuts rewritten to match the app.

### Removed

- The PC's "Tags ← names" batch button; it returns as Tidy in a later phase, with previews and undo.
- Obsolete planning documents (roadmap, UX mapping, UX notes) and the UI template's README.

## [0.1.0] - 2026-10-27

The app as it stood when the rebuild started.

### Added

- A Windows app and an Android app from one Tauri 2, React and Rust codebase.
- Library scan with tags (title, artist, duration); Playlists, Artists and Folders views; sorting;
  multi-select.
- Playlists as `.m3u8` files in `_Playlists/` (a song can be in many); "Make playlists from folders".
- Tag editor; move and delete keep playlists consistent; deletes go to the Recycle Bin on the PC.
- YouTube downloads on the PC (yt-dlp with deno) and on the phone (youtubedl-android behind an in-app
  relay), into a chosen folder and playlists; an optional cookie file on the PC.
- Android share target, a download queue shared between devices, mini and full player, lock-screen
  media controls.
- Proton Drive sync on the phone through rclone.
