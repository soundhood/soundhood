// The keyboard map: every app-wide shortcut in one table (docs/SHORTCUTS.md is its text), and the
// one listener that runs them (KeyboardShortcuts, mounted once by AppShell). There is no on-screen
// legend and there are no J/K shortcuts. Single keys never fire while typing in a text field. The
// shortcut rule: a key heard on the window acts only on what is on top (topLayer, Sheet.tsx); while
// a sheet, the first-launch setup or a menu is open nothing behind it answers, and a key opens a sheet
// only over the screens or another sheet (sheetMayOpen), never under the setup or a menu.
//
// Handled elsewhere, by the component that owns the key:
//   Enter              plays the row, or the selection (TrackList); plays a queue row (Queue)
//   Ctrl+K, /          focus the search field (SearchField `shortcut`; the fallback below covers
//                      screens whose search field has no shortcut of its own)
//   1 to 4             the phone's BottomTabs while they show; on wider shells, this table
//   Esc                a sheet, a menu, Select mode, the selection and the Playing screen close
//                      themselves; this table clears the search when nothing else took it
//   Delete, X          a queue row with the focus (Queue); Alt+Up and Alt+Down move it
//   Ctrl+A             select every listed song (useSelection)
//   Ctrl+comma         settings, Ctrl+V paste a link: the settings and downloads code registers them
//
// The songs a list shortcut acts on: the selection, else the song row that has the focus.

export type Command =
  | "playPause"
  | "next"
  | "previous"
  | "volumeUp"
  | "volumeDown"
  | "mute"
  | "toggleQueue"
  | "search"
  | "escape"
  | "tab"
  | "addToQueue"
  | "playNext"
  | "remove"
  | "editTags"
  | "saveAsPlaylist"
  | "removeFromQueue"
  | "clearQueue";

/** What a shortcut needs to know about a key press (a KeyboardEvent, or a test's stand-in). */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface Shortcut {
  /** As SHORTCUTS.md writes it. */
  keys: string;
  command: Command;
  /** What it does, in the words of SHORTCUTS.md. */
  does: string;
  match: (e: KeyPress) => boolean;
  /** Also while typing in a text field (Ctrl+K only). */
  whileTyping?: boolean;
  /** Repeats while the key is held (volume). */
  repeats?: boolean;
}

/** Ctrl on Windows and Linux, Cmd on a Mac. */
const mod = (e: KeyPress) => e.ctrlKey || e.metaKey;
const plain = (e: KeyPress) => !e.ctrlKey && !e.metaKey && !e.altKey;
const letter = (e: KeyPress, l: string) => e.key.toLowerCase() === l;
const ctrl = (e: KeyPress, key: string) => mod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key.toLowerCase();

export const SHORTCUTS: readonly Shortcut[] = [
  // Playback
  { keys: "Space", command: "playPause", does: "Play / pause", match: (e) => e.key === " " && plain(e) && !e.shiftKey },
  { keys: "Ctrl+Right", command: "next", does: "Next track", match: (e) => ctrl(e, "ArrowRight") },
  { keys: "Ctrl+Left", command: "previous", does: "Previous track (the same one again past 3 s)", match: (e) => ctrl(e, "ArrowLeft") },
  { keys: "Ctrl+Up", command: "volumeUp", does: "Volume up", match: (e) => ctrl(e, "ArrowUp"), repeats: true },
  { keys: "Ctrl+Down", command: "volumeDown", does: "Volume down", match: (e) => ctrl(e, "ArrowDown"), repeats: true },
  { keys: "M", command: "mute", does: "Mute", match: (e) => plain(e) && !e.shiftKey && letter(e, "m") },
  // Navigation
  { keys: "1, 2, 3, 4", command: "tab", does: "Playlists, Artists, Folders, Playing", match: (e) => plain(e) && !e.shiftKey && /^[1-4]$/.test(e.key) },
  { keys: "Ctrl+K", command: "search", does: "Focus the search field", match: (e) => ctrl(e, "k"), whileTyping: true },
  { keys: "/", command: "search", does: "Focus the search field", match: (e) => e.key === "/" && plain(e) },
  { keys: "Esc", command: "escape", does: "Clear the search, or close the open sheet", match: (e) => e.key === "Escape" && plain(e) },
  { keys: "Q", command: "toggleQueue", does: "Show or hide the queue", match: (e) => plain(e) && !e.shiftKey && letter(e, "q") },
  // Selection and lists
  { keys: "A", command: "addToQueue", does: "Add the selection to the queue", match: (e) => plain(e) && !e.shiftKey && letter(e, "a") },
  { keys: "Shift+A", command: "playNext", does: "Play the selection next", match: (e) => plain(e) && e.shiftKey && letter(e, "a") },
  { keys: "Del", command: "remove", does: "Remove from the queue or the playlist being shown", match: (e) => e.key === "Delete" && plain(e) && !e.shiftKey },
  { keys: "Ctrl+E", command: "editTags", does: "Edit tags of the selection", match: (e) => ctrl(e, "e") },
  { keys: "Ctrl+S", command: "saveAsPlaylist", does: "Save the selection as a playlist", match: (e) => ctrl(e, "s") },
  // Queue
  { keys: "X", command: "removeFromQueue", does: "Remove from the queue", match: (e) => plain(e) && !e.shiftKey && letter(e, "x") },
  { keys: "Ctrl+L", command: "clearQueue", does: "Clear the queue (asks first)", match: (e) => ctrl(e, "l") },
];

/** The shortcut a key press means, or null. */
export function shortcutFor(e: KeyPress): Shortcut | null {
  return SHORTCUTS.find((s) => s.match(e)) ?? null;
}

/** Commands that still work while a sheet or dialog is open: the music itself. */
export const PLAYBACK: ReadonlySet<Command> = new Set(["playPause", "next", "previous", "volumeUp", "volumeDown", "mute"]);

/** Commands that also work inside the queue sheet. */
export const IN_QUEUE_SHEET: ReadonlySet<Command> = new Set([...PLAYBACK, "toggleQueue", "clearQueue"]);

/** Volume steps by 5 %. */
export const VOLUME_STEP = 0.05;
