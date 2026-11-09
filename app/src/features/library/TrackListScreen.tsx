// A list of songs opened from a tab: a playlist, an artist, a folder, or every song. The header
// (Back on narrower shells, the title, the count and length), Play and Shuffle, the sort order, Select;
// then the songs. While songs are selected the selection bar replaces the header on narrower shells
// and sits above the list on the desktop. The search field (here on the phone, in the sidebar on the
// desktop) filters this list while it is open.
import type { RefObject } from "react";
import {
  Badge,
  Button,
  Dropdown,
  EmptyState,
  IconButton,
  MenuButton,
  ScreenHeader,
  SearchField,
  SelectModeBar,
  cx,
  type SelectAction,
} from "../../design";
import { useApp } from "../../app/context";
import type { Detail } from "../../hooks/useNavigation";
import type { SortMode } from "../../lib/tracks";
import { artistLabel } from "../artists/ArtistsScreen";
import { usePlayActions } from "../player/usePlayActions";
import { usePlaylistEdits } from "../playlists/usePlaylistEdits";
import { TrackList } from "./TrackList";
import { SORT_OPTIONS, folderLabel, songCount, songsMeta } from "./trackInfo";

export function detailTitle(d: Detail): string {
  if (d.kind === "artist") return artistLabel(d.name);
  return d.kind === "folder" || d.kind === "all" ? folderLabel(d.kind === "all" ? "(all)" : d.name) : d.name;
}

function SelectionBar({ detail }: { detail: Detail }) {
  const { lib, sel, phone, dialogs, edits, actions } = useApp();
  const playlistEdits = usePlaylistEdits();
  const chosen = sel.selectedTracks;
  const pl = detail.kind === "playlist" ? lib.currentPlaylistFile : null;
  const exit = () => {
    sel.setSelectedPaths(new Set());
    phone.setMSelectMode(false);
  };

  const main: SelectAction[] = [
    { id: "add", label: "Add to playlist", icon: "playlistAdd", onClick: () => actions.addToPlaylist(chosen) },
  ];
  if (pl && chosen.some((t) => lib.inPlaylist(pl, t))) {
    main.push({ id: "remove", label: `Remove from ${pl.name}`, icon: "close", onClick: () => void playlistEdits.remove(pl.name, chosen) });
  }
  main.push({ id: "tags", label: "Edit tags", icon: "edit", disabled: chosen.length !== 1, onClick: () => chosen[0] && edits.openTagEditor(chosen[0]) });

  const more: SelectAction[] = [];
  // Moving files belongs to the storage view, as before: a folder or every song.
  if (detail.kind === "folder" || detail.kind === "all") {
    more.push({ id: "move", label: "Move to folder", icon: "folders", onClick: () => actions.moveToFolder(chosen) });
  }
  more.push({
    id: "delete",
    label: chosen.length === 1 ? "Delete song" : `Delete ${songCount(chosen.length)}`,
    icon: "trash",
    danger: true,
    onClick: () => dialogs.setConfirmDelete(chosen),
  });

  return (
    <SelectModeBar
      count={chosen.length}
      total={lib.filteredTracks.length}
      onSelectAll={() => sel.setSelectedPaths(new Set(lib.filteredTracks.map((t) => t.path)))}
      onSelectNone={() => sel.setSelectedPaths(new Set())}
      onExit={exit}
      actions={main}
      more={more}
    />
  );
}

export function TrackListScreen({ detail, scroller }: { detail: Detail; scroller: RefObject<HTMLElement | null> }) {
  const { lib, nav, sel, phone, dialogs, actions } = useApp();
  const play = usePlayActions();
  const tracks = lib.filteredTracks;
  const title = detailTitle(detail);
  const filtering = !!nav.query.trim();
  const selecting = phone.mSelectMode || sel.selectedPaths.size > 0;

  const meta = filtering ? `${tracks.length} found` : songsMeta(tracks);
  const empty =
    tracks.length > 0 ? null : filtering ? (
      <EmptyState icon="search" title="Nothing matches" text={`No song in ${title} matches "${nav.query.trim()}".`} />
    ) : detail.kind === "playlist" ? (
      <EmptyState icon="playlists" title="This playlist is empty" text="Pick songs in any list with Select, then Add to playlist." />
    ) : (
      <EmptyState icon="music" title="No songs here" text="Rescan the library in Settings if songs are missing." />
    );

  return (
    <div className={cx("Screen", "TrackScreen", selecting && "is-selecting")}>
      <div className="Screen-head">
        <div className="Screen-back is-narrow-only">
          <IconButton icon="back" label="Back" strong onClick={nav.back} />
        </div>
        <ScreenHeader
          title={title}
          meta={
            <>
              {meta}
              {lib.fixtureOn && <Badge outline className="TestBadge">Test library</Badge>}
            </>
          }
          actions={
            <>
              {detail.kind === "playlist" && (
                <MenuButton
                  label={`More for ${title}`}
                  items={[{ id: "delete", label: "Delete playlist", icon: "trash", danger: true, onSelect: () => dialogs.setConfirmDeletePlaylist(detail.name) }]}
                />
              )}
              <IconButton icon="settings" label="Settings" className="App-phoneOnly" onClick={actions.openSettings} />
            </>
          }
          search={<SearchField value={nav.query} onChange={nav.setQuery} placeholder={`Search in ${title}`} />}
        />
        <div className="Screen-tools">
          <Button icon="play" disabled={!tracks.length} onClick={() => play.playList(tracks, detail, false)}>
            Play
          </Button>
          <Button icon="shuffle" disabled={!tracks.length} onClick={() => play.playList(tracks, detail, true)}>
            Shuffle
          </Button>
          <span className="Screen-spacer" />
          <Dropdown<SortMode> label="Sort" options={SORT_OPTIONS} value={lib.sortMode} onChange={(m) => void lib.chooseSort(m)} />
          <Button
            variant="text"
            icon="select"
            disabled={!tracks.length}
            onClick={() => {
              sel.setSelectedPaths(new Set());
              phone.setMSelectMode(true);
            }}
          >
            Select
          </Button>
        </div>
      </div>
      {selecting && <SelectionBar detail={detail} />}
      {empty ?? (
        <TrackList
          tracks={tracks}
          label={`Songs in ${title}`}
          scroller={scroller}
          selectable
          onPlay={(t) => play.playTrack(t, detail)}
        />
      )}
    </div>
  );
}
