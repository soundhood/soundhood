# Folder rules

What Soundhood does, and never does, with the folders in the library root. The on-disk details are in
[LIBRARY_FORMAT](LIBRARY_FORMAT.md); the reasoning is in [DECISIONS](DECISIONS.md).

## Core rules

1. **The app never restructures your folders.** It does not create, rename, merge or empty folders on
   its own, and it never moves a file you did not ask it to move.
2. **Folders are storage, nothing more.** Where a file sits says nothing about what it is or which
   playlists it is in.
3. **Identity comes from tags.** Title and artist are read from the tags inside each file; the Artists
   view is built from tags across every folder.
4. **Membership comes from playlist files.** Playlists are `_Playlists/<name>.m3u8` text files; a song
   can be in any number of them without being copied or moved. The app is the only writer of
   `_Playlists`.
5. **One library root.** This version supports a single root folder, chosen in the app. The index is
   ready for several roots later; nothing else assumes more than one.

## Views

- **Playlists:** one entry per file in `_Playlists/`.
- **Artists:** derived from tags, across all folders.
- **Folders:** a plain browser of where files are stored. A folder is not a playlist or an album.

## Scanning

- The scan reads; it never writes into the library. The first scan of an existing library changes no
  file, and neither does any later scan.
- It looks at audio files only ([extensions](LIBRARY_FORMAT.md#root-layout)) and skips `_Soundhood/`,
  `_Playlists/`, folders starting with a dot and the app's own temp files.
- When a file has no title or artist tag, the list shows a best guess from the file name. That guess is
  for display only; it is written into the file only if you confirm it (Tidy, planned for Phase 2). A
  folder name never becomes a title or an artist.
- A folder watcher (planned) also only reads: it suggests, it never writes, and it ignores a file whose
  size changed in the last 10 seconds (the Proton Drive client may still be writing it).

## Where downloads land

The **Where should this go?** sheet asks for one folder and any number of playlists. Every file from
the link (one song, or each song of a playlist link) lands in that folder and joins those playlists.
A playlist link never creates a folder of its own. A new folder is created only when you type its name
in that sheet.

## Moving, renaming and deleting

- Only when you ask, one action at a time or as a selection you made.
- Playlists follow: a moved or renamed file keeps its place in every playlist, in the same journaled
  batch.
- Deletes go to a bin (the Recycle Bin on the PC, `_Soundhood/.bin` on the phone) and can be undone
  ([LIBRARY_FORMAT](LIBRARY_FORMAT.md#bins)).

## Name clashes

- An existing file is never overwritten, and never renamed to make room.
- A new file whose name is taken gets ` (2)`, ` (3)` and so on. The check ignores letter case, because
  Windows does.

## Make playlists from folders

A one-time import, run only when you choose it: it creates one playlist per first-level folder,
listing that folder's songs. It never overwrites a playlist that already exists and moves no file.
