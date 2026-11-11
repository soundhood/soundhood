// PlayerBar (tablet and desktop): 80 px (72 on a tablet) on --bg-1, three zones. Now playing: the
// 56 px cover with the tint glow, title over artist, add to playlist. The transport over the
// position slider with times. Tools: lyrics, queue, the volume icon and a 96 px volume slider, open
// the full player. On a tablet shell the times and the volume hide (player.css).
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { formatTime } from "../lib/time";
import { IconButton } from "./IconButton";
import { Slider, SliderRow } from "./Slider";
import { Thumb } from "./Thumb";
import { Transport, type RepeatMode } from "./Transport";

export interface PlayerBarProps {
  title: string;
  artist: string;
  cover?: string | null;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Seconds. */
  position: number;
  duration: number;
  /** 0 to 100. */
  volume: number;
  muted?: boolean;
  onSeek?: (seconds: number) => void;
  onSeekCommit?: (seconds: number) => void;
  onVolume?: (volume: number) => void;
  onVolumeCommit?: (volume: number) => void;
  onMute?: () => void;
  onPlayPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onShuffle?: () => void;
  onRepeat?: () => void;
  onAddToPlaylist?: () => void;
  /** Leave out until lyrics exist (Phase 5). */
  onLyrics?: () => void;
  onQueue?: () => void;
  /** The queue pane is open: the queue button is on. */
  queueOpen?: boolean;
  /** Leave out while there is nothing to open (no song loaded): the button is not shown without it. */
  onToggleFull?: () => void;
  /** The full player is open: the button closes it. */
  fullOpen?: boolean;
  /** Extra tools before the volume (rare). */
  tools?: ReactNode;
  className?: string;
}

export function PlayerBar(p: PlayerBarProps) {
  const silent = p.muted || p.volume === 0;
  return (
    <div className={cx("PlayerBar", p.className)} role="region" aria-label="Player">
      <div className="PlayerBar-now">
        <Thumb src={p.cover} />
        <div className="PlayerBar-text">
          <span className="PlayerBar-title" aria-live="polite">
            {p.title}
          </span>
          <span className="PlayerBar-artist">{p.artist}</span>
        </div>
        {p.onAddToPlaylist && (
          <IconButton icon="playlistAdd" size={20} label="Add to playlist" className="is-wide-only" onClick={p.onAddToPlaylist} />
        )}
      </div>
      <div className="PlayerBar-centre">
        <Transport
          playing={p.playing}
          shuffle={p.shuffle}
          repeat={p.repeat}
          onPlayPause={p.onPlayPause}
          onPrev={p.onPrev}
          onNext={p.onNext}
          onShuffle={p.onShuffle}
          onRepeat={p.onRepeat}
        />
        <SliderRow start={formatTime(p.position)} end={formatTime(p.duration)}>
          <Slider
            label="Position"
            value={p.position}
            max={Math.max(p.duration, 0.001)}
            keyStep={5}
            valueText={(s) => `${formatTime(s)} of ${formatTime(p.duration)}`}
            onChange={p.onSeek}
            onCommit={p.onSeekCommit}
          />
        </SliderRow>
      </div>
      <div className="PlayerBar-tools">
        {p.onLyrics && <IconButton icon="lyrics" size={20} label="Lyrics" className="is-wide-only" onClick={p.onLyrics} />}
        {p.onQueue && <IconButton icon="queue" size={20} label="Queue" pressed={!!p.queueOpen} onClick={p.onQueue} />}
        {p.tools}
        <IconButton
          icon={silent ? "volumeMute" : "volume"}
          size={20}
          label={p.muted ? "Unmute" : "Mute"}
          className="is-wide-only"
          onClick={p.onMute}
        />
        <div className="PlayerBar-volume is-wide-only">
          <Slider
            label="Volume"
            value={p.muted ? 0 : p.volume}
            max={100}
            keyStep={5}
            valueText={(v) => `${Math.round(v)} %`}
            onChange={p.onVolume}
            onCommit={p.onVolumeCommit}
          />
        </div>
        {p.onToggleFull && (
          <IconButton
            icon="expand"
            size={20}
            label={p.fullOpen ? "Close the player" : "Open the player"}
            onClick={p.onToggleFull}
          />
        )}
      </div>
    </div>
  );
}
