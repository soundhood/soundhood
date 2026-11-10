// FullPlayer. On the phone a screen over everything (the shell hides the mini player and tabs under
// it): a top row with Close and where the music plays from; the artwork (at most 80 % of the width,
// --r-xl); the title (h2, two lines at most) and the artist; the position slider with times; the
// transport; a bottom row of queue, lyrics, add to playlist and more. The background runs from the
// artwork tint into --bg-0. Swipe down (touch) or Esc closes it.
// Where the player is 600 px wide or more (the main pane of a tablet or desktop shell) the same
// component lays out in two columns: artwork; then where it plays from, the title in display size,
// the artist, facts (length, format...) and the action row. The transport stays in the player bar.
// The layout switch is CSS only (a container query on the player). When it closes with the focus in
// it, the focus goes back to what opened it, else to the main area (useFocusReturn).
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { cssVars, cx } from "../lib/cx";
import { formatTime } from "../lib/time";
import { useFocusReturn } from "../lib/useFocusReturn";
import { useSwipe } from "../lib/useSwipe";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Slider, SliderRow } from "./Slider";
import { Transport, type RepeatMode } from "./Transport";

export interface FullPlayerProps {
  title: string;
  artist: string;
  cover?: string | null;
  /** Where the music plays from: kind ("playlist", "artist", "folder") and its name. */
  source: { kind: string; name: string };
  /** Facts for the wide layout ("2:52", "AAC 256 kbps", "4 of 12"). */
  facts?: readonly string[];
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Seconds. */
  position: number;
  duration: number;
  onSeek?: (seconds: number) => void;
  onSeekCommit?: (seconds: number) => void;
  onPlayPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onShuffle?: () => void;
  onRepeat?: () => void;
  onClose?: () => void;
  onQueue?: () => void;
  /** Leave out until lyrics exist (Phase 5): the button is not shown without it. */
  onLyrics?: () => void;
  onAddToPlaylist?: () => void;
  /** The "more" control, usually a MenuButton. */
  more?: ReactNode;
  className?: string;
}

export function FullPlayer(p: FullPlayerProps) {
  const swipe = useSwipe({ axis: "down", onSwipe: () => p.onClose?.(), enabled: !!p.onClose });
  const root = useRef<HTMLDivElement>(null);
  useFocusReturn(root);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented && p.onClose) p.onClose();
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const valueText = (s: number) => `${formatTime(s)} of ${formatTime(p.duration)}`;

  return (
    <div
      ref={root}
      className={cx("FullPlayer", p.className)}
      role="region"
      aria-label="Now playing"
      data-dragging={swipe.dragging || undefined}
      style={cssVars({ "--drag-y": `${swipe.offset}px` })}
      {...swipe.handlers}
    >
      <div className="FullPlayer-inner">
        <div className="FullPlayer-top">
          <IconButton icon="chevronDown" label="Close the player" strong onClick={p.onClose} />
          <div className="FullPlayer-source">
            <span className="t-overline">Playing from {p.source.kind}</span>
            <strong>{p.source.name}</strong>
          </div>
          <span />
        </div>
        {p.cover ? (
          <img className="FullPlayer-art" src={p.cover} alt={`Artwork of ${p.title}`} draggable={false} />
        ) : (
          <span className="FullPlayer-art is-empty" aria-hidden="true">
            <Icon name="music" size={48} />
          </span>
        )}
        <div className="FullPlayer-meta">
          <h2 className="FullPlayer-title" aria-live="polite">
            {p.title}
          </h2>
          <div className="FullPlayer-artist">{p.artist}</div>
        </div>
        <div className="FullPlayer-desk">
          <div>
            {/* The same words as the phone's top row: the kind of list as the overline, its name as named. */}
            <div className="FullPlayer-source">
              <span className="t-overline">Playing from {p.source.kind}</span>
              <strong>{p.source.name}</strong>
            </div>
            <h1 aria-live="polite">{p.title}</h1>
            <div className="FullPlayer-artist">{p.artist}</div>
          </div>
          {p.facts && p.facts.length > 0 && (
            <div className="FullPlayer-facts">
              {p.facts.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
        </div>
        <SliderRow stacked start={formatTime(p.position)} end={formatTime(p.duration)}>
          <Slider
            label="Position"
            value={p.position}
            max={Math.max(p.duration, 0.001)}
            keyStep={5}
            valueText={valueText}
            onChange={p.onSeek}
            onCommit={p.onSeekCommit}
          />
        </SliderRow>
        <Transport
          large
          playing={p.playing}
          shuffle={p.shuffle}
          repeat={p.repeat}
          onPlayPause={p.onPlayPause}
          onPrev={p.onPrev}
          onNext={p.onNext}
          onShuffle={p.onShuffle}
          onRepeat={p.onRepeat}
        />
        <div className="FullPlayer-actions">
          {p.onQueue && <IconButton icon="queue" label="Queue" onClick={p.onQueue} />}
          {p.onLyrics && <IconButton icon="lyrics" label="Lyrics" onClick={p.onLyrics} />}
          {p.onAddToPlaylist && <IconButton icon="playlistAdd" label="Add to playlist" onClick={p.onAddToPlaylist} />}
          {p.more}
        </div>
      </div>
    </div>
  );
}
