// The fixture library as the Tauri backend would report it, and the cover images it serves.
// Covers use one brand colour (aqua or purple) or grey at stepped intensities with hard edges,
// so every pixel keeps its colour's hue and the blue-pixel scan sees no artwork blue.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

/** The made-up 50-track, 5-playlist library in fixture-library.json. */
export function loadFixture() {
  return JSON.parse(readFileSync(new URL("./fixture-library.json", import.meta.url), "utf8"));
}

/** Library-relative path of a fixture track, e.g. "Evening/Night Ferry - Amber Lanes.m4a". */
export function relPathOf(track) {
  return track.folder ? `${track.folder}/${track.file}` : track.file;
}

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Track[] exactly as `scan_music_folder` returns it under `root`: absolute paths, the first-level
 * folder or "(root)" as `playlist`, sorted byte-wise by folder then file name like the host.
 */
export function scanResult(fixture, root) {
  return fixture.tracks
    .map((t) => ({
      path: `${root}/${relPathOf(t)}`,
      name: t.file,
      playlist: t.folder || "(root)",
      title: t.title,
      artist: t.artist,
      duration_secs: t.duration_secs,
    }))
    .sort((a, b) => byteOrder(a.playlist, b.playlist) || byteOrder(a.name, b.name));
}

/** PlaylistFile[] as `list_playlists` returns it: sorted by lower-cased name. */
export function playlistResult(fixture) {
  return fixture.playlists
    .map((p) => ({ name: p.name, entries: [...p.entries] }))
    .sort((a, b) => byteOrder(a.name.toLowerCase(), b.name.toLowerCase()));
}

/** Side of every cover image, in pixels. */
export const COVER_SIZE = 192;

/** The cover colour families: the two brand colours and a neutral grey. */
export const COVER_COLOURS = {
  aqua: [0x00, 0xff, 0xbf],
  purple: [0x8c, 0x19, 0xff],
  grey: [0xb4, 0xb4, 0xb4],
};

// Intensity (0..1) of the colour at (x, y) for each pattern; the lowest step doubles as background.
const PATTERNS = {
  rings: (x, y, s) => [1, 0.45, 0.75, 0.25, 0.6, 0.18][Math.floor(Math.hypot(x - s / 2, y - s / 2) / (s / 12)) % 6],
  bands: (x, y, s) => [0.9, 0.3, 0.6, 0.18][Math.floor((x + y) / (s / 6)) % 4],
  grid: (x, y, s) => [0.18, 0.35, 0.55, 0.8, 1][(Math.floor(x / (s / 4)) * 3 + Math.floor(y / (s / 4)) * 2) % 5],
};

/** PNG bytes of one cover named "<colour>-<pattern>", e.g. "aqua-rings". */
export function coverPng(key) {
  const [colour, pattern] = key.split("-");
  const rgb = COVER_COLOURS[colour];
  const shade = PATTERNS[pattern];
  if (!rgb || !shade) throw new Error(`unknown cover "${key}"`);
  const png = new PNG({ width: COVER_SIZE, height: COVER_SIZE });
  for (let y = 0; y < COVER_SIZE; y++) {
    for (let x = 0; x < COVER_SIZE; x++) {
      const k = shade(x, y, COVER_SIZE);
      const i = (y * COVER_SIZE + x) * 4;
      png.data[i] = Math.round(rgb[0] * k);
      png.data[i + 1] = Math.round(rgb[1] * k);
      png.data[i + 2] = Math.round(rgb[2] * k);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** Every cover the fixture uses, keyed by name. */
export function coverPngs(fixture) {
  const keys = [...new Set(fixture.tracks.map((t) => t.cover).filter(Boolean))].sort();
  return Object.fromEntries(keys.map((k) => [k, coverPng(k)]));
}

/** The yt-dlp version the mocked phone plugin reports. */
export const FIXTURE_YTDLP_VERSION = "2026.10.01";

/**
 * Everything the page mock answers from, for one platform ("windows" or "android"): the scan and
 * playlist results under that platform's root, covers (base64 PNG), which track has which cover,
 * each track's length, and the saved settings store.
 */
export function pageData(fixture, platform) {
  const root = platform === "android" ? fixture.androidRoot : fixture.root;
  const coverOf = {};
  const durationOf = {};
  for (const t of fixture.tracks) {
    const abs = `${root}/${relPathOf(t)}`;
    if (t.cover) coverOf[abs] = t.cover;
    durationOf[abs] = t.duration_secs;
  }
  const covers = Object.fromEntries(Object.entries(coverPngs(fixture)).map(([k, png]) => [k, png.toString("base64")]));
  return {
    platform,
    root,
    tracks: scanResult(fixture, root),
    playlists: playlistResult(fixture),
    covers,
    coverOf,
    durationOf,
    store: { library_dir: root },
    ytdlpVersion: FIXTURE_YTDLP_VERSION,
  };
}
