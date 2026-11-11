// The playing position and the song's length, outside React state. The audio element ticks about
// four times a second; kept in the app-wide state, every tick re-rendered the whole app (a list of
// 2,400 songs included). Now the player writes them here and only what shows them subscribes: the
// player bar's and the full player's slider and times (usePlaybackTime) and the Media Session.
// The hairline reads the element itself, once per frame.
import { useSyncExternalStore } from "react";

export interface PlaybackTime {
  /** Seconds into the song. */
  position: number;
  /** The song's length in seconds; 0 while unknown. */
  duration: number;
}

export interface PlaybackClock {
  get: () => PlaybackTime;
  set: (next: Partial<PlaybackTime>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createClock(): PlaybackClock {
  let time: PlaybackTime = { position: 0, duration: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set(next) {
      const position = next.position ?? time.position;
      const duration = next.duration ?? time.duration;
      if (position === time.position && duration === time.duration) return;
      time = { position, duration };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The position and length, re-rendering the caller on every tick (player surfaces only). */
export function usePlaybackTime(clock: PlaybackClock): PlaybackTime {
  return useSyncExternalStore(clock.subscribe, clock.get);
}
