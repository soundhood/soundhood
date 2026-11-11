// Songs dragged out of a list: the drag carries their paths under a type of its own, so a drop
// target (a playlist in the sidebar) can tell songs from files or text dragged in from elsewhere.
import type { Track } from "../../lib/types";
import { songCount, trackTitle } from "./trackInfo";

export const SONGS_MIME = "application/x-soundhood-songs";

/** What the drag says as plain text (another app, or a screen reader): "Glass Tide", "3 songs". */
export function dragImageText(tracks: readonly Track[]): string {
  return tracks.length === 1 ? trackTitle(tracks[0]) : songCount(tracks.length);
}

/** The paths a drop carries, or none when it is not songs from Soundhood. */
export function droppedPaths(data: DataTransfer | null): string[] {
  const raw = data?.getData(SONGS_MIME);
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
