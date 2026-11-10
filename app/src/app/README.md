# The app shell

One component tree for every size. `App.tsx` calls the hooks (in an order that matters, see the
comments there) and hands everything to the screens through `AppContext` (`context.ts`, read with
`useApp()`). `AppShell.tsx` fills the design system's `Shell` slots; the Shell's container query on
its own width decides which slots show (phone under 720 px, tablet 720 to 1079, desktop from 1080).
Nothing here asks which platform it runs on to pick a layout: `isMobile` only says what the host can
do (Proton sync, the app's own bin instead of the Recycle Bin, a typed music folder instead of the
folder picker, the download helper's version and Update, cancelling a download, and which gesture
shows the developer section). The screens as the user sees them: [SCREENS](../../../docs/SCREENS.md).

## Slots

| Slot | Filled by | Notes |
|---|---|---|
| `sidebar` | `AppSidebar.tsx` | wordmark, search field, Playlists / Artists / Folders / Playing with counts, Download while the downloader is on, the playlists (songs dropped on one are added, with Undo), Settings, fold and resize. Width and fold are remembered (`useShellPrefs`). A rail on tablets. |
| `main` | `MainArea.tsx` | the screen `useNavigation` names; scrolls; each screen gets its scroll position back. Lists scroll with it (`scroller`). |
| `right` | the Queue (`features/queue`, `QueuePane`) | on a window at least 1080 px wide and 600 px tall, while open; otherwise the queue opens as a 92 % sheet (`QueueOverlays`). The queue buttons (mini player, player bar, full player) and Q toggle it: the pane where it fits, else the sheet. The pane's open or closed state is remembered (`QueueUi`). |
| `bar` | `NowBar` (`features/player`) | tablet and desktop: now playing with Add to playlist, the transport with Repeat over the time line, the queue button, mute and volume, the button that opens or closes Playing. |
| `bottom` | `NowMini` and `BottomTabs` | phone; hidden under the Playing screen (Shell `view="playing"`). |
| `overlays` | `Overlays.tsx`, then `QueueOverlays`, then `KeyboardShortcuts` | sheets stack in the order they open, whatever their place here: the newest is drawn on top and takes the focus and the keys (`Sheet`, `topSheet()`). In mount order: the settings sheet and its sub-sheets, the screens' sheets (`AddToPlaylistSheet`, `NewPlaylistSheet`, `MoveToFolderSheet`), the dialogs (edit tags, the two deletes), `Downloads` ("Where should this go?" and the running download's toast), `WriteReport` (the BatchReport that ends a tier-1 write), `Onboarding`, then `ToastViewport`. After them the queue sheet and "Clear the queue?", and last the keyboard listener, so the components that own a key handle it first. New dialogs go in `Overlays.tsx`. |

`ToastProvider` wraps the whole app, so `useToast()` works in every screen, sheet and hook called
under `AppRoot`. There is no status line: `useNotices` routes each message to a toast, a toast with
Undo, the log, or nowhere (progress words that have their own indicator).

## Navigation (`hooks/useNavigation.ts`)

- `tab`: Playlists, Artists or Folders (the bottom tab or sidebar item that is current).
- `detail`: an open list of songs (`playlist`, `artist`, `folder` or `all`), opened from a tab, the
  sidebar, a search result or a row's "Go to artist". Opening one points the library's view
  (`useLibrary`: `plView`, `artistView`, `playlist`) at it, so the songs shown are the songs Next and
  Previous step through, as before the rebuild. Back (narrower shells) closes it; the view stays, so
  the music goes on. When the library stops showing it (its playlist deleted, another library) it
  closes by itself.
- `playing`: the Playing screen over whatever is open. Closing it returns there.
- `query`: the search field. With no list open, text shows the **Search** screen; with a list
  open, the same field filters that list (`lib.query`). Opening a search result remembers the
  search and its tab; Back returns to both.
- `source`: the list the playing song was started from ("Playing from", the aqua playlist).
- `screen`: what `MainArea` shows, derived from the above.

Select mode and the settings sheet's open state are `usePhoneLayout`'s two flags (shared by every
layout despite the name).

## Where each feature plugs in

