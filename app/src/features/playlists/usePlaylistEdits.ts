// Adding songs to a playlist and taking them out, from any screen: the existing playlist calls
// (journaled by the core), then a toast that says what happened. A change gets Undo for a few
// seconds, which undoes that change by its own id and nothing else; a gesture that changed nothing
// (the songs were already there, or not there) says so, without Undo.
import { useApp } from "../../app/context";
import type { Change } from "../../coreIpc";
import type { PlaylistWrite } from "../../hooks/usePlaylists";
import type { Track } from "../../lib/types";
import { songCount, trackTitle } from "../library/trackInfo";

/** "Glass Tide" for one song, "3 songs" for more. */
function whatOf(tracks: readonly Track[]): string {
  return tracks.length === 1 ? trackTitle(tracks[0]) : songCount(tracks.length);
}

export function usePlaylistEdits() {
  const { playlists, notices } = useApp();

  /** The toast after a playlist write; `earlier`: changes the same gesture made first (a new playlist). */
  function said(w: PlaylistWrite, done: string, nothing: string, earlier: readonly Change[] = []) {
    const changes = [...earlier, ...(w.change ? [w.change] : [])];
    const text = w.change || !w.sure ? done : nothing;
    if (changes.length) notices.undoable(text, changes);
    else notices.notify({ text });
  }

  return {
    /** Adds the songs; `earlier` are changes the same gesture made before (Create and add). */
    async add(name: string, tracks: Track[], earlier: readonly Change[] = []) {
      const w = await playlists.addToPlaylist(name, tracks);
      if (!w) notices.notify({ text: `Could not add to ${name}` });
      else said(w, `Added ${whatOf(tracks)} to ${name}`, `Already in ${name}`, earlier);
      return !!w;
    },
    async remove(name: string, tracks: Track[]) {
      const w = await playlists.removeFromPlaylist(name, tracks);
      if (!w) notices.notify({ text: `Could not remove from ${name}` });
      else said(w, `Removed ${whatOf(tracks)} from ${name}`, `Not in ${name}`);
      return !!w;
    },
  };
}
