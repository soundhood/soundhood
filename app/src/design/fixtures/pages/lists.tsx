// Fixture pages: lists. Rows sit in role="listbox" parents as they do in the app.
import { useEffect, useRef, useState } from "react";
import { Equaliser } from "../../components/Equaliser";
import { ListRow } from "../../components/ListRow";
import { MenuButton } from "../../components/Menu";
import { CardGrid, PlaylistCard } from "../../components/PlaylistCard";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState, ErrorRow, Skeleton } from "../../components/States";
import { Mosaic, Thumb } from "../../components/Thumb";
import { TrackRow } from "../../components/TrackRow";
import { VirtualList, type VirtualListHandle } from "../../components/VirtualList";
import { COVERS, NOW, PLAYLISTS, TRACKS, library, meta, noop, row } from "../data";
import { Box, Cols, Demo, Page, Row } from "../frame";

function ThumbPage() {
  return (
    <Page title="Thumb" note="40 px artwork: --r-xs, round for artists, a folder icon for folders, --bg-2 until it loads.">
      <Demo label="Cover, artist, folder, no artwork, not loaded yet">
        <Row>
          <Thumb src={TRACKS[2].cover} />
          <Thumb src={TRACKS[0].cover} round />
          <Thumb folder />
          <Thumb />
          <Thumb round />
          <span className="Thumb" aria-hidden="true" />
        </Row>
      </Demo>
    </Page>
  );
}

function MosaicPage() {
  const four = PLAYLISTS[0].covers;
  return (
    <Page title="Mosaic" note="Four different covers, 2 x 2 with no gap; one cover under four; a playlist icon with none.">
      <Demo label="Four, one, none (small)">
        <Row>
          <Mosaic covers={four} small />
          <Mosaic covers={[COVERS.purpleSun, COVERS.purpleSun]} small />
          <Mosaic covers={[]} small />
        </Row>
      </Demo>
      <Demo label="Four, one, none (card size)">
        <div className="CardGrid">
          <Mosaic covers={four} />
          <Mosaic covers={[COVERS.aquaRings]} />
          <Mosaic covers={[]} />
        </div>
      </Demo>
    </Page>
  );
}

function EqualiserPage() {
  return (
    <Page title="Equaliser" note="Three 3 px aqua bars, 14 px tall: bouncing while it plays, still while paused or with reduced motion.">
      <Demo label="Playing, paused">
        <Row>
          <Equaliser />
          <Equaliser paused />
        </Row>
      </Demo>
    </Page>
  );
}

function TrackRowPage() {
  const [t0, t1, , , t4, t5, t6, t7, t8, t9] = TRACKS;
  return (
    <Page
      title="TrackRow"
      note="--row-h tall. The folder shows on a desktop shell; the more button shows on touch and on hover with a mouse."
    >
      <Demo label="Normal, playing, playing paused, missing file">
        <div role="listbox" aria-label="Songs">
          <TrackRow {...row(t1)} onMore={noop} />
          <TrackRow {...row(NOW)} playing onMore={noop} />
          <TrackRow {...row(t0)} playing paused onMore={noop} />
          <TrackRow {...row(t9)} missing onMore={noop} />
        </div>
      </Demo>
      <Demo label="Select mode: chosen, not chosen">
        <div role="listbox" aria-label="Songs" aria-multiselectable="true">
          <TrackRow {...row(t5)} check selected onMore={noop} />
          <TrackRow {...row(t8)} check onMore={noop} />
          <TrackRow {...row(t6)} check selected onMore={noop} />
        </div>
      </Demo>
      <Demo label="Edit mode: drag handles">
        <div role="listbox" aria-label="Songs">
          <TrackRow {...row(t4)} handle />
          <TrackRow {...row(t7)} handle />
        </div>
      </Demo>
      <Demo label="A long title">
        <div role="listbox" aria-label="Songs">
          <TrackRow
            {...row(t7)}
            title="Sleepless Atlas (Extended Night Version, Remastered for the Long Drive Home)"
            artist="Velvet Static, Copper Kites and the Saltwater Radio Orchestra"
            onMore={noop}
          />
        </div>
      </Demo>
    </Page>
  );
}

