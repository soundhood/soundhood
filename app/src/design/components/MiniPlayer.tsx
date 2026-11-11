// MiniPlayer (phone): 56 px on --bg-1 with the hairline on its top edge; the cover (40 px, with a
// soft glow of the artwork tint), title over artist, play/pause, next and (with onQueue) the queue.
// Tap or swipe up opens the full player. The title is a live region, so a new song is announced.
// Play and pause are both drawn and cross-fade (player.css), like the PlayButton.
import { useRef, type PointerEvent } from "react";
import { cx } from "../lib/cx";
import { isControlTarget } from "../lib/dom";
import { Hairline } from "./Hairline";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Thumb } from "./Thumb";

export interface MiniPlayerProps {
  title: string;
  artist: string;
  cover?: string | null;
  playing: boolean;
  getProgress: () => number;
  onPlayPause?: () => void;
  onNext?: () => void;
  /** Opens the queue; the button is not shown without it. */
  onQueue?: () => void;
  onOpen?: () => void;
  className?: string;
}

const SWIPE_UP = 32;

export function MiniPlayer({
  title,
  artist,
  cover,
  playing,
  getProgress,
  onPlayPause,
  onNext,
  onQueue,
  onOpen,
  className,
}: MiniPlayerProps) {
  const start = useRef<number | null>(null);
  const swiped = useRef(0);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = isControlTarget(e.target) && !(e.target as Element).closest(".MiniPlayer-open") ? null : e.clientY;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const y0 = start.current;
    start.current = null;
    if (y0 !== null && y0 - e.clientY > SWIPE_UP) {
      swiped.current = e.timeStamp;
      onOpen?.();
    }
  };
  // A swipe that ended on the bar must not open it a second time through the click after it.
  const open = (timeStamp: number) => {
    if (timeStamp - swiped.current > 400) onOpen?.();
  };

  return (
    <div
      className={cx("MiniPlayer", className)}
      role="region"
      aria-label="Now playing"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={(e) => {
        if (!isControlTarget(e.target)) open(e.timeStamp);
      }}
    >
      <Hairline getProgress={getProgress} />
      <button
        type="button"
        className="MiniPlayer-open"
        aria-label={`Open the player: ${title}, ${artist}`}
        onClick={(e) => open(e.timeStamp)}
      >
        <Thumb src={cover} />
        <span className="MiniPlayer-text">
          <span className="MiniPlayer-title" aria-live="polite">
            {title}
          </span>
          <span className="MiniPlayer-artist">{artist}</span>
        </span>
      </button>
      <button
        type="button"
        className="IconButton MiniPlayer-play"
        data-state={playing ? "playing" : "paused"}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
        onClick={onPlayPause}
      >
        <Icon name="play" size={24} className="MiniPlayer-playIcon" />
        <Icon name="pause" size={24} className="MiniPlayer-pauseIcon" />
      </button>
      <IconButton icon="next" label="Next" onClick={onNext} />
      {onQueue && <IconButton icon="queue" label="Queue" onClick={onQueue} />}
    </div>
  );
}
