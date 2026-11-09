# The app shell

One component tree for every size. `App.tsx` calls the hooks (in an order that matters, see the
comments there) and hands everything to the screens through `AppContext` (`context.ts`, read with
`useApp()`). `AppShell.tsx` fills the design system's `Shell` slots; the Shell's container query on
its own width decides which slots show (phone under 720 px, tablet 720 to 1079, desktop from 1080).
Nothing here asks which platform it runs on to pick a layout: `isMobile` only says what the host can
do (Proton sync, the app's own bin, the old phone settings).

## Slots

| Slot | Filled by | Notes |
|---|---|---|
| `sidebar` | `AppSidebar.tsx` | wordmark, search field, Playlists / Artists / Folders / Playing with counts, the playlists, Settings, fold and resize. Width and fold are remembered (`useShellPrefs`, store keys `sidebar_width` and `sidebar_collapsed`). A rail on tablets. |
| `main` | `MainArea.tsx` | the screen `useNavigation` names; scrolls; each screen gets its scroll position back. Lists scroll with it (`scroller`). |
| `right` | `AppShell`'s `rightPane` prop | **the Queue plugs in here.** Closed (no pane) until the queue exists: pass a node to `<AppShell rightPane={...} />` and the Shell lays it out (desktop only, hidden under 600 px tall). Keep its open or closed state where the queue lives and remember it. |
| `bar` | `NowBar` (features/player) | tablet and desktop. Repeat and the queue button are left out until they work (`Transport` hides repeat without `onRepeat`; `PlayerBar` hides the queue without `onQueue`). |
| `bottom` | `NowMini` and `BottomTabs` | phone; hidden under the Playing screen (Shell `view="playing"`). |
| `overlays` | `Overlays.tsx` | in stacking order: the **settings sheet** (see below), the old dialogs, the screens' sheets (`AddToPlaylistSheet`, `NewPlaylistSheet`, `MoveToFolderSheet`), then `ToastViewport`. New dialogs go here. |

`ToastProvider` wraps the whole app, so `useToast()` works in every screen, sheet and hook called
under `AppRoot`.

## Navigation (`hooks/useNavigation.ts`)

- `tab`: Playlists, Artists or Folders (the bottom tab or sidebar item that is current).
- `detail`: an open list of songs (`playlist`, `artist`, `folder` or `all`), opened from a tab, the
  sidebar or a search result. Opening one points the library's view (`useLibrary`: `plView`,
  `artistView`, `playlist`) at it, so the songs shown are the songs Next and Previous step through,
  as before the rebuild. Back (narrower shells) closes it; the view stays, so the music goes on.
  When the library stops showing it (its playlist deleted, another library) it closes by itself.
- `playing`: the Playing screen over whatever is open. Closing it returns there.
- `query`: the search field. With no list open, text shows the **Search** screen; with a list
  open, the same field filters that list (`lib.query`). Opening a search result remembers the
  search and its tab; Back returns to both.
- `source`: the list the playing song was started from ("Playing from", the aqua playlist).
- `screen`: what `MainArea` shows, derived from the above.

Select mode and the settings sheet's open state are `usePhoneLayout`'s two flags (shared by every
layout despite the name).

## Where each feature plugs in

- **Settings** (next): replace the content of the settings sheet in `Overlays.tsx` (today
  `legacy/LegacySettings.tsx`: the old phone settings panel, or on a PC the old top bar, developer
  row, folder line, download bar and log). `actions.openSettings()` opens it from anywhere (the
  sidebar, the rail, the phone's header button). `useProton` refreshes while it is open
  (`phone.mSettings`), and `useDownloads` opens it on the phone after a shared link is queued.
- **Dialogs** (next): `Overlays.tsx` mounts the old ones inside a `.legacy` box. The old stylesheet
  (`legacyStyles.ts`) is confined to `.legacy` by `legacy/scopeCss.ts`; delete both once nothing
  old is left.
- **Queue** (next): the `rightPane` prop above; a phone sheet goes in `overlays`; the Queue and
  lyrics buttons appear when `onQueue` / `onLyrics` are passed to `PlayerBar` and `FullPlayer`
  (`features/player/PlayerSurfaces.tsx`), repeat when `onRepeat` is.
- **Keyboard**: `TrackList` handles Enter on a row; Esc leaves Select mode, clears the search and
  closes the Playing screen; 1 to 4 switch tabs (BottomTabs); Ctrl+K and `/` focus the search field.
  The rest of SHORTCUTS.md is not wired yet.

## Files

| File | What |
|---|---|
| `App.tsx` | hooks, actions, the context, the confined old stylesheet |
| `AppShell.tsx` | the Shell and its slots, the tint, the main area's scroll positions |
| `AppSidebar.tsx`, `MainArea.tsx`, `Overlays.tsx` | the slots above |
| `context.ts` | `AppContext`, `useApp()`, the shared actions |
| `screens.css` | how components sit together on a screen (tokens only) |
| `legacy/` | the old Dropdown and icons the old views still use, `LegacySettings`, `scopeCss` |
