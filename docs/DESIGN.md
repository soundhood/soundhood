# Design system

How Soundhood looks and behaves, on every screen size, in one place. The values live in
[`app/src/design/tokens.css`](../app/src/design/tokens.css), the only file allowed to hold raw colours;
this document says where each one is used and specifies every component. Screens: [SCREENS](SCREENS.md).
Keyboard: [SHORTCUTS](SHORTCUTS.md). Why things are the way they are: [DECISIONS](DECISIONS.md).

## Principles

- **One product on every device.** One component tree, one token set, one icon set. The PC and the
  phone differ only by the size of the window (container queries on the app shell) and by the kind of
  pointer (`pointer: coarse` raises hit targets and shows actions that a mouse reveals on hover).
  Nothing in the UI asks which platform it runs on to decide a layout.
- **Quiet, then one accent.** Near-black surfaces, light grey text, and aqua used sparingly for what is
  playing or active. A screen never competes with itself ("component soup"): one primary action, the
  rest as icons or text buttons.
- **The music is the colour.** Artwork is the only colourful thing on a screen. A dark tint taken from
  the playing cover appears on player surfaces only.
- **Plain words.** Labels say what happens ("Undo", "Copy log", "Save as playlist"). No shortcut
  legends on screen; shortcuts are documented in [SHORTCUTS](SHORTCUTS.md).

## Hard rules

These come from the build brief and are checked by lints or reviewers. Breaking one fails the build.

| Rule | Checked by |
|---|---|
| Raw colour values only in `tokens.css` | `tools/token-lint.mjs` |
| No blue in UI chrome (hue 200 to 250 degrees, saturation above 0.5, at most 0.1 % of pixels; artwork and its tint exempt) | `tools/blue-scan.mjs` on the visual suite |
| No white surfaces or margins; white only as `--fg-0` text | design reviewer |
| SVG icons only; no emoji or symbol characters as icons (U+1F000 to U+1FAFF, U+2600 to U+27BF, U+2B00 to U+2BFF in TSX) | `tools/token-lint.mjs` |
| No native scrollbars, `<select>`, range, checkbox or radio look | `tools/token-lint.mjs` (`appearance`), design reviewer |
| No shortcut legends on screen; no J/K shortcuts; tap or click plays (never double-tap) | design reviewer |
| Text contrast 4.5:1 or better, UI boundaries 3:1 or better | `tools/contrast-lint.mjs` |
| At most one aqua-filled element per screen (plus hairlines and markers) | design reviewer |
| Purple never carries text or meaning alone | `tools/contrast-lint.mjs`, design reviewer |

## Colour

| Token | Value | Used for |
|---|---|---|
| `--bg-0` | `#0f0f0f` | the canvas: screens, the tab bar, the sidebar |
| `--bg-1` | `#212121` | sheets, cards, the mini player, the player bar, search fields |
| `--bg-2` | `#2a2a2a` | inputs, buttons, chips, popovers, hover on a card |
| `--bg-3` | `#333333` | pressed and selected: a selected chip, an active option, a toast |
| `--line` / `--line-strong` | white at 8 % / 14 % | 1 px separators and outlines; elevation is a surface step plus a line, never a shadow |
| `--fg-0` | `#ededed` | primary text and icons in their strong state |
| `--fg-1` | `#a3a3a3` | secondary text (artist, counts, help lines), resting icons |
| `--fg-2` | `#707070` | non-text only (drag handles, the sheet grabber): it measures 3.8:1 on `--bg-0`, below the text floor |
| `--fg-disabled` | `#4d4d4d` | disabled controls and missing files |
| `--aqua` | `#00ffbf` | the single primary: what plays (title, 3 px bar, equaliser), the active tab, the progress hairline, the focus ring, the one filled button |
| `--aqua-ink` | `#0f0f0f` | glyphs and text on aqua and on danger |
| `--aqua-dim` | aqua at 18 % | the selected-row wash, text selection |
| `--purple` | `#8c19ff` | non-text fill only: the slider's filled part, a switch that is on, badge backgrounds under light text |
| `--lilac` | `#c9a3ff` | purple-family text (outline badges), the slider knob, the switch knob when on |
| `--danger` | `#ff5c7a` | destructive buttons, error rows |
| `--warn` | `#ffb454` | warnings (a VPN is on, a helper is old) |
| `--ok` | aqua | done states |

