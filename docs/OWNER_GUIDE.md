# Owner guide

Plain-language instructions for the person who uses Soundhood every day. Each step is a block to copy
into PowerShell: the line above says what it does, the line below says what you should see. This
version covers what Phase 0 adds; later phases add their own sections.

The hand tests for each phase are in [OWNER_TESTS](OWNER_TESTS.md).

## Before you start: open PowerShell in the Soundhood folder

In File Explorer, open the folder that holds the Soundhood code, right-click an empty spot and choose
**Open in Terminal**. Every block below starts from there.

Check that you are in the right place:

```powershell
Test-Path .\app\src-tauri\tauri.conf.json
```

You should see `True`. If you see `False`, you are in another folder: close the window and try again.

## Install the app on the PC

Build the installer. It takes a few minutes; let it finish. The build script also fetches the two
download helpers the installer carries (yt-dlp and deno) and checks that they are exactly the
versions the project pins, so it needs the internet, and it stops with a message if a check fails.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

The last lines name the installer (a file ending in `_x64-setup.exe`), its size and how long the
build took.

Start the installer you just built:

```powershell
Start-Process (Get-ChildItem .\target\release\bundle\nsis\*.exe | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
```

The Soundhood setup window opens. Click through it. Soundhood installs over the old version and opens
with your library, playlists and settings as before.

## Install the app on the phone

Plug the phone into the PC with USB, unlock it, then check that the PC sees it:

```powershell
adb devices
```

You should see one line ending in `device`. If it ends in `unauthorized`, look at the phone, allow USB
debugging, and run the block again.

Build the phone app. It takes a few minutes.

```powershell
cd app; npm run tauri android build -- --apk --target aarch64 --config src-tauri/tauri.standalone.conf.json; cd ..
```

The last lines name a file ending in `.apk`.

Check that the new app is signed with the same key as the app already on the phone:

```powershell
$apk = (Get-ChildItem .\app\src-tauri\gen\android\app\build\outputs\apk -Recurse -Filter *.apk | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
$id = (Get-Content .\app\src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).identifier
$apksigner = (Get-ChildItem "$env:ANDROID_HOME\build-tools\*\apksigner.bat" | Sort-Object FullName | Select-Object -Last 1).FullName
adb pull ((adb shell pm path $id | Select-Object -First 1) -replace '^package:', '').Trim() "$env:TEMP\soundhood-installed.apk" | Out-Null
$old = (& $apksigner verify --print-certs "$env:TEMP\soundhood-installed.apk" | Select-String 'SHA-256').Line
$new = (& $apksigner verify --print-certs $apk | Select-String 'SHA-256').Line
if ("$old" -ne "" -and "$old" -eq "$new") { "Same key: OK to install" } else { "DIFFERENT KEY: do not install" }
```

You should see `Same key: OK to install`. If you see `DIFFERENT KEY`, stop here and send the message
to the team: installing it would mean uninstalling the app first, which erases its settings, the index
and the Proton Drive login (your music stays).

Install it over the app that is already there:

```powershell
adb install -r $apk
```

You should see `Success`. If you see `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, do not uninstall anything:
send the message to the team.

## Undo last change

Soundhood now remembers every change it makes to your music files and playlists, and can take the last
one back.

- **On the phone:** open the settings sheet (the gear icon). The row **Undo last change** shows, in
  plain words, the last change made on this phone, for example "Edited tags of Song - Artist.m4a".
- **On the PC:** the **Undo** button at the top, next to Rescan. Hover over it to see what it will undo.

What it undoes: a tag edit, a move to another folder, a delete, or a playlist change (adding or
removing tracks, creating or deleting a playlist). Everything that one change did comes back
together: a deleted track comes back in the same folder and the same playlists.

- For now, deleting or moving several selected tracks at once counts as one change per track, so
  Undo brings them back one per press. Press it once for each track.
- A deleted file comes back from the Recycle Bin on the PC, and from the app's own bin on the phone
  (the folder `_Soundhood\.bin` inside your music folder; the phone has no Recycle Bin).
- After a tag edit, Undo brings back the old title and artist. An m4a or mp3 file can come back a
  little different in size (same tags, same sound), so Proton Drive uploads it again.
- If a file was changed again after that action (by you, by the other device, by another program),
  Soundhood leaves that file alone and says so. It never forces an undo.
- Press it again to undo the change before that one.
- It undoes changes made on the device you are holding. A change made on the PC is undone on the PC.
- The first change creates the folder `_Soundhood\journal` inside your music folder. Soundhood keeps
  its list of changes there; leave it.

## Copy log

When something goes wrong, the log says why. Paste it to the team as it is.

- **On the phone:** settings sheet (gear icon), then **Copy log**. The log is now on the clipboard;
  paste it into a message.
- **On the PC:** **Copy log**, next to **Download** (it shows while there is a log). It copies the log
  with the app and device details on top; paste it into a message.

The log names versions and what the app was doing; it never contains your passwords or your cookie
file.

## The developer section

A hidden set of switches the team uses for tests: **Test library**, **Run self-test** and
**Rebuild index**. You only need it when the team asks.

- **On the phone:** tap the status line in the top bar (next to the gear icon) 7 times quickly. The
  switches appear at the bottom of the settings sheet.
- **On the PC:** press Ctrl+Alt+Shift+D. A row of switches appears under the top bar.

Do the same again to hide them. **Test library** swaps your library for a small test library the
app makes itself (the switch reads "Test library: on"); while it is on, Proton sync is off on the
phone. Turn it off again to get your own library back.

## Take a library snapshot and compare two

A snapshot is a short list of every song and playlist in your music folder with a fingerprint of each
file. It copies no music. Comparing a snapshot from before with one from after tells you, in one line,
whether anything in your library changed. Snapshots are kept in `_Soundhood\snapshots` inside your
music folder.

Tell PowerShell where your music folder is (the team's message gives you this line filled in; paste it
once per PowerShell window):

```powershell
$lib = "<your library root>"
```

Nothing is printed.

Take a snapshot. Do this before the thing you want to check:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\snapshot-library.ps1 -Root $lib
```

One line says where the snapshot was saved.

Take a second snapshot after, with the same block. Then compare the last two:

```powershell
$snaps = Get-ChildItem "$lib\_Soundhood\snapshots\*.json" | Sort-Object LastWriteTime | Select-Object -Last 2
powershell -ExecutionPolicy Bypass -File .\tools\manifest.ps1 -Before $snaps[0].FullName -After $snaps[1].FullName
```

You should see `Identical` when nothing changed. Otherwise you see how many files changed, then one
line per file. Send that to the team if you did not expect it.
