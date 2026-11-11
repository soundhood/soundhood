// What a playlist add or remove says in its toast. The count comes from the write's own report (the
// core's label counts the songs it really added or removed: "Added 1 track to Late Night"), so a
// gesture that was partly in effect already says so: "Added 1 song to Late Night; 1 was already
// there". Pure, no React.
import type { Change } from "../../coreIpc";
import type { Track } from "../../lib/types";
import { songCount, trackTitle } from "../library/trackInfo";

/** "Glass Tide" for one song, "3 songs" for more. */
function whatOf(tracks: readonly Track[]): string {
  return tracks.length === 1 ? trackTitle(tracks[0]) : songCount(tracks.length);
}

/**
 * How many songs a playlist add or remove really added or removed, read from its own change's label
 * ("Added 2 tracks to Late Night", "Removed 1 track from Focus"); null when the label does not say.
 */
export function songsChanged(change: Change | null | undefined): number | null {
  const m = change ? /^(?:Added|Removed) (\d+) tracks? (?:to|from) /.exec(change.label) : null;
  return m ? Number(m[1]) : null;
}

const were = (n: number) => `${n} ${n === 1 ? "was" : "were"}`;

/**
 * The toast after adding `tracks` to `name`. `change`: the add's own change (null: it changed
 * nothing); `sure`: false when its report did not come back in time (then the words claim nothing
 * the app does not know).
 */
export function addedText(name: string, tracks: readonly Track[], change: Change | null, sure: boolean): string {
  if (!change) return sure ? `Already in ${name}` : `Added ${whatOf(tracks)} to ${name}`;
  const n = songsChanged(change);
  if (n !== null && n < tracks.length) return `Added ${songCount(n)} to ${name}; ${were(tracks.length - n)} already there`;
  return `Added ${whatOf(tracks)} to ${name}`;
}

/** The toast after taking `tracks` out of `name`; as `addedText`. */
export function removedText(name: string, tracks: readonly Track[], change: Change | null, sure: boolean): string {
  if (!change) return sure ? `Not in ${name}` : `Removed ${whatOf(tracks)} from ${name}`;
  const n = songsChanged(change);
  if (n !== null && n < tracks.length) return `Removed ${songCount(n)} from ${name}; ${were(tracks.length - n)} not in it`;
  return `Removed ${whatOf(tracks)} from ${name}`;
}
