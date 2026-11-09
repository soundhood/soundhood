// Where the user is: one of the three library tabs (Playlists, Artists, Folders), optionally a list
// of songs opened from it (a playlist, an artist, a folder, or every song), the Playing screen on top
// of either, and the search field's text. The same state drives every shell size: the phone shows it
// with bottom tabs and Back, the desktop with the sidebar.
//
// The open list is the library's view (useLibrary: plView, artistView, playlist), so the songs shown
// are the songs the player steps through, as before the rebuild. Opening a list sets that view;
// going back keeps it (the music keeps playing from it). When the library stops showing the open list
// (its playlist was deleted, another library was loaded) the list closes.
//
// Playing from: the list a song was started from (a playlist, an artist, a folder or every song),
// kept until another song is started; it names the source on the Playing screen and marks the
// playing playlist.
//
// Search: with no list open, text in the field shows the Search screen. With a list open, the same
// field filters that list (the library's query). Opening a result remembers the search, and Back
// returns to it.
import { useEffect, useState } from "react";
import type { Library } from "./useLibrary";

export type TopTab = "playlists" | "artists" | "folders";
export type DetailKind = "playlist" | "artist" | "folder" | "all";
export type Detail = { kind: DetailKind; name: string };
/** What the main area shows. */
export type Screen = TopTab | "detail" | "search" | "playing";

export type Navigation = ReturnType<typeof useNavigation>;

const TAB_OF: Record<DetailKind, TopTab> = { playlist: "playlists", artist: "artists", folder: "folders", all: "folders" };

/** True while the library's view is `d`. */
function libraryShows(d: Detail, lib: Pick<Library, "plView" | "artistView" | "playlist">): boolean {
  switch (d.kind) {
    case "playlist":
      return lib.plView === d.name;
    case "artist":
      return !lib.plView && lib.artistView === d.name;
    case "folder":
      return !lib.plView && !lib.artistView && lib.playlist === d.name;
    case "all":
      return !lib.plView && !lib.artistView && lib.playlist === "(all)";
  }
}

type NavigationArgs = {
  lib: Library;
  /** Something is loaded in the player (the Playing tab works). */
  hasTrack: boolean;
  /** Called whenever the list on screen changes: the selection and Select mode end. */
  onListChange: () => void;
};

export function useNavigation({ lib, hasTrack, onListChange }: NavigationArgs) {
  const [tab, setTab] = useState<TopTab>("playlists");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [playing, setPlaying] = useState(false);
  const [query, setQueryText] = useState("");
  // The search the open list was reached from (its text and the tab under it), restored by Back.
  const [returnTo, setReturnTo] = useState<{ query: string; tab: TopTab } | null>(null);
  const [source, setSource] = useState<Detail | null>(null);

  /** Points the library's view at `d` (what the list shows and what the player steps through). */
  function showInLibrary(d: Detail) {
    if (d.kind === "playlist") {
      lib.openPlaylistView(d.name);
      return;
    }
    lib.setPlView("");
    lib.setArtistView(d.kind === "artist" ? d.name : "");
    lib.setPlaylist(d.kind === "folder" ? d.name : "(all)");
  }

  function openDetail(d: Detail) {
    showInLibrary(d);
    lib.setQuery("");
    if (!detail) setReturnTo(query.trim() ? { query, tab } : null);
    setQueryText("");
    setDetail(d);
    setTab(TAB_OF[d.kind]);
    setPlaying(false);
    onListChange();
  }

  function back() {
    lib.setQuery("");
    setQueryText(returnTo?.query ?? "");
    if (returnTo) setTab(returnTo.tab);
    setReturnTo(null);
    setDetail(null);
    onListChange();
  }

  /**
   * A tab or nav item. From the Playing screen, the current tab returns to where the user was;
   * otherwise a tab opens its top screen (tapping the current one again leaves an open list).
   */
  function goTo(id: TopTab | "playing") {
    if (id === "playing") {
      if (hasTrack) setPlaying(true);
      return;
    }
    if (playing && id === tab) {
      setPlaying(false);
      return;
    }
    if (detail || query) lib.setQuery("");
    setTab(id);
    setDetail(null);
    setReturnTo(null);
    setQueryText("");
    setPlaying(false);
    onListChange();
  }

  function setQuery(q: string) {
    setQueryText(q);
    if (detail) lib.setQuery(q);
    setPlaying(false);
  }

  // The open list went away under us (playlist deleted, library switched): back to its tab.
  const shown = detail ? libraryShows(detail, lib) : true;
  useEffect(() => {
    if (shown) return;
    setDetail(null);
    setReturnTo(null);
    setQueryText("");
    lib.setQuery("");
    onListChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Nothing to show on the Playing screen once the player is emptied.
  useEffect(() => {
    if (!hasTrack) {
      setPlaying(false);
      setSource(null);
    }
  }, [hasTrack]);

  const screen: Screen = playing ? "playing" : detail ? "detail" : query.trim() ? "search" : tab;

  return {
    tab,
    detail: shown ? detail : null,
    playing,
    setPlaying,
    query,
    setQuery,
    source,
    setSource,
    screen,
    openDetail,
    showInLibrary,
    back,
    goTo,
  };
}
