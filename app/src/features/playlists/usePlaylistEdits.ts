// Adding songs to a playlist and taking them out, from any screen: the existing playlist calls
// (journaled by the core), then a toast that says what happened (playlistWords.ts), counted from the
// write's own report. A change gets Undo for a few seconds, which undoes that change by its own id
// and nothing else; a gesture that changed nothing (the songs were already there, or not there) says
// so, without Undo. A gesture of two writes (Create and add) offers Undo only when the reports of
// both are known: an Undo of one part alone would leave the other.
import { useApp } from "../../app/context";
import type { Change } from "../../coreIpc";
import type { PlaylistWrite } from "../../hooks/usePlaylists";
import type { Track } from "../../lib/types";
import { addedText, removedText } from "./playlistWords";

export function usePlaylistEdits() {
  const { playlists, notices } = useApp();

  /** The toast after a playlist write; `before`: the write the same gesture made first (a new playlist). */
  function said(w: PlaylistWrite, text: string, before?: PlaylistWrite) {
    const parts = before ? [before, w] : [w];
    const changes: Change[] = parts.flatMap((p) => (p.change ? [p.change] : []));
    if (changes.length && parts.every((p) => p.sure)) notices.undoable(text, changes);
    else notices.notify({ text });
  }

  return {
    /** Adds the songs; `before` is the write the same gesture made first (Create and add). */
    async add(name: string, tracks: Track[], before?: PlaylistWrite) {
      const w = await playlists.addToPlaylist(name, tracks);
      if (!w) notices.notify({ text: `Could not add to ${name}` });
      else said(w, addedText(name, tracks, w.change, w.sure), before);
      return !!w;
    },
    async remove(name: string, tracks: Track[]) {
      const w = await playlists.removeFromPlaylist(name, tracks);
      if (!w) notices.notify({ text: `Could not remove from ${name}` });
      else said(w, removedText(name, tracks, w.change, w.sure));
      return !!w;
    },
  };
}
