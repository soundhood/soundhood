// How songs, lists and their sizes read on screen. Pure helpers, no React.
import { SORT_MODES, displayName, titleArtistFromName, type SortMode } from "../../lib/tracks";
import type { PlaylistFile, Track } from "../../lib/types";

/** The title a row shows: the tag, else the "Title - Artist" file name's title. */
export function trackTitle(t: Track): string {
  return t.title || titleArtistFromName(t.name).title || displayName(t.name);
}

/** The artist a row shows: the tag, else the file name's artist; "" when neither has one. */
export function trackArtist(t: Track): string {
  return t.artist || titleArtistFromName(t.name).artist;
}

/** "3:41". */
export function trackLength(t: Track): string {
  const s = Math.max(0, Math.round(t.duration_secs || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The file's format in capitals ("FLAC"), from its extension. */
export function trackFormat(t: Track): string {
  const m = /\.([^./\\]+)$/.exec(t.name);
  return m ? m[1].toUpperCase() : "";
}

/** The storage folder a song lives in, as the Folders screen names it. */
export function folderLabel(folder: string): string {
  return folder === "(all)" ? "All songs" : folder === "(root)" || !folder ? "Library folder" : folder;
}

/** "47 min", "1 h 04 min", "48 sec". */
export function totalLength(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "12 songs", "1 song". */
export function songCount(n: number): string {
  return `${n} ${n === 1 ? "song" : "songs"}`;
}

/** "12 songs, 47 min". */
export function songsMeta(tracks: readonly Track[]): string {
  const secs = tracks.reduce((sum, t) => sum + (t.duration_secs || 0), 0);
  return tracks.length ? `${songCount(tracks.length)}, ${totalLength(secs)}` : songCount(0);
}

/** A playlist's songs in its own order; lines whose file is gone are left out (as before). */
export function playlistTracks(pl: PlaylistFile, tracksByKey: ReadonlyMap<string, Track>): Track[] {
  const out: Track[] = [];
  for (const e of pl.entries) {
    const t = tracksByKey.get(e.toLowerCase());
    if (t) out.push(t);
  }
  return out;
}

/** The sort orders in plain words (the stored values stay as they were). */
export const SORT_OPTIONS: { value: SortMode; label: string }[] = SORT_MODES.map((value) => ({
  value,
  label: value.replace("\u2192", " to "),
}));
