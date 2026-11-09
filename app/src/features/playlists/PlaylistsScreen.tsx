// The Playlists tab: a card per playlist file (a mosaic of its first four different covers, the
// name, the count and length; the playing one in aqua), each with Play, Shuffle and Delete in its
// menu. With no playlist files yet, the one action that helps: make one per folder.
import { CardGrid, EmptyState, MenuButton, PlaylistCard } from "../../design";
import { useApp } from "../../app/context";
import { useMosaics } from "../../hooks/useCovers";
import { usePlayActions } from "../player/usePlayActions";
import { playlistTracks, songsMeta } from "../library/trackInfo";

export function playlistsMeta(n: number): string {
  return `${n} ${n === 1 ? "playlist" : "playlists"}`;
}

export function PlaylistsBody() {
  const { lib, nav, player, playlists, dialogs, actions } = useApp();
  const play = usePlayActions();
  const lists = lib.playlistFiles.map((p) => ({ file: p, tracks: playlistTracks(p, lib.tracksByKey) }));
  const covers = useMosaics(lists.map((l) => l.tracks.map((t) => t.path)));

  if (!lib.folder) {
    return (
      <EmptyState
        icon="folders"
        title="No library yet"
        text="Choose the folder that holds your music in Settings."
        action={{ label: "Open Settings", onClick: actions.openSettings }}
      />
    );
  }
  if (lib.playlistFiles.length === 0) {
    return (
      <EmptyState
        icon="playlists"
        title="No playlists yet"
        text="Start from what you have: one playlist per folder. Nothing moves on disk."
        action={{ label: "Make playlists from folders", onClick: () => void playlists.createPlaylistsFromFolders() }}
      />
    );
  }

  return (
    <CardGrid label="Playlists">
      {lists.map(({ file, tracks }, i) => {
        const source = { kind: "playlist" as const, name: file.name };
        const isPlaying = !!player.currentPath && nav.source?.kind === "playlist" && nav.source.name === file.name;
        const playIt = (shuffle: boolean) => {
          nav.showInLibrary(source);
          play.playList(tracks, source, shuffle);
        };
        return (
          <PlaylistCard
            key={file.name}
            name={file.name}
            meta={songsMeta(tracks)}
            covers={covers[i]}
            playing={isPlaying}
            paused={isPlaying && !player.isPlaying}
            onOpen={() => nav.openDetail(source)}
            more={
              <MenuButton
                label={`More for ${file.name}`}
                size={20}
                items={[
                  { id: "play", label: "Play", icon: "play", disabled: !tracks.length, onSelect: () => playIt(false) },
                  { id: "shuffle", label: "Shuffle", icon: "shuffle", disabled: !tracks.length, onSelect: () => playIt(true) },
                  { id: "delete", label: "Delete playlist", icon: "trash", danger: true, onSelect: () => dialogs.setConfirmDeletePlaylist(file.name) },
                ]}
              />
            }
          />
        );
      })}
    </CardGrid>
  );
}
