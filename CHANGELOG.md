# Changelog

All notable changes to Soundhood are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions follow merge order: each phase merged to `main` bumps the minor version, whatever the
phase's number, and only Phase 7 sets 1.0.0 ([DEV](docs/DEV.md#versions-and-releases)).

| Version | Phase | Tagged |
|---|---|---|
| 0.2.0 | Phase 0: foundation | v0.2.0, 2026-10-28 (local) |
| 0.1.0 | the app before the rebuild | never tagged |

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-10-28

Phase 0: foundation. The app looks the same; what changes is how it writes to your files. Everything
below ships in 0.2.0 unless an entry names a later phase. What is not verified yet is in
[OPEN](docs/OPEN.md).

### Added

- "Undo last change": a row in the phone's settings sheet and a button on the PC that name the last
  change made on that device in plain words and take it back as a whole. Deleting or moving several
  selected tracks still counts as one change per track, so Undo brings them back one per press.
- A per-device change journal in `_Soundhood/journal/`: every tag edit, move, delete and playlist
  change made in the app is recorded before the file is touched
  ([LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md#the-journal)). Downloads and phone sync do not go through it
  yet (Phases 2 and 6).
- An app-managed bin on the phone (`_Soundhood/.bin/`), so deletes on the phone can be undone.
- On every start, temp files left by an interrupted write are cleaned up.
- A SQLite index with full-text search replaces the JSON tag cache; "Rebuild index" rebuilds it from
  the files alone.
- Library snapshots: `soundhood-tools manifest` and PowerShell wrappers that take a snapshot and
  compare two in one line ([OWNER_GUIDE](docs/OWNER_GUIDE.md#take-a-library-snapshot-and-compare-two)).
- The fixture library and a hidden developer section ("Use fixture root", "Run self-test", "Rebuild
  index"), opened with 7 taps on the status line on the phone or Ctrl+Alt+Shift+D on the PC. While
  the fixture library is shown, Proton sync is off.
- **Copy log** on the PC, next to Download: it copies the log with the app and device details on top,
  like Copy log on the phone.
- The sidecar manager and `soundhood-tools fetch-sidecars`: fetches the pinned yt-dlp and deno
  releases and verifies them against their published checksums and the pins in the code. In 0.2.0
  the installer still carries yt-dlp and deno, now the pinned, verified versions (the build script
  and the release workflow fetch them before building); from Phase 2 the app fetches them on first
  enable instead and the installer no longer carries them ([LEGAL](LEGAL.md)).
- CI on every pull request, and a tag-triggered release workflow (skeleton until Phase 7).
- Documentation: [DEV](docs/DEV.md), [LIBRARY_FORMAT](docs/LIBRARY_FORMAT.md),
  [TESTING](docs/TESTING.md), [OWNER_GUIDE](docs/OWNER_GUIDE.md), [OWNER_TESTS](docs/OWNER_TESTS.md),
  [OPEN](docs/OPEN.md) and this changelog.

### Changed

- Every write the app makes to a music file or a playlist goes through one write path: journal entry
  first, then a hidden temp copy, verification, an atomic replace, and the commit entry.
- Tag edits change only the fields edited: every other tag, picture and the audio stay byte-for-byte,
  checked twice; a file whose other tags could not be kept exactly (some MP3s, fields with several
  values, playlists another program wrote) is left as it is with a plain reason.
- A file another device changed while the app was writing it, or a file changed in the last few
  seconds, is left alone ("changed since"); a change cut off by a crash is finished on the next start.
- A queued download that fails stops the queue instead of trying the next link.
- Deleting a track on the phone moves it to the app's bin instead of erasing it.
- Links to a whole channel, or to one of its tabs, are refused; a playlist link is the most a
  download takes.
- On Windows the WebView2 runtime that draws the window is started with flags that switch off its
  own calls to Microsoft (configuration service, component updates, proxy auto-detection); see
  [DECISIONS](docs/DECISIONS.md).
- The Rust code is a Cargo workspace with a separate `soundhood-core` crate; build output moves to
  `<repo>/target/`.
- Tauri 2.12; the tag library moves to lofty 0.25.
- Every APK installed on the phone is signed with one key, kept outside the repository.
- [LEGAL](LEGAL.md) states the legal framing honestly, documents how the download helper is
  verified, and marks what arrives in later phases.
- Folder rules, screens and keyboard shortcuts rewritten to match the app.

### Removed

- The PC's "Tags ← names" batch button; it returns in Phase 2 as Tidy, with previews and undo.
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
