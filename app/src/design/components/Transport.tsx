// Transport: shuffle, previous, the aqua play button, next, repeat. Large in the full player
// (64 px play, 56 px skip buttons), small in the player bar (40 px play). Shuffle and repeat are
// toggles (aria-pressed, aqua while on); repeat has three states: off, all, one.
import { cx } from "../lib/cx";
import { IconButton } from "./IconButton";
import { PlayButton } from "./PlayButton";

export type RepeatMode = "off" | "all" | "one";

export interface TransportProps {
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  onPlayPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onShuffle?: () => void;
  onRepeat?: () => void;
  large?: boolean;
  className?: string;
}

export function Transport({
  playing,
  shuffle,
  repeat,
  onPlayPause,
  onPrev,
  onNext,
  onShuffle,
  onRepeat,
  large,
  className,
}: TransportProps) {
  const toggle = large ? 24 : 20;
  const skip = large ? 32 : 24;
  return (
    <div className={cx("Transport", className)} role="group" aria-label="Playback">
      <IconButton
        icon="shuffle"
        size={toggle}
        label="Shuffle"
        pressed={shuffle}
        className={cx(!shuffle && "is-quiet")}
        onClick={onShuffle}
      />
      <IconButton icon="prev" size={skip} label="Previous" className={cx(large && "is-big")} onClick={onPrev} />
      <PlayButton playing={playing} large={large} onClick={onPlayPause} />
      <IconButton icon="next" size={skip} label="Next" className={cx(large && "is-big")} onClick={onNext} />
      <IconButton
        icon={repeat === "one" ? "repeatOne" : "repeat"}
        size={toggle}
        label={repeat === "one" ? "Repeat one" : "Repeat"}
        pressed={repeat !== "off"}
        className={cx(repeat === "off" && "is-quiet")}
        onClick={onRepeat}
      />
    </div>
  );
}
