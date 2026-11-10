// Changing the queue from any screen (the row menus, the queue itself, the keyboard), each change
// said in a toast. Taking a row out offers Undo, which puts it back where it was. The queue lives in
// memory only, so these are not journaled (playlist changes are: usePlaylistEdits).
import { useApp } from "../../app/context";
import { useToast } from "../../design";
import type { Track } from "../../lib/types";
import { songCount, trackTitle } from "../library/trackInfo";
import type { QueueSectionId } from "./queueModel";

/** "Glass Tide" for one song, "3 songs" for more. */
function whatOf(tracks: readonly Track[]): string {
  return tracks.length === 1 ? trackTitle(tracks[0]) : songCount(tracks.length);
}

export function useQueueEdits() {
  const { player } = useApp();
  const toast = useToast();

  return {
    /** Play next: after the playing song, before everything else. */
    playNext(tracks: readonly Track[]) {
      if (tracks.length === 0) return;
      player.playNextTracks(tracks);
      toast.show({ text: tracks.length === 1 ? `${whatOf(tracks)} plays next` : `${whatOf(tracks)} play next` });
    },
    /** Add to queue: after what was added before, before the rest of the list. */
    add(tracks: readonly Track[]) {
      if (tracks.length === 0) return;
      player.addToQueue(tracks);
      toast.show({ text: `Added ${whatOf(tracks)} to the queue` });
    },
    /** Takes one row out of the queue, with Undo. */
    remove(section: QueueSectionId, index: number) {
      const removed = player.removeFromQueue(section, index);
      if (!removed) return;
      const t = player.trackByPath.get(removed.entry.path);
      toast.show({
        text: `Removed ${t ? trackTitle(t) : "a song"} from the queue`,
        action: { label: "Undo", guarded: true, onClick: () => player.restoreToQueue(removed) },
      });
    },
    /** Takes every upcoming row of these songs out of the queue (X on a list). */
    removeTracks(tracks: readonly Track[]) {
      if (tracks.length === 0) return;
      const n = player.removeTracksFromQueue(tracks);
      toast.show({ text: n ? `Removed ${whatOf(tracks)} from the queue` : `${whatOf(tracks)}: not in the queue` });
    },
    /** Empties the queue after the playing song (the caller asked first). */
    clear() {
      player.clearQueue();
      toast.show({ text: "Queue cleared" });
    },
  };
}
