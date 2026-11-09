// Starting playback from a screen: the song or the list, and where it plays from (useNavigation's
// source). The player steps through the library's current view (useLibrary), so a list that is not
// open is first made the view (nav.showInLibrary) by the caller.
import { useApp } from "../../app/context";
import type { Detail } from "../../hooks/useNavigation";
import type { Track } from "../../lib/types";

export function usePlayActions() {
  const { player, nav } = useApp();
  return {
    /** Plays one song of the list `source`. */
    playTrack(t: Track, source: Detail) {
      nav.setSource(source);
      player.loadAndPlay(t);
    },
    /** Plays `tracks` (the list `source`) from the top, or shuffled from a random song. */
    playList(tracks: Track[], source: Detail, shuffle: boolean) {
      if (tracks.length === 0) return;
      nav.setSource(source);
      player.playFrom(tracks, shuffle);
    },
  };
}
