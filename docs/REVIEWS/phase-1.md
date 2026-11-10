# Phase 1 review

Charters: [README](README.md). Phase 1 (0.3.0): the design system, the rebuilt interface on the PC and
the phone, the queue, Settings, downloads, the reports after writes, first-launch setup. Round 1 ran
on `afc8d4c` (2026-11-10), each reviewer on its own clean checkout, read-only.

## Build gate (`bfd88d5`, before round 1)

A clean clone of `phase-1`, both targets built, nothing installed.

| Check | Result |
|---|---|
| Fresh-clone preparation | yt-dlp 2026.10.26 and deno 2.9.8 fetched and checked against the pins |
| Core tests, default and all features | 262 passed (2 ignored); 329 passed (3 ignored) |
| fmt, clippy (workspace, all targets), host and plugin tests | clean; 0 warnings; 29 passed |
| `cargo ndk` check and phone clippy | ok; 0 warnings |
| Tools typecheck, lint, unit tests | ok; 0 errors; 318 passed |
| Lints: token, contrast, hygiene, md-links | 0 violations; 0 pairs below their minimum; 0 findings; 0 broken links |
| Visual suite, blue scan | 642 passed, 14 skipped; 536 screenshots, 0 failing |
| Windows installer | `Soundhood_0.3.0_x64-setup.exe`, 59.9 MB |
| Android release APK | 60.6 MB, versionCode 3000, signer SHA-256 `73abd93e…c48de47f45`, the key of the app on the phone |
| PC network check, 120 s, test identity | pass: `tauri.localhost`, `ipc.localhost`, `asset.localhost` only; no remote TCP |
| Real PC window screenshots | **not taken**: a person at the PC clicked through the test window's first-launch setup and chose a real library folder; the run stopped, closed the window and deleted the test identity's data (only an index, in app data). To be taken in a quiet slot with the phone attached |

## Round 1 (`afc8d4c`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. Every CI gate green on a fresh preparation; the visual suite 694 passed in four full runs (2, 8, 8 and 16 workers, two while a release build ran) and 236 of 236 in a stress run of the download and settings specs; desktop installer 59.9 MiB, release APK 63.5 MB with the expected signer, debug APK as in CI. Major: the Phase 1 suite (708 tests) has never run on GitHub's runners, so Phase 1 merges through a pull request with CI green. Minors: stale comments and docs, dev-only audit notices, the Vite favicon, repository growth from the baselines |
| Break the network | **signed**. No call at start, on a timer, on focus or after setup; every download follows a press of Download, Download queue or Retry; a refused download stops the queue; host and phone code unchanged since Phase 0 apart from the version; fonts bundled; nothing remote in the bundle; net-log check passed with the test library and on first-launch setup. Majors: a link shared to a phone in the first moment after start could be downloaded with the Downloader switch stored off; switching it off during a Download queue run did not stop the run |
| Break the library | **blocked**. Every write still goes through the journaled host commands and no new host command or file write was added, but a toast's Undo undid the newest change instead of its own, and was offered for gestures that changed nothing: an Undo on "already in the playlist" reverted an earlier tag edit (a tier-1 write nobody confirmed). Majors: a double press on Undo last change undid two changes; a report took its batch from the newest change after each operation, so a download finishing in between could be adopted and reverted |
| Break the design | **blocked**. The search field had no focus ring; the PC drew native scrollbars with arrow buttons (Chromium lets `scrollbar-width` override the custom scrollbar; headless screenshots hide scrollbars, so the suite could not see it). Majors: "Playing" with nothing loaded was disabled on the phone but not on the PC (a parity exception); one icon for two actions in the Select bar. Clean: at most one aqua fill on every screen and sheet, purple never text, nothing clipped at 130 % text, no emoji, native controls, legends, J/K or double-tap |


### Round-1 fixes

