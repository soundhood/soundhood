// The player on screen, over the existing player (usePlayer): the mini player (narrow shells; a tap
// opens Playing), the player bar (tablet and desktop) and the Playing screen (the full player: over
// everything on the phone, two columns in the main area on wider shells). The hairline and the
// position follow the audio element. Repeat and the queue are not here yet (no dead controls).
import { FullPlayer, MiniPlayer, PlayerBar } from "../../design";
import { useApp } from "../../app/context";
import { libraryView, type Detail } from "../../hooks/useNavigation";
import { folderLabel, songCount, trackArtist, trackFormat, trackLength, trackTitle } from "../library/trackInfo";

/** What the player surfaces show for the song that is loaded. */
function useNowPlaying() {
  const { player } = useApp();
  const t = player.currentTrack;
  return {
    title: t ? trackTitle(t) : player.currentName || "Nothing playing",
    artist: t ? trackArtist(t) : "",
    cover: player.coverUrl || null,
  };
}

/** "Playing from playlist / Late Night". */
export function sourceLabel(source: Detail | null): { kind: string; name: string } {
  if (!source) return { kind: "your library", name: "All songs" };
  if (source.kind === "all") return { kind: "your library", name: "All songs" };
  return { kind: source.kind, name: source.kind === "folder" ? folderLabel(source.name) : source.name };
}

export function NowMini() {
  const { player, nav } = useApp();
  const now = useNowPlaying();
  if (!player.currentPath) return null;
  return (
    <MiniPlayer
      title={now.title}
      artist={now.artist}
      cover={now.cover}
      playing={player.isPlaying}
      getProgress={player.getProgress}
      onPlayPause={player.togglePlay}
      onNext={player.playNext}
      onOpen={() => nav.setPlaying(true)}
    />
  );
}

export function NowBar() {
  const { player, nav, lib, actions } = useApp();
  const now = useNowPlaying();
  const t = player.currentTrack;
  // With nothing loaded yet, Play starts the list on screen (every song at first) from the top.
  const playPause = player.currentPath
    ? player.togglePlay
    : () => {
        nav.setSource(libraryView(lib));
        player.playFrom(lib.filteredTracks, player.shuffle);
      };
  return (
    <PlayerBar
      title={now.title}
      artist={now.artist}
      cover={now.cover}
      playing={player.isPlaying}
      shuffle={player.shuffle}
      repeat="off"
      position={player.progress}
      duration={player.duration}
      volume={player.volume * 100}
      muted={player.muted}
      onSeek={(s) => player.seekTo(String(s))}
      onVolume={(v) => {
        player.setVolume(v / 100);
        if (player.muted && v > 0) player.setMuted(false);
      }}
      onMute={() => player.setMuted((m) => !m)}
      onPlayPause={playPause}
      onPrev={player.playPrev}
      onNext={player.playNext}
      onShuffle={() => player.setShuffle((s) => !s)}
      onAddToPlaylist={t ? () => actions.addToPlaylist([t]) : undefined}
      onToggleFull={player.currentPath ? () => nav.setPlaying(!nav.playing) : undefined}
      fullOpen={nav.playing}
    />
  );
}

export function PlayingScreen() {
  const { player, lib, nav, actions } = useApp();
  const now = useNowPlaying();
  const t = player.currentTrack;
  const listed = lib.filteredTracks.length;
  const facts = t
    ? [trackLength(t), trackFormat(t), folderLabel(t.playlist), player.currentIndex >= 0 ? `${player.currentIndex + 1} of ${listed}` : songCount(listed)]
    : [];
  return (
    <FullPlayer
      title={now.title}
      artist={now.artist}
      cover={now.cover}
      source={sourceLabel(nav.source)}
      facts={facts.filter(Boolean)}
      playing={player.isPlaying}
      shuffle={player.shuffle}
      repeat="off"
      position={player.progress}
      duration={player.duration}
      onSeek={(s) => player.seekTo(String(s))}
      onPlayPause={player.togglePlay}
      onPrev={player.playPrev}
      onNext={player.playNext}
      onShuffle={() => player.setShuffle((s) => !s)}
      onClose={() => nav.setPlaying(false)}
      onAddToPlaylist={t ? () => actions.addToPlaylist([t]) : undefined}
    />
  );
}
