// What every browse tab reads. The tabs are render functions, not components: the three of them
// share the panel's search row and list elements, which React keeps (scroll position, focused
// field) when the tab changes, exactly as when they were written inline.
import type { Library } from "../../hooks/useLibrary";
import type { Player } from "../../hooks/usePlayer";
import type { Playlists } from "../../hooks/usePlaylists";

export type BrowseTabArgs = {
  isMobile: boolean;
  lib: Library;
  playlists: Playlists;
  player: Player;
  goTracks: () => void;
};