- **Undo by the change's own id.** A thin host command `undo_batch` over the core's existing
  `Core::undo_batch`; each write's own batch report is collected as it happens
  (`app/src/lib/journal.ts`); a toast and a report undo only their own changes; no Undo when nothing
  changed ("Already in Late Night"); undo buttons lock on the first press. 14 new tests fail on
  `afc8d4c` and pass after.
- **Downloader switch** checked on every download path; switching it off stops a running queue after
  the current download; a link shared before the stored setting is read waits for it.
- **Design:** the custom scrollbar really renders in WebView2 (Chromium let `scrollbar-width`
  override it), checked by a spec that runs with scrollbars shown; the search field's focus ring,
  checked by a Tab walk; "Playing" disabled alike on every size; a distinct icon for removing from a
  playlist; Settings dimmed under the download sheet; the switch's edge; the playing row's bar;
  "Playing from" worded alike; dark window, page and Android theme at start; the app mark as favicon.

## Round 2 (`97c4d99`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. Every round-1 scenario fixed, on the mock and on the real core (`undo_batch` refuses an undone, unknown or since-changed change and writes nothing); event ordering of the batch report confirmed in the Tauri source. New major (older than Phase 1): change detection by whole-second time and size left the index showing the edited tags after an edit and its undo within one second |
| Break the network | **signed**. Both majors fixed; no new network path; net-log check passed twice. Minors: the switch defaulted to on until the stored setting loaded; a settings read error left it on |
| Break the design | **blocked**. Round-1 findings fixed. New: "Save as playlist" from the queue sheet opened New playlist hidden under it on narrow shells; focus was lost when the download sheet closed over Settings |
| Break the build | **blocked** on test reliability only: a cold-share spec failed 29 of 200 runs at CI's worker count; a page load could hang on a Windows socket-buffer error; a player spec was timing-dependent |

### Round-2 fixes

Every journaled batch re-reads the files it touched (`Index::refresh_touched`, proven on m4a, opus
and ogg within one second); a fence after a late batch report; the contract pins `core:batch`;
exact counts in messages; the downloader stays off until the settings load and when they cannot be
read; one sheet stack in open order; focus returns to the sheet below; deterministic specs (800 of
800, 400 of 400); the test harness reloads a page whose dev-server request failed.

## Round 3 (`7421cba`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. The three formerly flaky tests passed 1,200 runs; broad stress 987 of 987 at 10 and 16 workers. Minors: the harness reload could hide an intermittent startup crash; a stuck startup call was not named |
| Break the library | **signed**. Stale index gone in every case; forced re-reads write nothing; held Enter and double clicks on every confirm act once. Minors: recovery at start did not force its paths; typing a link by hand lost focus; Select bar slots swapped with the selection; an Undo on "Create and add" that would be refused |
| Break the network | **signed**. Minor: the phone's helper Update and Network check showed before the stored switch was read |
| Break the design | **blocked**: typing a link by hand into the download sheet threw focus out and the "/" landed in the search behind; Ctrl+K and "/" reached the search behind any sheet; Ctrl+comma during first-launch setup opened Settings under it |

### Round-3 fixes

The sheet reads its initial focus once; shortcuts do nothing behind a sheet, the setup or a menu; a
focus safety net; focus after removing a waiting link or closing a report; stable narrow Select
slots per kind of list; the remove icon drawn as add-to-playlist's counterpart; recovery re-reads its
paths on the first scan; the helper rows wait for the settings; the harness fails at once on a
startup crash and names a stuck startup call.

## Round 4 (`0a108cf`)

