# Screens

The screens as they are in the app today (0.1.x, plus what Phase 0 changes), so docs, tests and
reviews describe the same thing. The phone and the PC share one UI codebase; the layouts differ by
platform. Keyboard: [SHORTCUTS](SHORTCUTS.md). Planned screens are listed at the end.

## Phone

**Top bar.** "Soundhood", the settings button (gear icon) and a one-line status.

**Settings sheet** (opens under the top bar), rows in order:

1. Library: the current folder; a path field with **Use**, and **Rescan**.
2. **Undo last change** with the last change on this phone in plain words (new in Phase 0).
3. Add a link: a link field with **Add** and **Paste**; both open "Where should this go?".
4. Proton Drive: log in (email, password used once, 2FA code), then **Sync now**, **Get new**, **Send
   new**, the last sync time, and disconnect.
5. Download progress with **Cancel** while a download runs.
6. The log.
7. Tools: **Update yt-dlp** with its version, **Network check**, **Download queue (n)**, **Copy log**,
   **Clear log**.
8. Links waiting to download, each with its folder and playlists, copy and remove.

**Browse.** Tabs Playlists, Artists, Folders, each with a filter field. Playlists lists the playlist
files (with "Create playlists from folders" when there are none yet) and **+** for a new one; Artists
lists artists from tags with their track counts; Folders lists the storage folders.

**Tracks.** Back, the title of what is open, and the track list. Toolbar: search, sort (natural,
title A to Z and Z to A, artist A to Z, longest, shortest), **Select** mode, and for a selection: add
to playlist, remove from playlist, move file to (from the Folders tab), edit tags (one track), delete.
A shuffle toggle. Tap a row to play it; in Select mode tap ticks it.

**Bottom block.** The mini player (artwork, title, artist, play/pause, next, a thin progress line) and
the tabs **Playlists, Artists, Folders, Playing**.

**Full player.** Back to the list, where it is playing from, position, large artwork, title and
artist, the time line, shuffle, previous, play/pause, next, and "Add to playlist".

## PC

**Top bar.** "Soundhood", **Import** (pick the library folder), **Rescan**, **Undo** (new in Phase 0;
hovering shows what it will undo) and the status line.

**Download box.** A link field, the folder it lands in (with "+ New folder"), the playlists it joins,
**Download**, **Clear logs** and **Download queue (n)** when links are waiting. The log appears below.

**Browse and tracks side by side.** The same Playlists, Artists and Folders tabs as the phone on the
left; the track list on the right with search, sort, add to playlist, remove from playlist, move file
to, edit tags, delete and shuffle. Click selects (Ctrl and Shift extend the selection), double-click
plays. Double-click a playlist, artist or folder to shuffle-play it.

**Player bar.** Artwork, title, artist and source, "Add to playlist", previous, play/pause, next, the
time line, volume, shuffle and the track position.

Phase 0 removes the **Tags ← names** batch button and its two dialogs; the job returns as Tidy, with
previews and undo.

## Dialogs (both)

- **Where should this go?** The link, the folder it lands in, the playlists it joins; Cancel,
  **Queue**, **Download**.
- **Edit tags.** Title and artist; "From filename" fills the fields from the file name without saving;
  Cancel, **Save**.
- **Delete this playlist?** Only the playlist file goes to the bin; the songs stay.
- **Delete this track? / Delete N tracks?** The files go to the bin (the Recycle Bin on the PC, the
  app's bin on the phone from Phase 0) and playlists are updated; "Undo last change" brings them back.

## Planned

- Phase 1: one design system on both platforms; the PC gets the phone's structure in three panes
  (sidebar, list, an optional right pane), a queue sheet, toasts, and one settings sheet with groups
  (Library, Playback, YouTube, Online lookups, Lyrics, Proton, Appearance, Tools, About); first-launch
  setup in three skippable steps.
- Phase 2: Tidy (proposed renames and clean-ups, possible duplicates, missing art, words to strip, the
  bin).
- Phase 4: search with filter chips, smart playlists.
- Phase 5: the lyrics pane.

There is no Albums view. One is added only if a later decision in [DECISIONS](DECISIONS.md) finds
enough album data in the library to support it.
