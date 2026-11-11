// The Artists tab: every artist named in a tag (collaborations count under each name), with a round
// cover from one of their first songs and their song count; a tap or click opens their songs from
// every folder. A long list (about 1,260 artists in the real library), so only the rows in view exist.
// Songs without an artist tag are together under "No artist", last.
import { useMemo, type RefObject } from "react";
import { ListRow, Thumb, VirtualList, type VirtualRowProps } from "../../design";
import { useApp } from "../../app/context";
import { useMosaics } from "../../hooks/useCovers";
import { UNTAGGED, splitArtists } from "../../lib/tracks";
import { songCount } from "../library/trackInfo";

export function artistsMeta(n: number): string {
  return `${n} ${n === 1 ? "artist" : "artists"}`;
}

/** How an artist's name reads ("(untagged)" is the bucket of songs without one). */
export function artistLabel(name: string): string {
  return name === UNTAGGED ? "No artist" : name;
}

/** Each artist's first few songs in the library (the round cover is the first of them that has one). */
export function useFirstSongsOfArtist(): Map<string, string[]> {
  const { lib } = useApp();
  return useMemo(() => {
    const first = new Map<string, string[]>();
    for (const t of lib.allTracks) {
      for (const a of splitArtists(t.artist)) {
        const paths = first.get(a) ?? [];
        if (paths.length < 4) first.set(a, [...paths, t.path]);
      }
    }
    return first;
  }, [lib.allTracks]);
}

export function ArtistRow({ name, count, paths, row, onOpen }: { name: string; count: number; paths?: string[]; row: VirtualRowProps; onOpen: () => void }) {
  const [covers] = useMosaics([paths ?? []]);
  return (
    <ListRow
      {...row}
      thumb={<Thumb src={covers[0]} round />}
      name={artistLabel(name)}
      meta={songCount(count)}
      chevron
      onClick={onOpen}
    />
  );
}

export function ArtistsBody({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const { lib, nav } = useApp();
  const first = useFirstSongsOfArtist();
  return (
    <VirtualList
      items={lib.artists}
      getKey={(a) => a.name}
      label="Artists"
      scroller={scroller}
      onKeyDown={(e, i) => {
        if (e.key === "Enter" && lib.artists[i]) {
          e.preventDefault();
          nav.openDetail({ kind: "artist", name: lib.artists[i].name });
        }
      }}
      renderRow={(a, _i, row) => (
        <ArtistRow name={a.name} count={a.count} paths={first.get(a.name)} row={row} onOpen={() => nav.openDetail({ kind: "artist", name: a.name })} />
      )}
    />
  );
}