| Reviewer | Result |
|---|---|
| Break the build | **signed**. All gates; the suite twice and a 1,104-test stress at 12 workers, 0 failures; installer 62.8 MB; APK signer as on the phone; CI's visual job estimated at about 11 minutes. Minors: an intermittent startup hang without a failed request could still pass after a reload; the load budget is close to the test timeout |
| Break the network | **signed**. Every probe passes; paste and Ctrl+comma under the setup or a menu start nothing; net-log check passed. Observation: a phone share during the setup opened the download sheet under it |
| Break the library | **signed**. Write path untouched; forced re-reads byte-identical; recovery forces only this device's last open entry; every confirm acts once. Minors: a held Enter removed every waiting link and undid three changes in a row |
| Break the design | **blocked**: the phone's share path ignored the rule that no sheet opens under the setup or a menu; open dropdown lists were not a layer, so shortcuts and new sheets went behind them. Minors: a doubled toast; a full report for a tag save that changed nothing |

### Round-4 fixes

Dropdown lists and menus form a layer stack beside the sheets (`popoverStack.ts`): keys and new
sheets go to the top one; a phone share during the setup or a menu waits for it (`useSharedLinks.ts`);
a held Enter or Space is one press on buttons and list options; a repeated toast is not doubled; a tag
save that changed nothing says "Nothing to change"; the harness reloads a page only after a failed or
unanswered dev-server request and names a startup call that never answers.

## Round 5 (`3b59ebf`)

| Reviewer | Result |
|---|---|
| Break the network | **signed**. A held share cannot start a download in 15 new cases (cold and warm start; switch off, on, unknown or unreadable; during the setup; two shares; a restart); command set and bundle unchanged; net-log check passed. Minor: a share held during the setup lives only in memory, so closing the app before the setup ends loses it (now in OPEN) |
| Break the library | **signed**. Round-4 minors fixed; every confirm acts once; "Nothing to change" writes nothing. Minor: a held Enter on "Edit tags" opened the editor and saved it at once |
| Break the build | **signed**. All gates; visual 848; stress 2,544 of 2,544 at 12 workers. Minor: no `maxFailures` on CI, so a systemic break would run out the job |
| Break the design | **blocked**: the Playlists list in "Where should this go?" flipped upward and the sheet clipped it, so the first playlists could not be reached (older; the owner has 29 playlists); toast deduplication hid repeated actions (regression); held keys still repeated on the switch, the mini player's play button and a phone song row. Minor: focus fell to the page in three places |

### Round-5 fixes

Lists and menus render in the shell's overlay layer, placed against their button on the side where they
fit (`overlayLayer.ts`, `placement.ts`; every one of 29 playlists reachable at every size); only toasts
with an explicit key replace each other; one capture rule for a held Enter or Space on every control,
Edit tags included (`heldKeys.ts`); the focus returns to what opened a list or menu (`useFocusReturn`);
CI stops after 25 failures; an OPEN row for a share lost during the setup.

## Round 6 (`d28ee28`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. Write path untouched; 866 visual, 376 unit; held keys and double presses act once. Minor (older): with two Undo toasts, a double click on the older one could also press the newer one's Undo after the stack moved under the pointer |
| Break the build | **signed**. All gates; visual 866 twice; stress 2,598 of 2,598; CI estimated at 15 to 18 minutes |
| Break the network | **signed**. Startup reads in the same order, once; an unreadable store leaves the downloader off with one toast; command set and bundle unchanged |
| Break the design | **blocked**: toasts past two were queued and came back later, stale and out of order, one with a misleading Undo text. Minors: the row menu dropped the focus when it closed on a scroll or resize, and at 760x520 could be cut short and close on its own scroll; keyboard navigation dropped the focus to the page |

### Round-6 fixes

At most two toasts exist: a third pushes the oldest out, which never comes back, and each toast's timer
starts when it shows; a press on a toast's action is ignored for 400 ms after the stack moves; the row
menu gives the focus back to its row, ignores its own scroll and opens where it fits whole; the focus
moves to the new screen after a navigation.

