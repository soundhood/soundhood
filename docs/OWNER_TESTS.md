# Owner tests

The checks only the owner can do: they need his hands, his ears, his accounts or his library. Each
phase adds a numbered list. Every test says what to do and what you should see. A test is done only
when the owner says it passed; until then it is listed in [OPEN](OPEN.md) with the date it was handed
over. How-to blocks (installing, Copy log, snapshots) are in [OWNER_GUIDE](OWNER_GUIDE.md).

## Standing setup for gate runs

Whenever the team runs the phase checks on the devices:

- The phone is attached to the PC over USB, its screen unlocked for the whole run.
- On the phone, USB debugging and All-files access are on.
- Proton VPN is off, unless a test says to turn it on.
- The fixture library is installed on both devices (settings, Tools, **Use fixture root**). Every
  screenshot the team commits is taken with it, never with your own library.

Your own tests below run on your real library unless a test says otherwise.

## Phase 0 (planned 0.2.0): foundation

Phase 0 changes how the app writes to your files, not how it looks. Apart from one new Undo row, you
should notice nothing.

1. **The PC app looks and behaves as before.** Install the new version
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-pc)). Open it, browse Playlists, Artists and
   Folders, play a few songs, search, change the volume.
   *Expected:* everything looks and works as it did before the update. Your library, playlists and
   settings are there. The only new thing is the **Undo** button at the top. The **Tags ← names**
   button is gone (it returns later, done safely, as Tidy).

2. **The phone app looks and behaves as before.** Install the new version
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-phone)). Open it, browse the tabs, play a song, open
   the full player, lock the screen and unlock it.
   *Expected:* everything looks and works as before; the Proton Drive login is still there. The only
   new thing is the **Undo last change** row in the settings sheet.

3. **Pasting a link still downloads on the PC.** Copy a YouTube link, paste it into the download box,
   choose a folder and a playlist, press Download.
   *Expected:* the song downloads as it did before, lands in the folder you chose and appears in the
   playlist you chose. No new files or playlists appear that you did not ask for.

4. **Undo takes back a tag edit.** On the PC, edit the title or artist of one song and save. Look at
   the Undo button (hover over it), then press it.
   *Expected:* before you press it, it names the song you just edited ("Edited tags of ..."). After
   you press it, the song shows its old title and artist again.

5. **Undo brings back a deleted track on the phone.** On the phone, pick a song that is in a playlist,
   delete it, then open the settings sheet and press **Undo last change**.
   *Expected:* the row names the delete before you press it. Afterwards the song is back in the same
   folder and in the same playlist, and plays.

6. **A normal session leaves the library untouched.** Take a snapshot
   ([guide](OWNER_GUIDE.md#take-a-library-snapshot-and-compare-two)). Use the app normally for a while
   on the PC without editing anything: browse, search, play, rescan. Do not edit or sync on the phone
   meanwhile. Take a second snapshot and compare.
   *Expected:* the comparison prints `Identical`.

When a test fails, press Copy log on that device and send the log with the test number.
