// PlayButton: the round aqua play/pause, 40 px in the player bar and 64 px (large) in the full
// player. Both glyphs are drawn and cross-fade (controls.css), so the swap never jumps. A held key
// is one press (onePress).
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "../lib/cx";
import { onePress } from "../lib/dom";
import { Icon } from "./Icon";

export interface PlayButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** True while the music plays: the button shows pause. */
  playing: boolean;
  large?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function PlayButton({ playing, large, className, type, onKeyDown, ...rest }: PlayButtonProps) {
  const size = large ? 32 : 20;
  return (
    <button
      type={type ?? "button"}
      className={cx("PlayButton", large && "is-large", className)}
      data-state={playing ? "playing" : "paused"}
      aria-label={playing ? "Pause" : "Play"}
      title={playing ? "Pause" : "Play"}
      onKeyDown={onePress(onKeyDown)}
      {...rest}
    >
      <Icon name="play" size={size} className="PlayButton-play" />
      <Icon name="pause" size={size} className="PlayButton-pause" />
    </button>
  );
}
