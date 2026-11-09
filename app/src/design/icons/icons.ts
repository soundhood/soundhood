// The Soundhood icon set: one hand-drawn set on a 24 x 24 grid, 1.5 px round stroke, drawn inside
// a 2 px margin. Each entry is the inner markup of an <svg viewBox="0 0 24 24" fill="none"
// stroke="currentColor"> (Icon.tsx draws that wrapper). Glyphs that read better solid (transport,
// dots) fill with currentColor as well. This file is plain data so the screenshot harness, the
// design preview and the icon generator read the same shapes the app draws.
//
// Never use a text glyph instead (the Android WebView paints several of them as colour emoji);
// tools/token-lint.mjs refuses emoji ranges in TSX. Spec: docs/DESIGN.md, "Icons".

export const ICONS = {
  // Brand mark: a hood (arch) over three equaliser bars. Also the now-playing marker's shape.
  mark: '<path d="M4.5 19.5V12a7.5 7.5 0 0 1 15 0v7.5"/><path d="M9 19.5v-5M12 19.5v-8.5M15 19.5v-3.5"/>',

  // Transport
  play: '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.2 4.9a.8.8 0 0 0-1.2.7z" fill="currentColor"/>',
  pause:
    '<rect x="6.25" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.75" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  prev: '<path d="M6 5.5v13"/><path d="M18 6.3v11.4a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l7.9-5.7a.7.7 0 0 1 1.1.6z" fill="currentColor"/>',
  next: '<path d="M18 5.5v13"/><path d="M6 6.3v11.4a.7.7 0 0 0 1.1.6L15 12.6a.7.7 0 0 0 0-1.2L7.1 5.7a.7.7 0 0 0-1.1.6z" fill="currentColor"/>',
  shuffle:
    '<path d="M3.5 7h2.9a4 4 0 0 1 3.3 1.8l4.6 6.4a4 4 0 0 0 3.3 1.8h2.9"/><path d="M3.5 17h2.9a4 4 0 0 0 3.3-1.8l.5-.7M13.8 9.5l.5-.7A4 4 0 0 1 17.6 7h2.9"/><path d="M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  repeat:
    '<path d="M4 11.5V10a3 3 0 0 1 3-3h12.5"/><path d="M17 4.5 19.5 7 17 9.5"/><path d="M20 12.5V14a3 3 0 0 1-3 3H4.5"/><path d="M7 19.5 4.5 17 7 14.5"/>',
  repeatOne:
    '<path d="M4 11.5V10a3 3 0 0 1 3-3h12.5"/><path d="M17 4.5 19.5 7 17 9.5"/><path d="M20 12.5V14a3 3 0 0 1-3 3H4.5"/><path d="M7 19.5 4.5 17 7 14.5"/><path d="M11 11l1.25-.9v4.4"/>',

  // Player surfaces
  queue: '<path d="M4 6h13M4 11h13M4 16h7"/><path d="M15 14.2v5.6a.5.5 0 0 0 .77.42l4.3-2.8a.5.5 0 0 0 0-.84l-4.3-2.8a.5.5 0 0 0-.77.42z"/>',
  lyrics:
    '<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M8 9h8M8 12.5h5"/>',
  playlistAdd: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M18 13v7M14.5 16.5h7"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  volume:
    '<path d="M4.5 9.25h2.75L11.5 5.5v13l-4.25-3.75H4.5a.75.75 0 0 1-.75-.75v-4a.75.75 0 0 1 .75-.75z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  volumeMute:
    '<path d="M4.5 9.25h2.75L11.5 5.5v13l-4.25-3.75H4.5a.75.75 0 0 1-.75-.75v-4a.75.75 0 0 1 .75-.75z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  expand: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',

  // Navigation (tabs and sidebar)
  playlists:
    '<path d="M4 6h12M4 11h12M4 16h6.5"/><path d="M18.5 18.5V11.2l2.5.8"/><circle cx="16.75" cy="18.5" r="1.75"/>',
  artists: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.75 20a7.25 7.25 0 0 1 14.5 0"/>',
  folders:
    '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.4l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  playing: '<path d="M6.5 19.5v-6M12 19.5v-15M17.5 19.5v-10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.25"/><path d="M15.25 15.25 20 20"/>',
  settings:
    '<path d="M10.39 2.89h3.22l.47 2.32 1.25.52 1.98-1.31 2.27 2.27-1.31 1.98.52 1.25 2.32.47v3.22l-2.32.47-.52 1.25 1.31 1.98-2.27 2.27-1.98-1.31-1.25.52-.47 2.32h-3.22l-.47-2.32-1.25-.52-1.98 1.31-2.27-2.27 1.31-1.98-.52-1.25-2.32-.47v-3.22l2.32-.47.52-1.25-1.31-1.98 2.27-2.27 1.98 1.31 1.25-.52z"/><circle cx="12" cy="12" r="3"/>',
  sidebar: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M9.5 5v14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  chevronUp: '<path d="M5 15l7-7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',

  // Actions
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  edit: '<path d="M4.5 19.5l.9-4.1L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.6 18.6z"/><path d="M13.6 7.2l3.2 3.2"/>',
  trash:
    '<path d="M4.5 6.5h15M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M6.5 6.5l.8 12.2A1.9 1.9 0 0 0 9.2 20.5h5.6a1.9 1.9 0 0 0 1.9-1.8l.8-12.2M10 10.5v6M14 10.5v6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  paste:
    '<rect x="9" y="3.5" width="6" height="3" rx="1"/><path d="M9 5H7a1.5 1.5 0 0 0-1.5 1.5v12.5A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 17 5h-2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  undo: '<path d="M9 7.5 5 11.5l4 4"/><path d="M5 11.5h9.5a4.5 4.5 0 0 1 0 9H12"/>',
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12A7.5 7.5 0 0 1 17.7 7.1"/><path d="M18 3.75v3.5h-3.5M6 20.25v-3.5h3.5"/>',
  sort: '<path d="M7.5 5v14M4.5 16l3 3 3-3M16.5 19V5M13.5 8l3-3 3 3"/>',
  select: '<path d="M4 7l1.75 1.75L9 5.5M4 14l1.75 1.75L9 12.5"/><path d="M12.5 7.25H20M12.5 14.25H20M4.5 19.5H20"/>',
  drag: '<circle cx="9" cy="6" r="1.25" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.25" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.25" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.25" fill="currentColor" stroke="none"/>',
  smart: '<path d="M13.5 3 5.5 13.5H12l-1.5 7.5 8-10.5H12z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  log: '<path d="M7 3.5h7l4.5 4.5v12a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4.5M9.5 12.5h5M9.5 16h5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17"/>',
  music: '<path d="M9 17.5V6.5l10-2v11"/><circle cx="6.75" cy="17.5" r="2.25"/><circle cx="16.75" cy="15.5" r="2.25"/>',

  // States
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none"/>',
  warning:
    '<path d="M10.7 4.3a1.5 1.5 0 0 1 2.6 0l7.4 13A1.5 1.5 0 0 1 19.4 19.5H4.6a1.5 1.5 0 0 1-1.3-2.2z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="16.75" r="1" fill="currentColor" stroke="none"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.25" r="1" fill="currentColor" stroke="none"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.25l2.75 2.75L16.25 9.5"/>',
} as const;

export type IconName = keyof typeof ICONS;
