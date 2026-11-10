# Changelog

All notable changes to Soundhood are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions follow merge order: each phase merged to `main` bumps the minor version, whatever the
phase's number, and only Phase 7 sets 1.0.0 ([DEV](docs/DEV.md#versions-and-releases)).

| Version | Phase | Tagged |
|---|---|---|
| 0.3.0 | Phase 1: design system and PC/phone parity | not tagged yet |
| 0.2.1 | fix after Phase 0 | v0.2.1, 2026-11-06 (local) |
| 0.2.0 | Phase 0: foundation | v0.2.0, 2026-10-28 (local) |
| 0.1.0 | the app before the rebuild | never tagged |

## [Unreleased]

## [0.3.0] - Phase 1: design system and PC/phone parity

The whole interface is rebuilt on one design system, the same on the PC and the phone: one set of
parts, colours, type and icons, laid out by the size of the window only. How the app writes to your
files does not change.

### Added

- A design system: colours, type sizes, spacing and motion as tokens (`app/src/design/tokens.css`,
  the only file with raw colours), the Inter typeface bundled with its licence, one icon set drawn for
  Soundhood, and every part the screens are made of, each photographed on its own test page at four
  sizes and with reduced motion, more contrast and 130 % text. [DESIGN](docs/DESIGN.md) specifies them.
- A new app icon on every platform: an aqua hood over three equaliser bars, with a white version for
  the tray and notifications and Android's themed icons.
- The PC gets the phone's structure in three panes: a sidebar (resizable, folds to a rail), the list,
  the queue on the right, and a player bar. Narrower windows switch to a rail, then to the phone
  layout, by width alone.
- A real play queue: Play next, Add to queue, drag to reorder, swipe or press Delete to remove, Save
  as playlist, Clear; Repeat (all, one, off). In the right pane on a wide window, a sheet elsewhere.
- Search in one field: the whole library in groups (songs, artists, playlists, folders) with chips;
  with a list open, it filters that list.
- A menu on every song (Play next, Add to queue, Add to playlist, Go to artist, Edit tags, Delete), and
  songs dragged onto a playlist in the sidebar are added to it.
- The keyboard list in [SHORTCUTS](docs/SHORTCUTS.md), all working on the PC.
- One Settings panel on both devices (Ctrl+comma on the PC): Library, YouTube with a Downloader
  switch, Proton Drive on the phone, Appearance with Text size, Tools with Copy log and View log,
  About, and the hidden Developer group at its bottom.
- On the PC, Download in the sidebar and Ctrl+V anywhere open "Where should this go?"; a running
  download shows its progress at the bottom; a failed one shows why, with Copy log and Retry.
- After a tag edit, a move or a delete, a report that stays until closed, with **Undo this batch**
  (a whole selection comes back together); playlist changes show a message with **Undo**.
- First-launch setup in three short steps for a new install (library, online lookups, YouTube helper);
  an existing install skips it and keeps downloading as before.
- Checks: a contrast check of every colour pair, a phone-beside-PC screenshot grid, the screenshot
  suite on the same test library the app's Test library switch installs, and a by-hand network check
  of the PC app before each release.
- The repository hygiene lint refuses en and em dashes in tracked text files, as characters or as
  HTML entities (vendored `third_party/` code excepted), and names the file and line. The ones
  already there are gone from the code, the docs and the app's own text: a status line now reads
  "Proton sync failed (see the log)", like the app's other "see the log" lines, and the shuffle
  button's tooltip "Shuffle is on; click to play in order".

### Changed

- A click or a tap plays a song on every device; the PC's double-click to play is gone. Ctrl+click and
  Shift+click choose songs with a mouse; Select mode chooses them on touch.