**Aqua rationing.** Per screen: one aqua-filled element at most (the play button of the full player, or
of the player bar when the full player is not open, or a primary button in a sheet), plus markers:
the playing row, the active tab or nav item, the hairline, focus rings, a ticked checkbox, text actions
in toasts and empty states. Selected chips step up to `--bg-3` instead of turning aqua.

**Artwork tint.** A worker reduces the cover to 32 x 32, finds four colours with k-means, picks the
dominant one and clamps it in OKLCH: lightness 0.18 to 0.32, chroma at most 0.08, and at most 0.04 when
the hue is within 25 degrees of aqua (about 165) or purple (about 290), so the tint never reads as a
brand colour. The result is cached by the cover's hash and set as `--tint` on the shell. It appears in
three places only: the full player's background gradient, the top 40 % of the right pane, and a soft
glow behind the mini player's and the player bar's artwork. It changes over `--dur-xl`. Never on bars,
tabs, text, sliders or buttons.

**More contrast.** Under `prefers-contrast: more`, `--fg-1` lifts to `#c0c0c0` and the lines to 24 %
and 32 %.

## Type

Inter 4.1 (variable, with its optical-size axis), bundled in `app/src/design/fonts/` with its licence;
never loaded from a network. The About group in Settings credits it under the SIL Open Font License.

| Role | Token | Size / line, weight | Used for |
|---|---|---|---|
| display | `--t-display` | 40/44, 700, tracking -0.02em | desktop screen titles, the desktop full player's title |
| h1 | `--t-h1` | 28/34, 700, -0.02em | phone screen titles |
| h2 | `--t-h2` | 22/28, 600 | sheet titles, the phone full player's title (two lines at most), empty states |
| h3 | `--t-h3` | 17/22, 600 | section headers, the queue title, the wordmark |
| body | `--t-body` | 15/20, 450 on the phone; 14/20 on the desktop shell | rows, labels |
| body-strong | `--t-body-strong` | 15/20 (14/20), 550 | names in cards, the mini player's title, buttons |
| body-sm | `--t-body-sm` | 13/18, 400 | artists, counts, help lines |
| caption | `--t-caption` | 12/16, 500 | tab labels, times, small figures |
| overline | `--t-overline` | 11/14, 600, uppercase, tracking 0.06em | group headings, "Playing from" |

Times and counts use `font-variant-numeric: tabular-nums`. Nothing is smaller than 11 px. Rows keep
one line with an ellipsis; only the full player's title wraps to two lines.

The sizes above are at the default text size. Every type token multiplies by `--text-scale`, set on
the root element only: 1, 1.15 or 1.3, from Settings, Appearance, Text size
([DECISIONS](DECISIONS.md)).

## Space and size