- **Settings**: `features/settings/SettingsSheet.tsx`, mounted first in `Overlays.tsx`. Its groups
  come from their features: `LibraryGroup` (`features/settings`), `YouTubeGroup` (`features/ingest`),
  `ProtonGroup` (`features/sync`, phone only); Appearance, Tools, About and the hidden Developer
  group are in the sheet itself. Its sub-sheets are View log (`features/log/LogSheet.tsx`) and Links
  waiting (`features/ingest/LinksWaitingSheet.tsx`). The sheet registers Ctrl+comma;
  `actions.openSettings()` opens it from anywhere (the sidebar, the rail, the phone's header button,
  the "downloader is off" toast). `useProton` refreshes while it is open (`phone.mSettings`). The
  Appearance switch "Show the queue beside the list" appears only when the sheet is given a
  `queuePane` prop, which `Overlays.tsx` passes where the right pane fits (`QueueUi`'s `paneFits`).
- **Dialogs**: `features/tags/EditTagsDialog.tsx`, `features/dialogs/DeleteTracksDialog.tsx` and
  `DeletePlaylistDialog.tsx`, opened through `useDialogs`; `features/dialogs/WriteReport.tsx` draws
  the report `useTrackEdits` holds after a tag write, a move, a delete or an undo. The sheets any
  screen opens for a set of songs are in `features/playlists/PlaylistSheets.tsx`, opened through
  `actions.addToPlaylist`, `actions.newPlaylist` and `actions.moveToFolder`.
- **Downloads**: `features/ingest/Downloads.tsx` over `hooks/useDownloads.ts`: the Ctrl+V listener,
  "Where should this go?" and the download's toast. The downloader switch (`prefs.downloader`)
  gates all of it.
- **First-launch setup**: `features/onboarding/Onboarding.tsx`. `useStartup` reads the store and
  decides the steps with `decideOnboarding` (`hooks/usePrefs.ts`, the migration rule).
- **Queue**: the model is `features/queue/queueModel.ts` (pure, unit-tested); the player hook owns
  one queue; position and length live in `features/player/playbackClock.ts`, read only by the
  surfaces that show them, so lists do not re-render on every tick. `features/queue/QueueUi.tsx`
  says where it shows and whether it is open.
- **Keyboard**: one map, `app/keyboard.ts`, run by `KeyboardShortcuts.ts`; the list is
  [SHORTCUTS](../../../docs/SHORTCUTS.md). Ctrl+comma (settings), Ctrl+V (paste a link) and
  Ctrl+Alt+Shift+D (the developer section, `hooks/useDevMode.ts`) are registered by their features.

## Store keys

One settings store, the file `music-hood.json` (`lib/store.ts`; the name is permanent). The keys
the shell and the Phase 1 settings add:

| Key | Written by | Holds |
|---|---|---|
| `sidebar_width` | `hooks/useShellPrefs.ts` | the desktop sidebar's width in px, 200 to 320 |
| `sidebar_collapsed` | `hooks/useShellPrefs.ts` | the sidebar folded to the rail |
| `queue_pane_open` | `features/queue/QueueUi.tsx` | the queue's right pane is open |
| `text_scale` | `hooks/usePrefs.ts` | Text size: 1, 1.15 or 1.3, applied as `--text-scale` on the root element |
| `downloader_enabled` | `hooks/usePrefs.ts`, `hooks/useStartup.ts` | the Downloader switch; written at the first start of a version with it: on for an existing install, off for a new one |
| `online_lookups` | `hooks/usePrefs.ts` | the setup's Online lookups switch (nothing reads it yet) |
| `helper_auto_update` | `hooks/usePrefs.ts` | the setup's Keep download helper updated switch (nothing reads it yet) |
| `onboarding_done` | `hooks/usePrefs.ts`, `hooks/useStartup.ts` | the first-launch setup is over and never shows again |

The keys from before Phase 1, read at start by `hooks/useStartup.ts`: `library_dir`,
`download_target`, `download_playlists`, `share_queue`, `last_sync`, `volume`, `sort`, and for the
developer section `dev_mode`, `fixture_root` and `real_library_dir` (`hooks/useDevMode.ts`). Any of
these, or the two sidebar keys, means the app ran here before (`EARLIER_KEYS` in `hooks/usePrefs.ts`):
an existing install, which the setup leaves alone.

## Files

| File | What |
|---|---|
| `App.tsx` | the hooks, in order, the shared actions, the context |
| `AppShell.tsx` | the Shell and its slots, the tint, the main area's scroll positions |
| `AppSidebar.tsx`, `MainArea.tsx`, `Overlays.tsx` | the slots above |
| `context.ts` | `AppContext`, `useApp()`, the shared actions |
| `keyboard.ts`, `keyboard.test.ts` | the keyboard map and its unit tests |
| `KeyboardShortcuts.ts` | the one listener that runs the map |
| `screens.css` | how components sit together on a screen (tokens only) |
