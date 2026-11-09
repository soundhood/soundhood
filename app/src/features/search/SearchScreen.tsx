// The Search screen (the search field has text and no list is open). Results come in groups, Artists,
// Songs, Playlists, Folders, each with its first few and "Show all"; the chips narrow them to one
// group, shown in full. A song plays in the order of the whole library; the rest open their list.
import { useMemo, type ReactNode, type RefObject } from "react";
import { Chip, ChipRow, EmptyState, ListRow, Mosaic, SectionHeader, Thumb, VirtualList, type VirtualRowProps } from "../../design";
import { useApp } from "../../app/context";
import { useMosaics } from "../../hooks/useCovers";
import type { Detail } from "../../hooks/useNavigation";
import { ArtistRow, useFirstSongsOfArtist } from "../artists/ArtistsScreen";
import { folderDetail, useFolderCounts } from "../folders/FoldersScreen";
import { TrackList } from "../library/TrackList";
import { folderLabel, songCount, songsMeta } from "../library/trackInfo";
import { usePlayActions } from "../player/usePlayActions";
import { searchLibrary, type SearchKind, type SearchResults } from "./searchModel";

const CHIPS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "artists", label: "Artists" },
  { id: "playlists", label: "Playlists" },
  { id: "folders", label: "Folders" },
];

/** How many of each group "All" shows before "Show all". */
const FIRST = { songs: 5, artists: 3, playlists: 3, folders: 3 };

export function useSearchResults(): SearchResults {
  const { lib, nav } = useApp();
  return useMemo(
    () => searchLibrary(nav.query, { tracks: lib.allTracks, artists: lib.artists, playlistFiles: lib.playlistFiles, folders: lib.folders }),
    [nav.query, lib.allTracks, lib.artists, lib.playlistFiles, lib.folders],
  );
}

export function searchMeta(total: number, query: string): string {
  return `${total} ${total === 1 ? "result" : "results"} for ${query.trim()}`;
}

export function SearchChips({ chip, onChip }: { chip: SearchKind; onChip: (c: SearchKind) => void }) {
  return (
    <ChipRow label="Show">
      {CHIPS.map((c) => (
        <Chip key={c.id} pressed={c.id === chip} onClick={() => onChip(c.id)}>
          {c.label}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** Rows that open a list, in a listbox with the arrow keys (Enter opens). */
function OpenList<T>({ items, label, getKey, scroller, onOpen, render }: {
  items: readonly T[];
  label: string;
  getKey: (item: T) => string;
  scroller: RefObject<HTMLElement | null>;
  onOpen: (item: T) => void;
  render: (item: T, row: VirtualRowProps) => ReactNode;
}) {
  return (
    <VirtualList
      items={items}
      getKey={getKey}
      label={label}
      scroller={scroller}
      onKeyDown={(e, i) => {
        if (e.key === "Enter" && items[i]) {
          e.preventDefault();
          onOpen(items[i]);
        }
      }}
      renderRow={(item, _i, row) => render(item, row)}
    />
  );
}

export function SearchBody({ chip, onChip, scroller }: { chip: SearchKind; onChip: (c: SearchKind) => void; scroller: RefObject<HTMLElement | null> }) {
  const { lib, nav } = useApp();
  const play = usePlayActions();
  const results = useSearchResults();
  const first = useFirstSongsOfArtist();
  const counts = useFolderCounts();
  const plTracks = results.playlists.map((p) => lib.tracksOfPlaylist.get(p.name) ?? []);
  const covers = useMosaics(plTracks.map((ts) => ts.map((t) => t.path)));

  const inChip = chip === "all" ? results.total : results[chip].length;
  if (inChip === 0) {
    const what = chip === "all" ? "Nothing in your library" : `No ${chip.slice(0, -1)}`;
    return <EmptyState icon="search" title="No results" text={`${what} matches "${nav.query.trim()}".`} />;
  }

  const all: Detail = { kind: "all", name: "(all)" };
  const show = (kind: Exclude<SearchKind, "all">) => chip === "all" || chip === kind;
  const cut = <T,>(list: readonly T[], kind: keyof typeof FIRST) => (chip === "all" ? list.slice(0, FIRST[kind]) : list);
  const header = (title: string, n: number, kind: Exclude<SearchKind, "all">) =>
    chip === "all" ? (
      <SectionHeader title={title} action={n > FIRST[kind as keyof typeof FIRST] ? { label: `Show all ${n}`, onClick: () => onChip(kind) } : undefined} />
    ) : null;

  const playlistIndex = new Map(results.playlists.map((p, i) => [p.name, i] as const));

  return (
    <div className="SearchResults">
      {show("artists") && results.artists.length > 0 && (
        <section aria-label="Artists">
          {header("Artists", results.artists.length, "artists")}
          <OpenList
            items={cut(results.artists, "artists")}
            label="Artists found"
            getKey={(a) => a.name}
            scroller={scroller}
            onOpen={(a) => nav.openDetail({ kind: "artist", name: a.name })}
            render={(a, row) => (
              <ArtistRow name={a.name} count={a.count} paths={first.get(a.name)} row={row} onOpen={() => nav.openDetail({ kind: "artist", name: a.name })} />
            )}
          />
        </section>
      )}
      {show("songs") && results.songs.length > 0 && (
        <section aria-label="Songs">
          {header("Songs", results.songs.length, "songs")}
          <TrackList
            tracks={cut(results.songs, "songs")}
            label="Songs found"
            scroller={scroller}
            onPlay={(t) => {
              // A song from the search plays in the order of the whole library.
              nav.showInLibrary(all);
              play.playTrack(t, all);
            }}
          />
        </section>
      )}
      {show("playlists") && results.playlists.length > 0 && (
        <section aria-label="Playlists">
          {header("Playlists", results.playlists.length, "playlists")}
          <OpenList
            items={cut(results.playlists, "playlists")}
            label="Playlists found"
            getKey={(p) => p.name}
            scroller={scroller}
            onOpen={(p) => nav.openDetail({ kind: "playlist", name: p.name })}
            render={(p, row) => {
              const i = playlistIndex.get(p.name) ?? 0;
              return (
                <ListRow
                  {...row}
                  thumb={<Mosaic covers={covers[i] ?? []} small />}
                  name={p.name}
                  meta={`Playlist, ${songsMeta(plTracks[i] ?? [])}`}
                  chevron
                  onClick={() => nav.openDetail({ kind: "playlist", name: p.name })}
                />
              );
            }}
          />
        </section>
      )}
      {show("folders") && results.folders.length > 0 && (
        <section aria-label="Folders">
          {header("Folders", results.folders.length, "folders")}
          <OpenList
            items={cut(results.folders, "folders")}
            label="Folders found"
            getKey={(f) => f}
            scroller={scroller}
            onOpen={(f) => nav.openDetail(folderDetail(f))}
            render={(f, row) => (
              <ListRow
                {...row}
                thumb={<Thumb folder />}
                name={folderLabel(f)}
                meta={`Folder, ${songCount(counts.get(f) ?? 0)}`}
                chevron
                onClick={() => nav.openDetail(folderDetail(f))}
              />
            )}
          />
        </section>
      )}
    </div>
  );
}