A 4-point scale, `--sp-1` to `--sp-12` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px. Radii
`--r-xs` 4 (thumbs), `--r-sm` 8 (inputs, nav items), `--r-md` 12 (mosaics, search fields, popovers,
toasts), `--r-lg` 16, `--r-xl` 24 (sheets, the full player's artwork), `--r-pill` (buttons, chips).

| Size | Phone | Tablet | Desktop |
|---|---|---|---|
| side gutter `--gutter` | 16 | 24 | 32 |
| row `--row-h` (at 100 % text) | 56 | 56 | 48 |
| thumbs | 40 in rows, 48 and 56 in bars | same | same |
| bottom block | mini player 56 + tab bar 56 + inset | player bar 72 | player bar 80 |
| sidebar | none | 72 rail | 240 (200 to 320, collapsible to the rail) |
| right pane | none | none | 320 (optional, remembered; hidden when the window is under 600 px tall) |
| hit target `--hit` | 44 (touch) | 44 or 32 | 32 (mouse), with 8 px between targets |
| icons | 20, 24, 32 | same | same |

Rows grow with the text: `--row-h` adds 38 px (the two text lines a row holds) for every 100 % of
`--text-scale` above 1, so it stays 56 and 48 px at 100 % and is about 67 and 59 px at 130 %. The
VirtualList reads the computed height, so long lists keep their fixed-height rows at every text size.

Shadows only on what floats: popovers and toasts (`--shadow-float`); the full player's artwork has
`--shadow-art`. Overlays are `--bg-1` over a backdrop of black at 60 % with a 16 px blur, a solid
backdrop where `backdrop-filter` is missing (WebKitGTK).

## Motion

Durations `--dur-xs` 100, `--dur-s` 150, `--dur-m` 250, `--dur-l` 400, `--dur-xl` 500 ms. Easings
`--ease-standard`, `--ease-decel` (things arriving), `--ease-accel` (leaving), `--ease-emph` (sheets,
the tab indicator). Only transform, opacity and colour animate; never height or position offsets.

| Moment | Motion |
|---|---|
| row and button press | scale to 0.97 (buttons) or a press wash (rows), `--dur-xs` |
| play and pause | the glyph swaps with a 150 ms cross-fade |
| tab change | the aqua indicator slides, `--dur-m`, `--ease-emph` |
| mini player to full player | the full player rises from the bottom (`--dur-l`, `--ease-emph`), the artwork grows from the mini player's thumb (shared element where the WebView supports view transitions, else the rise alone) |
| sheets | rise from the bottom on the phone; fade and lift 8 px in the middle on wider shells |
| toasts | fade and lift 8 px |
| artwork tint | colour change over `--dur-xl` |
| progress hairline | `transform: scaleX()` driven by `requestAnimationFrame`, no CSS transition |
| lists | virtualised; rows never animate in |

`linear()` spring easings are an enhancement only. Under `prefers-reduced-motion: reduce` every
duration is zero except opacity fades, which stay at 120 ms or less (`--dur-opacity`); the equaliser
stands still.

## Layout

The shell is a size container (`container: shell / size`). Its width alone picks the layout:

| Shell width | Layout |
|---|---|
| under 720 px | **phone**: one screen at a time; a screen header with the title, actions and the search field; the mini player and four bottom tabs; sheets from the bottom; the full player covers everything |
| 720 to 1079 px | **tablet**: a 72 px rail of icons on the left, a 72 px player bar replaces the mini player and the tabs; sheets open in the middle |
| 1080 px and wider | **desktop**: sidebar (wordmark, search field, four nav items, the playlists), main, an optional 320 px right pane holding the queue, an 80 px player bar |
| 1440 px and wider | the main content is at most 1200 px wide, centred |
| under 600 px tall (desktop) | the right pane hides |

The same screens fill the main area at every size: Playlists, Artists, Folders, a list of tracks,
Playing, Search. Visibility helpers `.is-wide-only` and `.is-narrow-only` switch an element by shell
width, never by platform. Features that exist only on one platform (Proton sync runs inside the phone
app; on the PC the Proton Drive app mirrors the library) show or hide by what the host reports, and
that is listed as such in [SCREENS](SCREENS.md).

Insets: Android passes the system-bar and cutout insets from Kotlin as CSS variables (`--inset-top`,
`--inset-bottom`, ...); `env(safe-area-inset-*)` is not used (unreliable on the WebView floor).

## Icons

One set drawn for Soundhood in [`app/src/design/icons/icons.ts`](../app/src/design/icons/icons.ts): a
24 x 24 grid, 1.5 px round strokes inside a 2 px margin; transport glyphs and dots are solid. Drawn by
`<Icon name="..." size={20|24|32} />`; another size is allowed for a special case (18 in menus, 48 in
empty states and the first-launch steps). An icon that is the only content of a button needs an
`aria-label` on the button. The names in the brief (the gear, the bolt, the three dots) are names only:
they render as `settings`, `smart` and `more` from the set.

| Group | Icons |
|---|---|
| brand | `mark` |
| transport | `play`, `pause`, `prev`, `next`, `shuffle`, `repeat`, `repeatOne` |
| player | `queue`, `lyrics`, `playlistAdd`, `more`, `volume`, `volumeMute`, `expand` |
| navigation | `playlists`, `artists`, `folders`, `playing`, `search`, `settings`, `sidebar`, `back`, `chevronLeft`, `chevronRight`, `chevronDown`, `chevronUp`, `close` |
| actions | `plus`, `check`, `edit`, `trash`, `download`, `link`, `paste`, `copy`, `undo`, `sync`, `sort`, `select`, `drag`, `smart`, `filter`, `log`, `globe`, `music` |
| states | `info`, `warning`, `error`, `done` |

## App icon

The mark: a hood (an arch) over three equaliser bars, the same three bars that mark the playing song in
every list. Sources in [`app/src/design/brand/`](../app/src/design/brand/):

- `app-icon.svg`: aqua mark on `#0f0f0f`, rounded square; the PC, the installer and the launcher.
- `app-icon-foreground.svg`: the aqua mark inside the 66/108 safe zone for Android's adaptive icon,
  over a `#0f0f0f` background layer.
- `app-icon-mono.svg`: white mark on transparent; the tray, the Android notification, Android Auto
  and Android's themed icon.

The platform files in `app/src-tauri/icons/` and the Android resources are generated from these with
`tauri icon` ([DEV](DEV.md)); never hand-edit the generated files.

## Components

Every component is implemented once in `app/src/design/components/` and used on every screen size.
Each has a fixture page (`app/fixtures.html#<Component>`, sources in `app/src/design/fixtures/`),
photographed by the screenshot harness at the four viewports, and at 390 x 844 and 1280 x 800 in the
three modes ([TESTING](TESTING.md#visual-suite)). Sizes below are for the phone unless a desktop size
is given. ARIA roles and keys are part of the spec.

### Primitives

**Icon.** An inline SVG from the set. Decorative (`aria-hidden`) by default; given a `title` it
becomes an image named by it (`role="img"`), for an icon that carries meaning with no text beside
it, such as a BatchReport row's status. Each icon's markup is built once and reused, so a re-render
never replaces its paths in the middle of a press (that once swallowed clicks).

**IconButton.** A round hit target (`--hit`) around a 20 or 24 px icon. Resting `--fg-1`, hover
`--fg-0` with a 4 % wash, press scale 0.92, `is-on` aqua (shuffle or repeat on, the queue pane open).
`aria-label` is required; `aria-pressed` for toggles.

**Button.** A 40 px pill (32 px `is-small`). Variants: default (`--bg-2`), `is-primary` (aqua fill,
ink text; counts as the screen's one aqua fill), `is-danger` (danger fill, ink text), `is-text`
(transparent), `is-link` (aqua text, for one action in an empty state or a toast). Disabled: `--bg-2`
with `--fg-disabled` text.

**PlayButton.** The round aqua play/pause: 64 px in the full player, 40 px in the player bar. Its
glyph cross-fades between play and pause.

**Switch.** A 32 x 18 track: off `--bg-3` with a 1 px edge and a `--fg-1` knob; on `--purple` with a
`--lilac` knob. `role="switch"`, `aria-checked`, Space and Enter toggle. The whole settings row is the
click target.

**Checkbox.** A 20 px rounded square used in Select mode: off a `--fg-1` outline, on aqua with an ink
check. `role="checkbox"`, `aria-checked`.

**Slider.** A native range input drawn from scratch (`appearance: none`): a 3 px track in `--bg-3`
with a 1 px inner edge (`--track-edge`) for 3:1 boundary contrast, the filled part in `--purple` up to
`--percent`, a 12 px `--lilac` knob (16 px on touch) that grows to 1.25x while dragged. Times beside
it in caption tabular figures. Arrow keys step 5 s (position) or 5 % (volume); Home and End.

**Chip.** A 32 px pill under a search field: resting outline `--line-strong` with `--fg-1` text;
pressed `--bg-3` with `--fg-0`. `aria-pressed`. A row of chips scrolls sideways without a scrollbar.

**Badge.** An 18 px pill: purple fill with light text (the smart-playlist bolt), or `is-outline` lilac
text (Generated lyrics).

**SearchField.** A 40 px field on `--bg-1` with a search icon and, while it has text, a clear button.
Esc clears it, then leaves it. On the phone and the tablet it sits under the screen title of
Playlists, Artists and Folders, and of an open list, which it then filters; on the desktop it lives in
the sidebar. Typing anywhere on a list screen with a mouse and keyboard does not hijack focus; Ctrl+K
and `/` focus it.

**TextField.** A 40 px input on `--bg-2` with a 1 px line; the placeholder in `--fg-1`.

**Dropdown and MultiSelect.** A button showing the value and a chevron that opens a popover listbox
(`--bg-2`, `--r-md`, `--shadow-float`) of 36 px options; the chosen option has an aqua check.
`role="combobox"` on the button with `aria-expanded` and `aria-controls`, `role="listbox"` and
`role="option"` with `aria-selected`; Up and Down move, Enter or Space picks, Esc closes, typing jumps
to the first option starting with the typed letters. MultiSelect keeps the popover open and toggles
options; its button shows "None", one name, or "N chosen". The popover flips upward when there is no
room below. Never a native `<select>`.

### Lists

**Thumb.** Artwork at 40 px (`--r-xs`), round for artists, a folder icon on `--bg-2` for folders.
Lazy-loaded; until it loads, `--bg-2`.

**Mosaic.** A square of four covers (2 x 2, no gap), `--r-md`; one cover filling the square when a
playlist has fewer than four different covers; a playlist icon on `--bg-2` when it has none. 40 px in
rows and the sidebar, full width in cards.

**Equaliser.** Three 3 px aqua bars, 14 px tall, bouncing while the song plays, still while paused or
under reduced motion. Marks the playing song's row, card and sidebar item.

**TrackRow.** `--row-h` tall (56 phone, 48 desktop, at 100 % text). Anatomy: optional checkbox
(Select mode) or drag handle (edit mode), thumb, title over artist, the folder name (desktop shell
only, a storage hint), duration, a "more" icon button (revealed on hover with a mouse, always shown
on touch). States: playing (a 3 px aqua bar on the left edge, aqua title, the equaliser before the
title), selected
(aqua-dim wash and a ticked checkbox), missing (a playlist line whose file is gone: disabled text,
"Missing file" under the title; never dropped), hover and press washes. Behaviour: tap or click plays
the row (in Select mode it ticks the row); with a mouse, Ctrl+click and Shift+click select without
playing, and Enter plays the selection; Space plays and pauses; Delete removes from the open playlist
or queue (tier 2, toast with Undo). `role="option"` inside a `role="listbox"` with roving tabindex
(Up and Down move, Home and End). The "more" button is outside the tab order; the ContextMenu key or
Shift+F10 on the row opens the same menu.

**Row menu.** A song row's actions, opened by its "more" button, a right click, a long press on
touch, or the ContextMenu key or Shift+F10. It acts on the row's song, or on the whole selection when
the row is part of it: Play next, Add to queue, Add to playlist, Go to artist and Edit tags (one song
only; Go to artist is disabled on that artist's own list), Remove from the open playlist (only while
one is open and holds the songs), and Delete as a danger item. It is the MenuButton's popover (the
same look and keys: Up, Down, Home, End, Enter or Space, typed letters, Esc and Tab close), drawn in
the shell's overlay layer against the button or at the pointer, kept inside the shell, because a row
of a virtual list cannot hold a popover. It closes when the list scrolls or the window changes size,
and the focus returns to the row. The full player's "more" offers the same items for the playing song
(FullPlayer, below).

**ListRow.** The row for artists, folders, playlists and search results: thumb, name over a meta line
(song count, "Artist", "Playlist"), a count or a chevron on the right.

**PlaylistCard.** A mosaic with the playlist's name under it (body-strong, one line, an ellipsis when
too long) and "N songs, duration" (body-sm, wrapping balanced onto a second line rather than losing
the duration at a large text size). The playing playlist's name is aqua with the equaliser. Cards
fill a grid of columns at least 150 px wide (two on the phone, four to six on the desktop). Tap opens
the playlist; the "more" menu holds Play, Shuffle (both off for an empty playlist) and Delete
playlist. There is no Rename: the host has no command to rename a playlist yet.

**SectionHeader.** An h3 heading with an optional text action on the right ("Show all 5").

**VirtualList.** Renders only the rows in view (plus a few above and below) for any list that can be
long (the whole library is about 2,400 tracks): fixed row height from `--row-h`, keeps the keyboard
position and the scroll position when the list changes, never animates rows in.

**Skeleton.** Placeholder rows (thumb and two lines on `--bg-2`) while the index builds; a slow
opacity pulse, still under reduced motion.

**ErrorRow.** A row on a faint danger wash with a 3 px danger bar on the left, an error icon, a plain
title and one line saying what to do, and two icon buttons: Copy log and Retry. Used for a failed
download, a failed sync, an unreadable folder.

**EmptyState.** A 48 px line icon in `--fg-1`, an h2, one body-sm line, and at most one aqua text
action. Never an illustration. Copy is in [SCREENS](SCREENS.md).

### Player

**Hairline.** A 2 px aqua line scaled by the playing position (`scaleX`, moved by
`requestAnimationFrame`), on the top edge of the mini player; above the phone's tab bar.

**MiniPlayer.** 56 px on `--bg-1`, the hairline on its top edge; the cover (40 px, with a soft glow of
the artwork tint), title over artist, play/pause, next and the queue button (it opens the queue
sheet). Tap or swipe up opens the full player.

**FullPlayer.** On the phone a sheet over everything (the tabs hide under it): a top row with "close"
and where the music is playing from; the artwork (at most 80 % of the width, `--r-xl`); the title (h2,
two lines at most) and the artist; the position slider with times; the transport row (shuffle, previous,
the 64 px aqua play button, next, repeat); a bottom row of queue, lyrics, add to playlist and more.
"More" is a MenuButton with the row menu's items for the playing song alone: Add to playlist, Go to
artist (which closes the player), Edit tags and Delete; Play next, Add to queue and Remove from a
playlist make no sense for the song already playing and are left out. Its keys and ARIA are the
MenuButton's, as the row menu's.
The background is a gradient from the artwork tint into `--bg-0`. Swipe down or Esc closes it. On a
shell wide enough for the player bar the same component lays out in two columns (artwork; then where it
plays from, the title in display size, the artist, facts such as length and format, and the action row)
and leaves the transport to the player bar.

**PlayerBar** (tablet and desktop). 80 px (72 on a tablet) on `--bg-1`, three zones: now playing (56 px
cover with the tint glow, title over artist, add to playlist); the transport (shuffle, previous, the
40 px aqua play button, next, repeat) over the position slider with times; tools (lyrics, queue, volume
icon and a 96 px volume slider, open the full player). On a tablet the times and the volume slider
hide.

**QueueSheet / Queue.** The play queue: a sticky "Now playing" row, then "Next from <source>" rows
(and "Next in queue" for songs added with Play next or Add to queue). Rows drag to reorder (handle with
a mouse, long-press on touch) and swipe left to remove (Delete or X with a keyboard); footer buttons
Save as playlist and Clear (Clear asks first). It lives in the right pane wherever the pane fits (a
desktop window at least 600 px tall), and Q or the player bar's queue button toggles the pane;
everywhere else (the phone, the tablet, a short window) it is a 92 % sheet, opened by the queue
buttons of the mini player, the player bar and the full player.

**LyricsPane.** Plain or timed lines. Timed lines: the current line in `--fg-0` at h3, the rest
`--fg-1`, the pane scrolls to keep the current line a third from the top; tapping a line seeks there.
A lilac outline badge "Generated" when the lyrics were not written by a person. Empty state when there
are none. Data arrives in Phase 5; until then the lyrics buttons are not shown.

### Shell and navigation

**Shell.** The size container and its grid areas (sidebar, main, right pane, player bar, bottom
block); overlays (sheets, popovers, toasts) are inside it so they follow the same container queries.

**ScreenHeader.** The title (h1 on the phone, display on the desktop) with a meta line (counts) and up
to two icon actions; below the desktop width (the phone, and the tablet, whose rail has no room for
it) the search field and, while searching, the chips under it. Below the desktop width the title
wraps onto a second line rather than give way to the counts and actions (at 130 % text a short name
does not fit beside them), and ends in an ellipsis only past two lines.

**BottomTabs** (phone). Four tabs: Playlists, Artists, Folders, Playing; 56 px plus the bottom inset on
`--bg-0` with a 1 px line on top. Icon over a caption label; the active tab aqua, with a short aqua bar
on the tab bar's top edge that slides to it. No pills. Playing is disabled while nothing plays. Hidden
under the full player. `role="tablist"`; keys 1 to 4 switch tabs with a keyboard.

**DesktopSidebar.** 240 px (200 to 320 by dragging its edge; collapses to the 72 px rail with the
sidebar button), on `--bg-0` with a 1 px line on its right: the wordmark (aqua mark and "Soundhood"),
the search field, four nav items (icon, label, count; the current one on `--bg-1` with an aqua icon)
and a fifth, Download, while the downloader is on (it opens "Where should this go?" with an empty
link), "Playlists" with a new-playlist button and the list of playlists (mosaic, name, the equaliser
on the playing one), and a footer with Settings and the collapse button. Tracks dragged from a list
onto a playlist here are added to it (tier 2, toast with Undo); songs it already holds are left out,
and a drop that adds nothing says so in a toast without Undo.

**RightPane** (desktop). 320 px on `--bg-0` with the artwork tint across its top 40 %; holds the Queue.
Open or closed is remembered.

### Overlays

**Modal / Sheet.** Every dialog is one component: on the phone a bottom sheet (rounded top `--r-xl`, a
32 x 4 grabber in `--fg-2`, swipe down or tap the backdrop to close), on wider shells a centred panel
(at most 640 px wide, `--r-xl`, `--shadow-float`). A title (h2) and a close button; a body that
scrolls; a footer with the actions right-aligned: the primary as the aqua pill (40 px), a destructive
action as the danger pill, Cancel as a text button. On open the focus moves to the sheet itself, so
its title is read out, and the panel draws no focus ring for it (the ring belongs to the controls
inside); a sheet built around one field starts in that field instead (Edit tags, New playlist, "Where
should this go?" opened with an empty link). Focus is trapped in the sheet; Esc closes; focus returns
to what opened it. `role="dialog"`, `aria-modal`, labelled by its title.

**Toast.** Bottom centre, above the mini player or the player bar, `--bg-3`, `--r-md`,
`--shadow-float`, body-sm text and at most one text action: Undo (a tier-2 playlist change, a song
taken out of the queue), Retry (a failed download), Cancel (the phone's running download) or Settings
(a link that arrived while the downloader is off). Stays 4 s (longer while hovered or focused), at
most two at once, the newest at the bottom. A download toast stays while the download runs, with a
purple progress line on its bottom edge. `role="status"` (polite).

**SettingsSheet.** One component on every device: the phone's settings sheet and the desktop's
Ctrl+comma dialog. Groups in this order, each an overline heading over rows: Library, Playback, YouTube,
Online lookups, Lyrics, Proton Drive, Car, Appearance, Tools, About. A row is a label (body) with an
optional help line (body-sm, `--fg-1`) and one control on the right: a Switch, a Dropdown, a small
Button, or a value with a chevron that opens a sub-sheet. A group appears only when it has a row that
works in this version; rows arrive with the phase that builds them. Copy log is in Tools on every
device. YouTube opens with the **Downloader** switch: while it is off, every download control is
hidden (the rest of the group, the sidebar's and the rail's Download item) and a link that arrives
(Ctrl+V, a share) gets a toast with a Settings action instead of "Where should this go?". A new
install starts with it off, an existing install keeps it on. Under About sits the hidden Developer
group (Test library, self-test, Rebuild index), shown and hidden by 7 taps on the version row on the
phone or Ctrl+Alt+Shift+D on the PC.

**BatchReport.** The modal that ends every tier-1 batch (tag writes, moves, renames, deletes; the 349
rule): a title saying what was done ("Moved 3 songs to the bin"), counts (done, skipped with the reason,
failed), the rows with before and after, and two buttons: **Undo this batch** and Done. It never closes
by itself: no timer, a backdrop tap does nothing, Esc counts as Done. Over eight rows the list is a
VirtualList in a tall sheet. A selection is still one journaled change per song, so Undo this batch
undoes the batch's own changes newest first, checking before each one that it is still the newest
change on this device, and stops at the first that is not, with a line saying which change is in the
way; the report that follows says how many were undone ("Undid 2 of 3 changes"). Undo this batch is
left out when nothing was applied and on the report of an undo.

**TidyRow.** A proposed change waiting for a tick in Tidy (Phase 2): a checkbox, before and after
(changed parts in `--fg-0`, unchanged in `--fg-1`), a confidence hint, and the reason.

**SelectModeBar.** While songs are chosen (Select mode, or Ctrl+click and Shift+click with a mouse):
Leave Select mode, "N chosen", Select all or Select none (words where there is room, an icon on
narrower shells), then the actions as icon buttons: Add to playlist, Remove from the open playlist
(only while one is open and holds some of them) and Edit tags (one song only); the rarer ones in a
"More actions" menu: Move to folder (only on a folder's list or All songs, the storage views) and
Delete as a danger item. Play and Add to queue are not on it; the rows' menu has them for a
selection. It stays in view at the top of the list; below the desktop width it takes the screen
header's place, on the desktop it sits above the list. Esc leaves Select mode.

**Where should this go? sheet.** After a link is shared or pasted, or from the sidebar's Download item
with an empty link: the link, the folder it lands in (a Dropdown with "New folder"), the playlists it
joins (a MultiSelect), and Cancel, Queue and the primary Download.

**Onboarding.** Three skippable steps, one screen each, shown once on a first launch: Library (the
folder, or the phone's All-files permission then the folder; the index builds in the background with a
progress row), Online lookups (one switch, off, two lines saying what it enables and that nothing is
sent otherwise), YouTube helper (Enable downloader, off; "Keep download helper updated", off). The aqua
mark on the first step, no illustrations; EmptyState styling. Skipped by the upgrade rule when an
existing install is found ([DECISIONS](DECISIONS.md)), except that an existing install with no music
folder set is shown the Library step alone. On the phone the Library step is a path field with the
standard Music folder filled in; Android's All-files permission is asked when the app starts.

## Accessibility

- Text 4.5:1 or better: only `--fg-0`, `--fg-1`, `--aqua` and `--lilac` on `--bg-0`, `--bg-1`,
  `--bg-2` (checked by `tools/contrast-lint.mjs`); UI boundaries 3:1 or better.
- A 2 px aqua outline on `:focus-visible` everywhere, never removed. The one exception is a sheet's own
  panel, which takes the focus on open only so its title is read out (Modal / Sheet, above).
- Roving tabindex in lists; every icon button has an `aria-label`; the now-playing title and toasts are
  live regions.
- The layout survives 130 % text size (photographed in the visual suite).
- `prefers-reduced-motion` and `prefers-contrast: more` are honoured (above).

## Rendering floor

Android System WebView on the phone (Chromium 140 is the floor), WebView2 Evergreen on Windows,
WebKitGTK on Linux. `linear()` easing, view transitions, scroll-driven animations and
`backdrop-filter` are progressive enhancements with solid fallbacks. Container queries,
`color-mix()` and `:focus-visible` are required and present on all three.

## Verification

- **Visual suite** (Playwright, [TESTING](TESTING.md#visual-suite)): every screen and every component
  fixture page at 390 x 844, 834 x 1194, 1280 x 800 and 1920 x 1080 in the default mode, and the
  screens (Playlists, Artists, Folders, an open playlist, Playing, Queue, Search, Settings) and every
  component fixture page at 390 x 844 and 1280 x 800 with reduced motion, more contrast and 130 %
  text, against committed baselines (0.2 % tolerance). The settings sheet is photographed over
  Folders, not over the Playlists cover grid: the backdrop's blur mixes aqua and purple covers into
  pixels the blue scan counts as blue chrome.
- **Parity grid**: the phone and desktop screenshots of the parity screens (Playlists, Artists,
  Folders, an open playlist, Playing, Queue, Search and Settings, default mode) side by side ([TESTING](TESTING.md#evidence-rules)); every difference must come
  from the container size, the pointer, or what the host can do (as [SCREENS](SCREENS.md) lists it).
- **Lints**: token lint, contrast lint, blue scan, hygiene lint.
- **Real devices**: the Windows WebView2 window and the phone, with the Test library, committed under
  `docs/evidence/phase-1/`.