- Song lists show the title and artist from the tags.
- The status line is gone: results, errors and progress appear where they belong (a message with
  Undo, the report, an error row, the download's progress, the log).
- The app's `App.tsx` (3,413 lines) is now a shell, hooks and feature folders; no file is over 600
  lines.

### Fixed

- On the PC, choosing another song before the previous one had started could leave the previous
  song playing while the screen showed the new one.
- The cover of the last song stayed in memory after playback stopped.
- Lists no longer redraw four times a second while a song plays.
- The waiting-link Copy said "Link copied" even when the clipboard refused it.
- Deleting songs checked the song that was playing when the delete started, not the one playing when
  it ran.

- Playlist names in another case or Unicode form. On a disk that keeps "Road Trip" and "road trip"
  apart (Linux, some Android storage), adding to or removing from a playlist typed in another case
  found no playlist and was refused; creating or deleting one did the same. Windows keeps the two
  Unicode forms of a name like "Beyonce" with an accent apart too (a Mac writes one, a keyboard the
  other), so there the same happened for a playlist named on a Mac. Every playlist command now
  finds the playlist in any case or form of its name, and a playlist typed in another case on
  Windows keeps its file's own spelling instead of being renamed to the typed one. A name that
  matches two playlists equally loosely (two that differ only in case, on those disks) is refused
  with both names, never decided by the order the disk lists them, and a playlist's exact name
  always means that playlist. On those disks a legacy `.M3U` is refused as legacy and a `.M3U8` as
  another program's file, where a command used to make a second playlist beside the first or
  answer "changed since". A listed playlist whose file name the app would clean (one ending in a
  dot) is refused plainly instead of being taken for another playlist. "Make playlists from
  folders" makes one playlist of two folders whose names differ only in case or form (one line for
  a file name both hold), instead of failing on the second. Found by the first Linux check run.
- Moves into a folder named in another case or Unicode form. A move into `downloads` beside an
  existing `Downloads` made a second folder on those disks, and on Windows a move into `Beyonce`
  with the accent typed beside a folder named on a Mac did the same; that included a move into the
  track's own folder spelled another way, which on Windows was otherwise refused, after a "not
  applied" journal entry, only for a difference in case. Both pairs clash once synced. A move now
  goes into the folder that is there, on every disk, and a move into the track's own folder in any
  spelling is refused before anything is written down. Two folders that already exist side by side
  stay two folders, so a track can still be moved from one into the other; a name that matches two
  of them equally loosely is refused with both names. A move or rename onto a file name that a
  second file in the folder already has in another case or form (a rename that changes only the
  case included) is refused before anything is written down. Where the disk itself did not see the
  clash (case on those disks, Unicode form on Windows) that refusal used to come only after a "not
  applied" journal entry; no file was touched either way. Renaming a file to another case of its
  own name still works. Downloads do not go through this code yet (open item).
- Crash recovery for a delete into the app's own bin, and for its Undo. On a disk with hard links
  (the developer Test library in the phone app's own storage, not the music on shared storage) a
  track or a playlist goes into that bin, and a track back out, by giving it the new name and then
  removing the old one. A crash between the two left the file under both names: the next start
  closed the delete as not applied and left a hidden second name in the bin, or closed the Undo as
  not applied without putting the track back into its playlists. The next start now finishes
  either one, as it already did for a move: the old name goes and the playlists follow. No file
  was lost either way. Also, a delete made in the last moments of a month and recovered a month or
  more later is now found in the bin, and when a name in the bin cannot be looked at during that
  start (as opposed to not being there), the decision waits for the next start instead of being
  closed. Found by review.
- The Linux check run's Android build: the setup step asked for a package the current Android
  command-line tools no longer have, and stopped. Once past it, the NDK that GitHub restored from
  its cache had no C compiler (a known fault of the NDK setup action), so the build stopped again.
  The NDK now comes from Google's own installer, and its compiler is checked before the build. Only
  GitHub's build was affected, never the app.
- GitHub's draft releases: the Linux AppImage and .deb were built but not attached, because the
  attach step's pattern matched their folders. Each package is now named, and a missing one fails
  the run. This has not run on GitHub yet.

## [0.2.1] - 2026-11-06

### Fixed

- Phone: the seek bar in the player sat at 0:00 with a length of 0:00 and could not be dragged. The
  phone plays a song from the file's bytes, and that route never passed the song's length to the
  player. The length now comes from the player itself, whichever route loaded the song, so the bar
  shows the length, moves with the song and seeks where you tap or drag. Present since before the
  rebuild; a phone test now checks it.

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
- The fixture library and a hidden developer section ("Test library", "Run self-test", "Rebuild
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
- Whole YouTube channels are refused on the PC and on the phone, by the same rule: a link to a
  channel or one of its tabs, a YouTube Music artist page or a channel's uploads list. Other pages
  with many items (search results, a hashtag) are not capped yet.
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
