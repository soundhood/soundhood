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
- The fixture library (a small test library the app generates) is installed on both devices with
  **Test library** in the hidden developer section ([how to open it](OWNER_GUIDE.md#the-developer-section)).
  Every screenshot the team commits is taken with it, never with your own library. While it is on,
  Proton sync is switched off on the phone, so the test library never reaches your Proton Drive.

Your own tests below run on your real library unless a test says otherwise.

## Phase 0 (planned 0.2.0): foundation

Phase 0 changes how the app writes to your files, not how it looks. Apart from Undo and, on the PC,
a Copy log button, you should notice nothing.

1. **The PC app looks and behaves as before.** Install the new version
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-pc)). Open it, browse Playlists, Artists and
   Folders, play a few songs, search, change the volume.
   *Expected:* everything looks and works as it did before the update. Your library, playlists and
   settings are there. The new things are the **Undo** button at the top and a **Copy log** button
   next to **Download** (it shows while there is a log). The **Tags ← names** button is gone (it
   returns in Phase 2, done safely, as Tidy).

2. **The phone app looks and behaves as before.** Install the new version
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-phone)). Open it, browse the tabs, play a song, open
   the full player, lock the screen and unlock it.
   *Expected:* everything looks and works as before; the Proton Drive login is still there. The only
   new thing is the **Undo last change** row in the settings sheet.

3. **Pasting a link still downloads on the PC.** Copy a YouTube link, paste it into the download box,
   choose a folder and a playlist, press Download.
   *Expected:* the song downloads as it did before, lands in the folder you chose and appears in the
   playlist you chose. No new files or playlists appear that you did not ask for, apart from
   Soundhood's own `_Soundhood` folder: the first change Soundhood makes (here, adding the song to
   the playlist) creates `_Soundhood\journal` inside your music folder. Soundhood keeps its list of
   changes there; leave it.

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
   *Expected:* the comparison prints `Identical`. (An edit followed by Undo does not count as "no
   edit": Undo brings back the old tags, but an m4a or mp3 file can come back with different bytes,
   so the comparison would list it.)

## 0.2.1: fix

7. **The phone's seek bar works.** Install 0.2.1 on the phone
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-phone)). Play a song and open the full player.
   *Expected:* the time on the right shows the song's length, not 0:00, and the dot moves along as
   the song plays. Drag the dot, or tap somewhere on the bar: the song jumps there. The thin bar
   under the mini player moves too.

## Phase 1 (0.3.0): the new look, the same on the PC and the phone

Phase 1 changes how the app looks and how you move around in it; it does not change how it writes to
your files. Tests 1 and 2 above ("looks as before") are replaced by tests 8 and 9.

8. **The PC app opens with the new look and your library.** Install 0.3.0
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-pc)) and open it.
   *Expected:* no setup steps (Soundhood recognises your install). On the left a sidebar: Playlists,
   Artists, Folders, Playing, Download, then your playlists. Your playlists show as cards with four
   covers each. The aqua hood-and-bars icon is in the taskbar and the Start menu. Your songs,
   playlists and volume are as you left them.

9. **The phone app has the same look.** Install 0.3.0 on the phone
   ([guide](OWNER_GUIDE.md#install-the-app-on-the-phone)) and open it.
   *Expected:* no setup steps. Tabs at the bottom (Playlists, Artists, Folders, Playing), the same
   playlist cards as on the PC, the gear icon at the top right for Settings. The new icon is on the
   home screen.

10. **One click or tap plays; the queue works.** Open a playlist and click (PC) or tap (phone) a
    song. Then open another song's menu (the three dots on its row) and choose **Play next**. Open
    the queue: the queue button in the player bar on the PC, or in the full player on the phone.
    *Expected:* the song plays at the first click or tap, no double-click. The queue shows it under
    "Now playing", the song you chose under "Next in queue", then the rest of the playlist. Drag a
    song in the queue to move it; it plays in the new order.

11. **Pasting a link still downloads on the PC.** Copy a YouTube link, click anywhere in Soundhood
    and press Ctrl+V (or click **Download** in the sidebar and paste it). Pick a folder and a
    playlist, press **Download**.
    *Expected:* a small box at the bottom shows the progress with a purple line. The song lands in
    the folder you chose and appears in the playlist you chose.

12. **Sharing a link from Brave still downloads on the phone.** In Brave, share a YouTube video to
    Soundhood.
    *Expected:* the "Where should this go?" panel slides up from the bottom; pick the folder and the
    playlists and press **Download**. The song arrives as before.

13. **A playlist change can be taken back from the message.** On either device, add a song to a
    playlist from its menu (**Add to playlist**).
    *Expected:* a message at the bottom says what was added, with **Undo**. Press **Undo** within a
    few seconds: the song is out of that playlist again.

14. **A tag edit ends in a report you can undo.** On the PC, open a song's menu, **Edit tags**,
    change the title, **Save**.
    *Expected:* a report opens and stays until you close it: what changed (old and new title) and the
    buttons **Undo this batch** and **Done**. Press **Undo this batch**: the old title is back.

15. **Bigger text fits.** Settings, Appearance, **Text size** 130 %.
    *Expected:* every screen's text grows; nothing is cut off or overlaps, rows grow with it. Set it
    back to 100 %.

16. **The keyboard on the PC.** With music playing: Space, Ctrl+Right, Q, Ctrl+comma, Esc.
    *Expected:* Space pauses and plays, Ctrl+Right goes to the next song, Q shows or hides the queue
    on the right, Ctrl+comma opens Settings, Esc closes it. The full list is in
    [SHORTCUTS](SHORTCUTS.md).

17. **Side by side, it is one app.** Put the phone next to the PC and open the same screen on both:
    Playlists, then a playlist, then Playing, then Search (type the same word), then Settings.
    *Expected:* the same colours, icons, type and parts on both. The PC has more room, so it adds the
    sidebar, the queue on the right and the player bar; nothing else should differ. Tell the team
    anything that looks different for another reason.

When a test fails, open Settings, Tools, **Copy log** on that device and send the log with the test number.