## Round 7 (`874e3f6`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. Pushed-out Undo toasts never act later; each Undo by its own id; the press guard stops the press landing on the wrong toast. Minor: a toast ran its action before closing, so a refused Undo briefly made three toasts and pushed another out |
| Break the build | **signed**. All gates; visual 886 twice; stress 2,658 of 2,658; no React warnings |
| Break the network | **signed**. Command set and bundle unchanged. Minor: on the phone, the download toast's Cancel was ignored within 400 ms of any toast change |
| Break the design | **blocked**: the round-6 fix put the focus on a button, card or row after a navigation, so Space pressed it instead of play/pause ("4" then Space opened the queue) and Ctrl+E edited the first row instead of the playing song (regression, normal use). Minors: Back to a scrolled grid focused a card off screen; a row's More button showed without a hover; the press guard counted any change of the stack; a refused Undo read "0 restored, 1 left as they are"; on the phone, the Add to playlist sheet over the full player seemed to lose the focus |

### Round-7 fixes

After a navigation the focus goes to the screen's heading (`tabindex=-1`, no ring, no scroll), never to
a button, card or row, so Space stays play/pause and Ctrl+E with nothing chosen edits the playing song;
Back keeps a scrolled grid's scroll; only an Undo whose own toast moved or arrived is guarded, never
Cancel or Retry; a toast closes before its action runs; a refused Undo reads "Not undone: Late Night
changed again after this. Undo the newer change first." The phone sheet's lost focus came from the
probe's own focus call landing late; a sheet now takes back any focus that goes behind it anyway.

## Round 8 (`58dfcdd`)

| Reviewer | Result |
|---|---|
| Break the library | **signed**. Each toast Undo undoes only its own change under repeated clicks with undo delays of 0, 300 and 700 ms; a refused Undo comes back as the newest and leaves the other toast; a pushed-out toast never acts; Ctrl+E names the playing song, keeps it when the song changes and saves through the journaled path with its own Undo; core and host unchanged |
| Break the build | **signed**. Fresh preparation, every gate; visual 899 twice; stress 572 and 1,144 runs at 14 and 16 workers, no flake, no unplanned reload |
| Break the network | **signed**. Command set and bundle strings unchanged; the switch off still blocks Retry; a failed download stops the queue. Minors: on the phone, a quick double tap on Cancel could restart the download through the Retry that replaced it, and a double tap on Retry could cancel the download it started; after a stopped queue's Retry the toast said "Queue done" with links still waiting (older) |
| Break the design | **blocked**: after opening the full player with the pointer and closing it with Esc or 1 to 3, the focus went back to the player bar's button, so Space reopened Playing instead of pausing (older path, normal use). Minors: holding Space on a heading scrolled the page; an off-screen heading after Back to a scrolled list; a pressed toast dropped the focus to the page; Enter in New playlist from the sidebar's "+" opened a second, empty New playlist; Select dropped the focus on narrow sizes; the first-launch setup did not keep Tab inside |

### Round-8 fixes

The full player notes how it was opened: opened with a pointer, closing it (Esc, a digit or Close) puts
the focus on the screen's heading, so Space pauses; opened with the keyboard, the focus goes back to its
opener. A held shortcut key does nothing more than its first press and no longer scrolls. Tab from an
off-screen heading goes to the first card or row in view. A toast that held the focus hands it to the
sheet or setup on top, else the heading, and a toast closed by a click shields its place for 400 ms.
Fields end their own Enter, so saving New playlist opens nothing else. Under 1080 px Select gives the
focus to the selection bar. The setup keeps Tab inside like a sheet, and a sheet returns the focus to
what last had it inside. One press guard for every toast action: only its own toast arriving, moving or
changing its action starts it, never another toast or a download's progress; so a double tap on Cancel
or Retry acts once. A stopped queue's Retry reads "2 links still waiting in the queue", not "Queue done".
Each fix has a test that fails on `58dfcdd` (46 failed, 6 guards passed) and passes on `043e874`.
Left in OPEN: Shift+Tab from an off-screen heading still scrolls up to the header; a download toast
pushed up by a new toast ignores Cancel for 400 ms, as any moved toast does.
