// Invented data for the fixture pages: made-up songs, artists and playlists, and covers in aqua,
// purple and greyscale only (so the blue scan of the screenshots stays meaningful).
import aquaArch from "./covers/aqua-arch.svg";
import aquaDots from "./covers/aqua-dots.svg";
import aquaRings from "./covers/aqua-rings.svg";
import aquaWaves from "./covers/aqua-waves.svg";
import greyArch from "./covers/grey-arch.svg";
import greyDots from "./covers/grey-dots.svg";
import greyRings from "./covers/grey-rings.svg";
import greyWaves from "./covers/grey-waves.svg";
import purpleGrid from "./covers/purple-grid.svg";
import purpleHalf from "./covers/purple-half.svg";
import purpleStripes from "./covers/purple-stripes.svg";
import purpleSun from "./covers/purple-sun.svg";

export const COVERS = {
  aquaArch,
  aquaDots,
  aquaRings,
  aquaWaves,
  greyArch,
  greyDots,
  greyRings,
  greyWaves,
  purpleGrid,
  purpleHalf,
  purpleStripes,
  purpleSun,
};

export interface FxTrack {
  key: string;
  title: string;
  artist: string;
  duration: string;
  seconds: number;
  cover: string;
  folder: string;
}

const t = (title: string, artist: string, duration: string, cover: string, folder = "Downloads"): FxTrack => {
  const [m, s] = duration.split(":").map(Number);
  return { key: title.toLowerCase().replace(/\W+/g, "-"), title, artist, duration, seconds: m * 60 + s, cover, folder };
};

export const TRACKS: FxTrack[] = [
  t("Northbound", "Neon Harbor", "3:41", purpleSun, "Rips"),
  t("Window Seat", "The Quiet Engines", "4:02", greyWaves),
  t("Glass Tides", "Neon Harbor", "3:18", aquaRings, "Rips"),
  t("Tin Roof Rain", "Nova Tamsin", "2:52", aquaArch),
  t("Night Ferry", "Copper Kites", "3:55", greyDots, "Vinyl"),
  t("Moth and Flame", "Saltwater Radio", "4:21", purpleStripes),
  t("Citrus Hour", "Copper Kites", "3:07", greyArch, "Vinyl"),
  t("Sleepless Atlas", "Velvet Static", "5:12", purpleGrid),
  t("Paper Moon Motel", "Paper Lanterns", "3:33", aquaDots),
  t("Afterglow Avenue", "Low Tide Club", "3:48", purpleHalf),
  t("Slow Static", "Velvet Static", "4:10", greyRings),
  t("Harbour Lights", "Neon Harbor", "3:26", aquaWaves, "Rips"),
];

/** The props a TrackRow takes from a song. */
export const row = ({ title, artist, duration, cover, folder }: FxTrack) => ({ title, artist, duration, cover, folder });

/** The song that plays on every fixture page. */
export const NOW = TRACKS[3];

/** The artwork tint of NOW's cover as tintFromPixels gives it (the Tint page shows it computed). */
export const TINT = "oklch(0.255 0.040 176.4)";

export interface FxPlaylist {
  id: string;
  name: string;
  count: number;
  length: string;
  covers: string[];
  playing?: boolean;
}

const pl = (name: string, count: number, length: string, idx: number[], playing = false): FxPlaylist => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  count,
  length,
  covers: idx.map((i) => TRACKS[i].cover),
  playing,
});

export const PLAYLISTS: FxPlaylist[] = [
  pl("Late Night Drive", 12, "47 min", [0, 3, 2, 7], true),
  pl("Morning Focus", 10, "38 min", [1, 10, 6, 4]),
  pl("Gym Rotation", 9, "31 min", [5, 0, 9, 11]),
  pl("Favourites", 14, "52 min", [3, 8, 5, 1]),
  pl("Sunday Kitchen", 8, "29 min", [6, 4, 8, 10]),
  pl("Neon Nights", 6, "21 min", [2]),
  pl("Road Trip", 17, "1 h 04 min", [9, 7, 0, 6]),
  pl("Rainy Days", 11, "41 min", [10, 1, 3, 11]),
];

export const meta = (p: FxPlaylist) => `${p.count} songs, ${p.length}`;

const FIRST = ["Silver", "Quiet", "Paper", "Velvet", "Copper", "Neon", "Salt", "Amber", "Hollow", "Lunar", "Static", "Northern"];
const SECOND = ["Harbor", "Engines", "Lanterns", "Kites", "Radio", "Tides", "Avenue", "Atlas", "Motel", "Ferry", "Rain", "Club"];
const COVER_LIST = Object.values(COVERS);

/** A deterministic library of `n` songs (the VirtualList page uses 2,400, the size of the real one). */
export function library(n: number): FxTrack[] {
  return Array.from({ length: n }, (_, i) => {
    const a = FIRST[i % FIRST.length];
    const b = SECOND[Math.floor(i / FIRST.length) % SECOND.length];
    const secs = 150 + ((i * 37) % 180);
    const duration = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return {
      key: `song-${i}`,
      title: `${a} ${b} ${i + 1}`,
      artist: `${SECOND[(i * 5) % SECOND.length] === b ? "The " : ""}${FIRST[(i * 7) % FIRST.length]} ${SECOND[(i * 3) % SECOND.length]}`,
      duration,
      seconds: secs,
      cover: COVER_LIST[i % COVER_LIST.length],
      folder: ["Downloads", "Rips", "Vinyl"][i % 3],
    };
  });
}

const GREYS = [greyArch, greyDots, greyRings, greyWaves];

/**
 * The same cover in greyscale. Pages that put a blurred backdrop over the shell use it: the 16 px
 * blur mixes an aqua cover with a purple neighbour into blue, which the blue scan (rightly) counts.
 */
export function grey(cover: string): string {
  const i = COVER_LIST.indexOf(cover);
  return GREYS[(i < 0 ? 0 : i) % GREYS.length];
}

/** Nothing happens in a fixture: callbacks are wired to this. */
export const noop = () => {};
