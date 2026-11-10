# Screens

The screens as they are in 0.3.0 (Phase 1), so docs, tests and reviews describe the same thing. The
phone and the PC run one UI: the same screens and components, laid out by the width of the window
(the shell), never by the platform. Where the two differ there are only two reasons, and each is
named below:

- **The shell's width.** Under 720 px the **phone** layout, 720 to 1079 px the **tablet** layout,
  1080 px and wider the **desktop** layout ([DESIGN](DESIGN.md#layout)). The phone held upright is
  the phone layout; a PC window 1080 px or wider is the desktop layout, and a narrower PC window
  takes the tablet or phone layout like any other.
- **What the host can do.** The phone app syncs with Proton Drive itself (on the PC the Proton Drive
  app mirrors the library), keeps its own bin inside the library (the PC uses the Recycle Bin),
  types the music folder as a path (the PC has a folder picker), updates its own download helper and
  can cancel a download.

Keyboard: [SHORTCUTS](SHORTCUTS.md). Design of every component: [DESIGN](DESIGN.md). Planned screens
are listed at the end.

There is no status line. What you should see now (a result, a refusal, an error) is a toast or a
report; the rest (the scan count, download output, sync lines) goes to the log, which Settings shows
under Tools.

## The shell

**Phone.** One screen at a time. At the bottom the mini player (while a song is loaded) and four
tabs: Playlists, Artists, Folders and Playing (greyed out until a song is loaded). Each list screen
has its title, a settings button (the gear) and, under the title, the search field. The mini player
and the tabs hide under the Playing screen.

**Tablet.** A 72 px rail of icons on the left (Playlists, Artists, Folders, Playing, Download while
the downloader is on, Settings) and the player bar at the bottom. The search field stays under each
screen's title.

**Desktop.** The sidebar on the left: the Soundhood wordmark, the search field, Playlists, Artists,
Folders and Playing with their counts, **Download** while the downloader is on, then "Playlists" with
a new-playlist button and every playlist (the one playing marked with the equaliser), and at the
bottom Settings and the button that folds the sidebar to the rail. Drag its right edge (or use Left
and Right on it) to set its width, 200 to 320 px; the width and the fold are remembered. The main
area in the middle, the queue on the right while it is open, the player bar along the bottom. From
1440 px the main content stops at 1200 px and is centred.

Songs dragged with a mouse from a list onto a playlist in the sidebar are added to it, with a toast
and Undo. Songs the playlist already holds are left out; a drop that adds nothing says so, without
Undo.

**Mini player** (phone). The cover, title and artist, play/pause, next and the queue button, with a
thin progress line on its top edge. A tap or a swipe up opens Playing.

**Player bar** (tablet and desktop). On the left the cover, title and artist, and Add to playlist
(desktop). In the middle shuffle, previous, play/pause, next and repeat (off, all, one) over the time
line. On the right the queue button, mute and the volume slider (desktop), and the button that opens
or closes Playing while a song is loaded. On a tablet the times, the volume and Add to playlist are
left out. Play with nothing loaded starts the queue, or else the list on screen.

## Playlists

A card per playlist file: a mosaic of its first four different covers (one cover when it has fewer,
the playlist icon when it has none), the name, and "N songs, length". The playlist the music was
started from is aqua, with the equaliser. A tap or click opens it; its "more" menu holds Play, Shuffle
and Delete playlist. The header has **New playlist** (a plus button on narrower shells, a labelled
button on the desktop) while a library is open; the desktop also shows the count.

With no library yet the screen says so, with **Open Settings**. With a library but no playlist files,
**Make playlists from folders** makes one playlist per folder; nothing moves on disk.

## Artists and Folders

**Artists** lists every artist named in a tag (a collaboration counts under each name) with a round
cover from one of their songs and their song count; songs without an artist tag are together under
"No artist", last. **Folders** lists where the files are stored: "All songs" first, then each
first-level folder ("Library folder" for files at the top of the library) with its song count. A tap
or click (or Enter) opens the songs. Both lists draw only the rows in view, so a long library stays
quick.

## An open list

A playlist, an artist, a folder or All songs, opened from its screen, the sidebar, a search result or
a song's "Go to artist".

**Header.** Back (narrower shells; the desktop moves on from the sidebar), the title, "N songs,
length" (or "N found" while the search field filters it), and "Test library" while the test library
is shown. A playlist has a "more" menu with Delete playlist; the phone also has the gear. Under the
header: **Play**, **Shuffle**, the sort order (Natural order, Title A to Z, Title Z to A, Artist A to
Z, Longest first, Shortest first; remembered) and **Select**.

**Rows.** The cover, title over artist, the folder (desktop), the length and a "more" button (shown
on hover with a mouse, always on touch). The playing song has an aqua bar and title and the
equaliser. **A single tap or click plays the song**, on every device; there is no double-click. The
list it plays from becomes what Next and Previous step through, in the order shown (its sort, and
the search field's filter while the list is open). With a mouse, **Ctrl+click** and **Shift+click**
choose songs (one more, or a range) without playing anything, and Enter plays the chosen ones.

**Select mode** (Select, on any device): a tap or click ticks a row instead of playing it (Shift+click
ticks a range). The selection bar shows the count, Select all (or Select none), and the actions:
**Add to playlist**, **Remove from** the open playlist (when it holds chosen songs), **Edit tags** (one
song), and under "More actions" **Move to folder** (while a folder or All songs is open, the storage
views) and **Delete**. On narrower shells the bar takes the header's place; on the desktop it sits
above the list. The close button or Esc leaves Select mode. Ctrl+click and Shift+click show the same
bar.

**The row menu.** Opened by the "more" button, a right click, a long press on touch, or the menu key
(or Shift+F10) on a row. It acts on the row's song, or on the whole selection when the row is part of
it: **Play next**, **Add to queue**, **Add to playlist**, **Go to artist** and **Edit tags** (one song),
**Remove from** the open playlist (when it holds them), **Delete**.

Empty lists say why: "This playlist is empty" (pick songs in any list with Select, then Add to
playlist), "Nothing matches" while filtering, "No songs here" otherwise.

## Search

Typing in the search field (the sidebar on the desktop, under the title elsewhere; Ctrl+K or / with
a keyboard) shows the **Search** screen while no list is open: "N results for <text>", chips **All,
Songs, Artists, Playlists, Folders**, and the results in groups (Artists, Songs, Playlists, Folders).
A result matches when its name holds every word typed, ignoring case and accents; songs match on
title, artist and file name. Under All each group shows its first few (five songs, three of the
rest) and "Show all N", which picks that group's chip. A song plays in the order of the whole
library; any other result opens its list, the field empties, and Back returns to the search
(narrower shells). Esc clears the field.

**Filtering an open list.** While a list is open the same field filters it ("Search in <list>"),
and a song played from it plays on through the songs that match.

## Playing

**Phone.** The full player covers everything: a close button and "Playing from" with the list's kind
and name, the artwork, the title (two lines at most) and the artist, the time line with its times,
shuffle, previous, the large play/pause, next and repeat, then the queue button and Add to playlist.
The background runs from a dark tint of the cover into the canvas. It opens from the mini player or
the Playing tab, and closes with the close button, a swipe down or Esc, sliding back down.

**Tablet and desktop.** Playing fills the main area in two columns: the artwork; then "Playing from"
the list, the title in large type, the artist, its facts (length, format, folder, and its place in
the queue, "4 of 12"), and the queue and Add to playlist buttons. The transport and the time line
stay in the player bar. It opens from the player bar's open button, Playing in the sidebar or the
rail, or 4 on the keyboard, and closes with the player bar's button, Esc, or any other screen.

## The queue

What plays next: **Now playing** at the top, then **Next in queue** (songs added with Play next or Add
to queue, in that order) and **Next from <list>** (the rest of the list the song was started from).
With nothing added it says that songs added with Play next or Add to queue show there.

**Where it shows.** On a desktop shell at least 600 px tall it is the right pane, opened and closed
by the player bar's queue button or Q, with a "Hide the queue" button on its heading; open or closed
is remembered. Everywhere else (the phone, the tablet, a short window) it is a sheet over the screen,
opened by the queue button of the mini player, the player bar or the full player.

**What it does.** A tap, a click or Enter plays a row. Rows reorder by dragging the handle with a
mouse, a long press on touch, or Alt+Up and Alt+Down. A swipe left, Delete or X takes a row out, with
a toast and Undo. **Save as playlist** makes a new playlist of the songs in the queue. **Clear** asks
first and keeps the playing song (Ctrl+L asks in a small sheet). The queue lives in memory and is not
journaled; playlists are files and are.

## Settings

One settings sheet on every device: a bottom sheet on the phone, a centred dialog on wider shells. It
opens from the gear (phone), Settings in the sidebar or the rail, Ctrl+comma, and the Settings button
of the "downloader is off" toast. Groups appear only with rows that work in this version, in this
order:

- **Library.** Music folder: on the PC its path with **Choose** (or **Change**), which opens the folder
  picker; on the phone a path field with **Use**. With a library open: **Rescan** (reads the folder
  again, changes nothing), **Make playlists from folders**, and **Undo last change** with the change
  named in plain words beside it ("Nothing to undo" otherwise). Undo waits while a download or a sync
  runs.
- **YouTube.** The **Downloader** switch. While it is off the rest of the group, the sidebar's and
  the rail's Download item, Ctrl+V and shared links are all off; a link that arrives anyway gets a
  toast saying where to turn it on. While it is on: the last failed download as an error row (Copy
  log, Retry); **Download a link** (a field, **Add** and **Paste**, both opening "Where should this
  go?"); with links waiting, **Download queue (N)** and **Links waiting** (a sub-sheet: each link with
  the folder and playlists it goes into, Copy and Remove, and Download queue). On the phone also the
  **Download helper** (the yt-dlp version, **Update**) and **Network check**; the PC's helper comes with
  the installer.
- **Proton Drive** (phone only). The sync engine's state, then the login (email, a password used once
  and never stored, a 2FA code, **Connect**), or once connected the account with **Disconnect**, **Sync
  now**, **Get new**, **Send new** and the last sync time. A failed login or sync shows an error row
  with Copy log and Retry. Sync is off while the test library is shown.
- **Appearance.** **Text size**: 100 %, 115 % or 130 %, for every screen on this device; rows grow with
  the text.
- **Tools.** **Copy log** (the log with the app and device details on top, and the change lines the
  screen does not show) and **View log**, whose help line is the newest line of the log. View log opens
  the log in a sub-sheet, newest line in view, with **Clear log** and **Copy log**.
- **About.** "Soundhood" with the version, the typeface (Inter, SIL Open Font License 1.1) and the
  licences.
- **Developer**, hidden at the bottom. On the phone, tap the version row in About 7 times in a row
  (each tap within 1.5 s of the last); on the PC press Ctrl+Alt+Shift+D. The same gesture hides it
  again, a toast says which, and the app remembers. It holds **Test library** (a switch), **Run
  self-test** and **Rebuild index** ([TESTING](TESTING.md#device-runs-with-the-fixture-root)).

## Downloads

A link arrives in one of four ways: **Ctrl+V** anywhere outside a text field, the **Download** item of
the sidebar or the rail (an empty link field, with the focus in it), **Add** or **Paste** in Settings,
or a link shared to the phone app. Each opens **Where should this go?**: the link, the folder it lands
in (a list of the folders and "New folder", whose name is checked before anything is made), the
playlists every file it brings joins, and **Cancel**, **Queue** and **Download**. The folder and
playlists start from the remembered choice, which each Download on the PC updates.

- **Download** on the PC starts at once and remembers the folder and playlists for the next link; on
  the phone the link is queued first and leaves the queue once it has downloaded.
- **Queue** keeps the link for later, here or on the other device (the queue file travels with the
  music folder). Download queue runs the waiting links one after another.
- **While it runs** a toast stays: "Downloading 2 of 5: 45% (12 s)" with a purple progress line, and
  **Cancel** on the phone (the PC host cannot cancel yet). When it ends a toast says what arrived
  ("Downloaded 1 and added to 1 playlist").
- **Failures.** A download that fails gives a toast with Retry and the error row in Settings,
  YouTube. A queue stops at the first failure ("Queue stopped: ...") and that link stays queued.
  Whole channels are refused (a toast, or in the sheet a "Not taken" row with the reason), and so is
  a download before a music folder is chosen.

## Dialogs

Every dialog is the same sheet: a bottom sheet on the phone, a centred panel on wider shells.

- **Edit tags.** The file name, Title and Artist; **From filename** fills both from "Title - Artist"
  in the file name without saving; Cancel, **Save**. A write the core refuses keeps the dialog open
  with the reason in a "Not saved" row (Copy log, Retry).
- **Delete this track? / Delete N tracks?** The songs (the first twelve, then "and N more"). The files
  go to the bin (the Recycle Bin on the PC, the app's own bin on the phone) and playlists are
  updated; Cancel, **Delete**.
- **Delete this playlist?** Only the playlist file goes to the bin; the songs stay where they are.
  Cancel, **Delete playlist**.
- **New playlist.** A name; **Create**, which opens the new empty playlist, or **Create and add** when
  it was asked for with songs (Add to playlist, Save as playlist, Ctrl+S).
- **Add to playlist / Add N songs to a playlist.** "New playlist" first, then the playlists that do
  not already hold every one of the songs.
- **Move to folder / Move N songs to a folder.** The folders that do not already hold every one of the
  files.

## Reports after a write

- **Playlist changes** (add, remove, a drop on the sidebar, a playlist deleted, playlists made from
  folders) end in a toast with **Undo**. Taking a song out of the queue does too, though the queue is
  not journaled.
- **Tag edits, moves and deletes** end in a report: what was done ("Moved 3 songs to Archive",
  "Saved the tags of ..."), the counts (done, skipped, failed, with the reasons), the songs with
  before and after, and **Undo this batch** and **Done**. It never closes by itself, and a tap beside it
  does nothing. Undo this batch undoes the batch's changes newest first and stops, saying why, at a
  change the batch did not make; its own report has no Undo.
- **Undo last change** in Settings ends in a toast when it cleanly undid a playlist change, else in a
  report.

Toasts sit at the bottom centre, above the mini player or the player bar, at most two at a time.
Each stays 4 seconds, longer while the pointer or the focus is on it.

## First-launch setup

A new install shows three steps, one screen each, every one with **Skip** and **Next** (**Done** on
the last):

1. **Where is your music?** On the PC, **Choose folder**; on the phone a path field with the standard
   Music folder filled in, and **Use** (Android asks once for access to your files when the app
   starts). Once read it says how many songs it found. Next waits for a folder; Skip goes on without.
2. **Online lookups**, one switch, off. Stored for later versions; nothing uses it yet.
3. **YouTube helper**: **Enable downloader** (off) and **Keep download helper updated** (off). The
   downloader stays off, and the download controls hidden, until it is turned on here or in Settings.

It shows once: finished or skipped through, it never returns. **An existing install** (one where an
earlier version stored any setting) is asked nothing and keeps downloading as before; when it has no
music folder set, it sees the folder step alone. Online lookups and Keep download helper updated have
no row in Settings until the phases that use them.

## Planned

- Phase 2: Tidy (proposed renames and clean-ups, possible duplicates, missing art, words to strip,
  the bin), and the app fetching and updating its own download helper.
- Phase 4: smart playlists, play history, online lookups (the switch the setup already stores) and
  more search filters.
- Phase 5: the lyrics pane and its buttons on the player.
- Settings groups arrive with the phase that gives them a working row: Playback, Online lookups,
  Lyrics, Car.

There is no Albums view. One is added only if a later decision in [DECISIONS](DECISIONS.md) finds
enough album data in the library to support it.
