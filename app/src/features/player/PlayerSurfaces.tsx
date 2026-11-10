// The player on screen, over the player (usePlayer): the mini player (narrow shells; a tap opens
// Playing), the player bar (tablet and desktop) and the Playing screen (the full player: over
// everything on the phone, two columns in the main area on wider shells). Shuffle, Repeat (off, all,
// one) and the queue button (the right pane where it fits, else the queue sheet: QueueUi) are live.
// The full player's "more" is the song rows' menu for the playing song (RowMenu's items).
// The position and the length come from the player's clock (usePlaybackTime), so a tick re-renders
// these surfaces and nothing else; the hairline reads the audio element itself.
import { useEffect, useRef, useState } from "react";
import { FullPlayer, MenuButton, MiniPlayer, PlayerBar } from "../../design";
import { useApp } from "../../app/context";
import { libraryView, type Detail } from "../../hooks/useNavigation";
import type { Track } from "../../lib/types";
import { reducedMotion } from "../../design/lib/dom";
import { useQueueUi } from "../queue/QueueUi";
import { upcomingCount } from "../queue/queueModel";
import { useSongMenuItems } from "../library/RowMenu";
import { folderLabel, songCount, trackArtist, trackFormat, trackLength, trackTitle } from "../library/trackInfo";
import { usePlaybackTime } from "./playbackClock";
import "./player.css";

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

/** Play or pause; with nothing loaded and nothing queued, the list on screen from the top. */
function usePlayPause() {
  const { player, nav, lib } = useApp();
  if (player.currentPath || upcomingCount(player.queue) > 0) return player.togglePlay;
  return () => {
    nav.setSource(libraryView(lib));
    player.playFrom(lib.filteredTracks, player.shuffle);
  };
}

export function NowMini() {
  const { player, nav } = useApp();
  const queue = useQueueUi();
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
      onQueue={queue.toggle}
      onOpen={() => nav.setPlaying(true)}
    />
  );
}

export function NowBar() {
  const { player, nav, actions } = useApp();
  const queue = useQueueUi();
  const time = usePlaybackTime(player.clock);
  const now = useNowPlaying();
  const playPause = usePlayPause();
  const t = player.currentTrack;
  return (
    <PlayerBar
      title={now.title}
      artist={now.artist}
      cover={now.cover}
      playing={player.isPlaying}
      shuffle={player.shuffle}
      repeat={player.repeat}
      position={time.position}
      duration={time.duration}
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
      onRepeat={player.cycleRepeat}
      onQueue={queue.toggle}
      queueOpen={queue.shown}
      onAddToPlaylist={t ? () => actions.addToPlaylist([t]) : undefined}
      onToggleFull={player.currentPath ? () => nav.setPlaying(!nav.playing) : undefined}
      fullOpen={nav.playing}
    />
  );
}

/** The full player's "more": Add to playlist, Go to artist, Edit tags and Delete for the playing song. */
function PlayerMore({ track }: { track: Track }) {
  const items = useSongMenuItems(track, true);
  return <MenuButton label={`More for ${trackTitle(track)}`} items={items} />;
}

/** Mirrors shell.css: the full player is a screen of its own (and slides away) under 720 px. */
const PHONE = "(max-width: 719px)";

export function PlayingScreen() {
  const { player, nav, actions } = useApp();
  const queue = useQueueUi();
  const time = usePlaybackTime(player.clock);
  const now = useNowPlaying();
  const t = player.currentTrack;
  const q = player.queue;
  const total = q.past.length + (q.now ? 1 : 0) + upcomingCount(q);
  const facts = t ? [trackLength(t), trackFormat(t), folderLabel(t.playlist), q.now ? `${q.past.length + 1} of ${total}` : songCount(total)] : [];

  // On the phone the full player slides back down before it goes (swipe down, Esc, Close).
  const [leaving, setLeaving] = useState(false);
  const done = useRef(0);
  useEffect(() => () => clearTimeout(done.current), []);
  const close = () => {
    if (leaving) return;
    if (reducedMotion() || typeof matchMedia !== "function" || !matchMedia(PHONE).matches) {
      nav.setPlaying(false);
      return;
    }
    setLeaving(true);
    done.current = window.setTimeout(() => nav.setPlaying(false), 400);
  };

  return (
    <FullPlayer
      className={leaving ? "is-leaving" : undefined}
      title={now.title}
      artist={now.artist}
      cover={now.cover}
      source={sourceLabel(nav.source)}
      facts={facts.filter(Boolean)}
      playing={player.isPlaying}
      shuffle={player.shuffle}
      repeat={player.repeat}
      position={time.position}
      duration={time.duration}
      onSeek={(s) => player.seekTo(String(s))}
      onPlayPause={player.togglePlay}
      onPrev={player.playPrev}
      onNext={player.playNext}
      onShuffle={() => player.setShuffle((s) => !s)}
      onRepeat={player.cycleRepeat}
      onQueue={queue.toggle}
      onClose={close}
      onAddToPlaylist={t ? () => actions.addToPlaylist([t]) : undefined}
      more={t ? <PlayerMore track={t} /> : undefined}
    />
  );
}
