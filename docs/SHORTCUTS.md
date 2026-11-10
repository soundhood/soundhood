# Keyboard shortcuts (PC)

The decided list, all working from Phase 1 (0.3.0) unless marked. Shortcuts are discoverable here
only: the app shows no on-screen legend. There are no J/K shortcuts. Single keys do nothing while
you type in a text field (Esc still works there): "/" typed in a field is a "/". While a sheet, the
first-launch setup, a list (Sort, Text size, a sheet's folder list) or a menu is open, a key acts
only on what is on top: in a sheet only the playback keys answer (and, in the queue sheet, Q and
Ctrl+L); in a list or menu no key heard on the window answers at all, the letters jump within it,
and Esc closes it first. Ctrl+K and "/" never move the focus to the search field behind, and 1 to 4
(the phone's tabs too), Ctrl+A and the list keys never act on the screen behind. Ctrl+, and a pasted
link may open a sheet on top of another sheet, never under the first-launch setup; an open list or
menu closes first, and its control counts as what opened the sheet. A held key is one press: holding
Enter or Space on any control (a button, a switch, a checkbox, a song row, a menu item, a list
option) acts once, and holding Enter in a field (Edit tags) submits once, never again in the sheet
the first press opened; a held shortcut acts once and its repeats do nothing else (a held Space
never scrolls the screen, a held "/" types no "/" into the field it found); the arrows, Page Up and
Down, Home and End keep repeating. Enter that submits a field (New playlist, "Where should this
go?", Edit tags) acts there only, never on the button the focus goes back to. Whatever changes the
screen (Enter on a card or a row, Back, 1 to 4, a click on a card, on Back or on a sidebar item)
leaves the focus on the new screen's heading (the full player's title on Playing), never on a
button, a card or a row: Space still plays and pauses, Ctrl+E with nothing chosen edits the playing
song, and Tab goes on into the screen, from the first card or row in view when the heading is out of
sight (Back to a scrolled list). What opens over a screen from a control (a sheet, a list or menu,
Select mode, the queue, Playing) gives the focus back by one rule when it closes: opened with a
click or a tap (even on a button the keyboard had reached), the focus goes to the heading under it
(to the sheet, for what opened in a sheet), so Space plays and pauses and never opens it again;
opened with the keyboard, it goes back to what opened it. A sidebar item you reached with the
keyboard keeps the focus, and so does the search field you type in. The first-launch setup keeps Tab
inside it, as a sheet does. On the phone there is no keyboard layer: a tap plays, and there is no
double-tap.

"The selection" means the songs you have chosen (Ctrl+click, Shift+click, or Select mode), or else
the row that has the keyboard focus because you moved it there (the arrows, Tab, a click); after a
change of screen no row has it.

## Playback

| Keys | Action |
|---|---|
| Space | Play / pause (with nothing loaded: start the queue, or the list on screen); a button, a field or a slider with the focus takes Space itself |
| Ctrl+Right, Ctrl+Left | Next song, previous song (past 3 seconds into a song, Previous starts it again) |
| Ctrl+Up, Ctrl+Down | Volume up, volume down, by 5 % |
| M | Mute |

Ctrl+arrows also work while a slider has the focus.

## Navigation

| Keys | Action |
|---|---|
| 1, 2, 3, 4 | Playlists, Artists, Folders, Playing |
| Ctrl+K or / | Focus the search field |
| Esc | Close the open list, menu or sheet (the one on top), else clear the search; in an empty search field, close Playing or leave Select mode, with the focus going to the screen's heading |
| Ctrl+, | Settings |
| Q | Show or hide the queue |

## Songs in a list

| Keys | Action |
|---|---|
| Up, Down, Home, End, Page Up, Page Down | Move through the list |
| Click | Play the song |
| Ctrl+click, Shift+click | Choose a song without playing it, choose a range |
| Ctrl+A | Choose every listed song |
| Enter | Play the selection |
| A | Add the selection to the queue (after the songs already added) |
| Shift+A | Play the selection next |
| Del | Remove from the playlist being shown; elsewhere, from the queue (a toast offers Undo) |
| Ctrl+E | Edit tags (one song; with nothing chosen, the playing song) |
| Ctrl+S | Save the selection as a playlist |
| Context menu key, Shift+F10 | The song's menu (also a right click) |

## Queue

| Keys | Action |
|---|---|
| Enter | Play the focused song |
| X, Del | Remove it from the queue (a toast offers Undo) |
| Alt+Up, Alt+Down | Move it up or down |
| Ctrl+L | Clear the queue (asks first; the playing song stays) |

Ctrl+Up and Ctrl+Down always mean volume. Songs can also be dragged in the queue, and dragged from a
list onto a playlist in the sidebar.

## Downloads

| Keys | Action |
|---|---|
| Ctrl+V | Paste a link (opens "Where should this go?"), when no text field has the focus |
| Ctrl+Shift+D | **Phase 3**: global, download the link on the clipboard even with Soundhood in the background (configurable; the default on Linux and macOS, where this one collides, will be recorded in [DECISIONS](DECISIONS.md)) |

## Developer

| Keys | Action |
|---|---|
| Ctrl+Alt+Shift+D | Show or hide the developer section at the bottom of Settings (Test library, self-test, Rebuild index; [TESTING](TESTING.md#device-runs-with-the-fixture-root)) |

See [SCREENS](SCREENS.md) for where each action lives.