function ListRowPage() {
  return (
    <Page title="ListRow" note="Artists, folders, playlists and search results: a thumb, the name over a meta line, a count or a chevron.">
      <div role="listbox" aria-label="Library">
        <ListRow thumb={<Thumb src={TRACKS[0].cover} round />} name="Neon Harbor" meta="Artist, 14 songs" chevron />
        <ListRow thumb={<Thumb round />} name="The Quiet Engines" meta="Artist, 3 songs" chevron />
        <ListRow thumb={<Thumb folder />} name="Downloads" meta="Folder" count={23} />
        <ListRow thumb={<Thumb folder />} name="Vinyl" meta="Folder" count={9} />
        <ListRow thumb={<Mosaic covers={PLAYLISTS[5].covers} small />} name="Neon Nights" meta="Playlist, 6 songs" chevron />
        <ListRow thumb={<Mosaic covers={PLAYLISTS[0].covers} small />} name="Late Night Drive" meta="Playlist, 12 songs" chevron />
      </div>
    </Page>
  );
}

const cardMenu = (name: string) => (
  <MenuButton
    label={`More for ${name}`}
    size={20}
    items={[
      { id: "play", label: "Play", icon: "play", onSelect: noop },
      { id: "shuffle", label: "Shuffle", icon: "shuffle", onSelect: noop },
      { id: "rename", label: "Rename", icon: "edit", onSelect: noop },
      { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: noop },
    ]}
  />
);

function PlaylistCardPage() {
  return (
    <Page title="PlaylistCard" note="A mosaic, the name and the count. Columns at least 150 px wide; the playing one is aqua.">
      <CardGrid label="Playlists">
        {PLAYLISTS.map((p) => (
          <PlaylistCard key={p.id} name={p.name} meta={meta(p)} covers={p.covers} playing={p.playing} more={cardMenu(p.name)} />
        ))}
        <PlaylistCard name="New playlist" meta="0 songs" covers={[]} more={cardMenu("New playlist")} />
      </CardGrid>
    </Page>
  );
}

function SectionHeaderPage() {
  return (
    <Page title="SectionHeader" note="An h3-sized heading with an optional text action.">
      <div>
        <SectionHeader title="Artists" />
        <SectionHeader title="Songs" action={{ label: "Show all 5", onClick: noop }} />
      </div>
    </Page>
  );
}

const LIBRARY = library(2400);

function VirtualListPage() {
  const ref = useRef<VirtualListHandle>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    ref.current?.scrollToIndex(1200, "start");
  }, []);
  return (
    <Page title="VirtualList" note="2,400 songs; only the rows in view (and a few around them) are rendered. Scrolled to song 1,201.">
      <Demo label={`Song 1,201 at the top; the keyboard on song ${(active + 1).toLocaleString("en-US")}`}>
        <Box>
          <VirtualList
            ref={ref}
            items={LIBRARY}
            label="All songs"
            getKey={(s) => s.key}
            onActiveChange={setActive}
            renderRow={(s, i, props) => <TrackRow {...props} {...row(s)} playing={i === 1201} onMore={noop} />}
          />
        </Box>
      </Demo>
    </Page>
  );
}

function SkeletonPage() {
  return (
    <Page title="Skeleton" note="Placeholder rows while the index builds; a slow pulse, still with reduced motion.">
      <Skeleton rows={6} label="Loading your library" />
    </Page>
  );
}

function ErrorRowPage() {
  return (
    <Page title="ErrorRow" note="A faint danger wash, a danger bar, what failed and what to do; Copy log and Retry.">
      <div>
        <ErrorRow
          title="Download stopped"
          detail="YouTube asked to confirm you are not a bot. Turn the VPN off and try again."
          onCopyLog={noop}
          onRetry={noop}
        />
      </div>
      <div>
        <ErrorRow title="Cannot read Vinyl" detail="The folder moved or the drive is not connected." onCopyLog={noop} onRetry={noop} />
      </div>
    </Page>
  );
}

function EmptyStatePage() {
  return (
    <Page title="EmptyState" note="A 48 px line icon, a heading, one line and at most one aqua text action.">
      <Cols>
        <EmptyState
          icon="playlists"
          title="This playlist is empty"
          text="Pick songs in any list with Select, then Add to playlist."
          action={{ label: "Browse songs", onClick: noop }}
        />
        <EmptyState icon="search" title="No results for neon lights" text="Check the spelling, or search for an artist." />
      </Cols>
    </Page>
  );
}

export const LIST_PAGES = {
  Thumb: ThumbPage,
  Mosaic: MosaicPage,
  Equaliser: EqualiserPage,
  TrackRow: TrackRowPage,
  ListRow: ListRowPage,
  PlaylistCard: PlaylistCardPage,
  SectionHeader: SectionHeaderPage,
  VirtualList: VirtualListPage,
  Skeleton: SkeletonPage,
  ErrorRow: ErrorRowPage,
  EmptyState: EmptyStatePage,
};
