// What the main area shows (useNavigation's screen): a tab's top screen or Search, an open list of
// songs, or Playing. Playlists, Artists, Folders and Search share one header element, so the search
// field under the title keeps the keyboard when typing turns a tab into Search (the phone).
import { useState, type RefObject } from "react";
import { Badge, Button, IconButton, ScreenHeader, SearchField } from "../design";
import { ArtistsBody, artistsMeta } from "../features/artists/ArtistsScreen";
import { FoldersBody, foldersMeta } from "../features/folders/FoldersScreen";
import { TrackListScreen } from "../features/library/TrackListScreen";
import { PlayingScreen } from "../features/player/PlayerSurfaces";
import { PlaylistsBody, playlistsMeta } from "../features/playlists/PlaylistsScreen";
import { SearchBody, SearchChips, searchMeta, useSearchResults } from "../features/search/SearchScreen";
import type { SearchKind } from "../features/search/searchModel";
import { useApp } from "./context";

const TITLES = { playlists: "Playlists", artists: "Artists", folders: "Folders", search: "Search" } as const;

function SearchMeta() {
  const { nav } = useApp();
  const results = useSearchResults();
  return <>{searchMeta(results.total, nav.query)}</>;
}

function TopScreen({ screen, scroller }: { screen: keyof typeof TITLES; scroller: RefObject<HTMLElement | null> }) {
  const { lib, nav, actions } = useApp();
  const [chip, setChip] = useState<SearchKind>("all");

  const count =
    screen === "playlists"
      ? playlistsMeta(lib.playlistFiles.length)
      : screen === "artists"
        ? artistsMeta(lib.artists.length)
        : screen === "folders"
          ? foldersMeta(lib.folders.filter((f) => f !== "(all)").length)
          : null;

  return (
    <div className="Screen" data-screen={screen}>
      <ScreenHeader
        title={TITLES[screen]}
        meta={
          <>
            {screen === "search" ? <SearchMeta /> : <span className="is-wide-only">{count}</span>}
            {lib.fixtureOn && (
              <Badge outline className="TestBadge">
                Test library
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {screen === "playlists" && lib.folder && (
              <>
                <IconButton icon="plus" label="New playlist" className="is-narrow-only" onClick={() => actions.newPlaylist()} />
                <Button small icon="plus" className="is-wide-only" onClick={() => actions.newPlaylist()}>
                  New playlist
                </Button>
              </>
            )}
            <IconButton icon="settings" label="Settings" className="App-phoneOnly" onClick={actions.openSettings} />
          </>
        }
        search={<SearchField value={nav.query} onChange={nav.setQuery} shortcut />}
        chips={screen === "search" ? <SearchChips chip={chip} onChip={setChip} /> : undefined}
      />
      {screen === "playlists" && <PlaylistsBody />}
      {screen === "artists" && <ArtistsBody scroller={scroller} />}
      {screen === "folders" && <FoldersBody scroller={scroller} />}
      {screen === "search" && <SearchBody chip={chip} onChip={setChip} scroller={scroller} />}
    </div>
  );
}

export function MainArea({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const { nav } = useApp();
  if (nav.screen === "playing") return <PlayingScreen />;
  if (nav.screen === "detail" && nav.detail) return <TrackListScreen key={`${nav.detail.kind}:${nav.detail.name}`} detail={nav.detail} scroller={scroller} />;
  const top = nav.screen === "detail" ? nav.tab : nav.screen;
  return <TopScreen screen={top} scroller={scroller} />;
}
