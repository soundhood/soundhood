// Adding songs to a playlist and taking them out, from any screen: the existing playlist calls
// (journaled by the core), then a toast that says what happened, with Undo for a few seconds.
import { useApp } from "../../app/context";
import { useToast } from "../../design";
import type { Track } from "../../lib/types";
import { songCount, trackTitle } from "../library/trackInfo";

/** "Glass Tide" for one song, "3 songs" for more. */
function whatOf(tracks: readonly Track[]): string {
  return tracks.length === 1 ? trackTitle(tracks[0]) : songCount(tracks.length);
}

export function usePlaylistEdits() {
  const { playlists, actions } = useApp();
  const toast = useToast();
  const undo = { label: "Undo", onClick: () => actions.undoLast() };

  return {
    async add(name: string, tracks: Track[]) {
      const ok = await playlists.addToPlaylist(name, tracks);
      toast.show(ok ? { text: `Added ${whatOf(tracks)} to ${name}`, action: undo } : { text: `Could not add to ${name}` });
      return ok;
    },
    async remove(name: string, tracks: Track[]) {
      const ok = await playlists.removeFromPlaylist(name, tracks);
      toast.show(ok ? { text: `Removed ${whatOf(tracks)} from ${name}`, action: undo } : { text: `Could not remove from ${name}` });
      return ok;
    },
  };
}
