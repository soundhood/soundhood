// Starting playback from a screen: the song or the list, and where it plays from (useNavigation's
// source). The list a song is started from becomes the play queue's source (queueModel.ts): the
// songs Next and Previous step through afterwards, in the order the list shows them (its sort, and
// the search field's filter while a list is open).
import { useApp } from "../../app/context";
import { libraryView, type Detail } from "../../hooks/useNavigation";
import { sortTracks, splitArtists } from "../../lib/tracks";
import type { Track } from "../../lib/types";

const same = (a: Detail, b: Detail) => a.kind === b.kind && a.name === b.name;

export function usePlayActions() {
  const { player, nav, lib } = useApp();

  /** The songs of `d` in the order its screen shows them. */
  function listOf(d: Detail): Track[] {
    // The list on screen is the library's view: its songs are already sorted and filtered.
    if (same(libraryView(lib), d)) return lib.filteredTracks;
    const all = lib.allTracks;
    const songs =
      d.kind === "playlist"
        ? lib.tracksOfPlaylist.get(d.name) ?? []
        : d.kind === "artist"
          ? all.filter((t) => splitArtists(t.artist).includes(d.name))
          : d.kind === "folder"
            ? all.filter((t) => (t.playlist || "(root)") === d.name)
            : all;
    return sortTracks(songs, lib.sortMode);
  }

  return {
    /** Plays one song of the list `source`; that list becomes the queue's source. */
    playTrack(t: Track, source: Detail) {
      nav.setSource(source);
      player.playList(listOf(source), t);
    },
    /** Plays `tracks` (the list `source`) from the top, or shuffled from a random song. */
    playList(tracks: readonly Track[], source: Detail, shuffle: boolean) {
      if (tracks.length === 0) return;
      nav.setSource(source);
      player.playList(sortTracks([...tracks], lib.sortMode), null, shuffle);
    },
    /** Plays the chosen songs (Enter on a selection), in list order, from the first. */
    playSelection(tracks: readonly Track[], source: Detail) {
      if (tracks.length === 0) return;
      nav.setSource(source);
      player.playList(tracks, tracks[0]);
    },
  };
}
