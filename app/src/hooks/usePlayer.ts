// The player: the audio element, the play queue (features/queue/queueModel.ts) and what moves
// through it (play, pause, Previous, Next, the end of a song, Shuffle, Repeat), seeking, volume and
// mute, letting go of a file before it is rewritten and picking it up again, cover art and the Media
// Session. Loading a song (the file URL on the PC, the bytes on the phone; only the newest load
// plays) is features/player/audioLoader.ts. The position and the length live in a clock outside
// React state (features/player/playbackClock.ts): a tick re-renders only what shows them.
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createLoader, createUrlSlot, mimeFor } from "../features/player/audioLoader";
import { createClock } from "../features/player/playbackClock";
import * as Q from "../features/queue/queueModel";
import { clamp } from "../lib/format";
import { KEY_VOLUME, storePromise } from "../lib/store";
import { displayName } from "../lib/tracks";
import type { HeldPlayback, Setter, Track } from "../lib/types";

export type Player = ReturnType<typeof usePlayer>;

/** Past this many seconds into a song, Previous starts it again instead of going back one. */
export const RESTART_AFTER = 3;

type PlayerArgs = {
  isMobile: boolean;
  setStatus: Setter<string>;
  allTracks: Track[];
  filteredTracks: Track[];
  openPlaylistView: (name: string) => void;
  setPlView: Setter<string>;
  setPlaylist: Setter<string>;
  setArtistView: Setter<string>;
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function usePlayer({ isMobile, setStatus, allTracks, filteredTracks, openPlaylistView, setPlView, setPlaylist, setArtistView }: PlayerArgs) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const [currentPath, setCurrentPathState] = useState<string>("");
  const [currentName, setCurrentName] = useState<string>("");
  const [currentPlaylist, setCurrentPlaylist] = useState<string>("");
  const currentPathRef = useRef<string>("");
  currentPathRef.current = currentPath;

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [clock] = useState(createClock);
  const [loader] = useState(() =>
    createLoader({
      audio: () => audioRef.current,
      bytesOnly: () => isMobileRef.current,
      fileUrl: (path) => convertFileSrc(path),
      readBytes: (path) => invoke<ArrayBuffer>("read_file_bytes", { path }),
      fetchBytes: async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      },
      objectUrl: (bytes, mime) => URL.createObjectURL(new Blob([bytes], { type: mime })),
      revokeUrl: (url) => URL.revokeObjectURL(url),
      setPlaying: setIsPlaying,
      setStatus,
    }),
  );

  // The queue: state for the screens, a ref for the handlers that run between renders.
  const [queue, setQueueState] = useState<Q.QueueState>(() => Q.emptyQueue());
  const queueRef = useRef(queue);
  function commitQueue(next: Q.QueueState) {
    if (next === queueRef.current) return;
    queueRef.current = next;
    setQueueState(next);
  }

  const trackByPath = useMemo(() => new Map(allTracks.map((t) => [t.path, t] as const)), [allTracks]);
  const trackByPathRef = useRef(trackByPath);
  trackByPathRef.current = trackByPath;

  // Double-click on a playlist/artist/folder: open it, turn shuffle on, start on a random track.
  // The list is derived state, so the play happens once the new list has been computed.
  const autoplayRef = useRef<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  // Mute silences the player without touching the saved volume (not remembered across starts).
  const [muted, setMuted] = useState<boolean>(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
  }, [muted]);
  // Set by the startup load once the saved settings (the volume among them) have been read.
  const settingsLoadedRef = useRef<boolean>(false);

  // Volume: apply to the player immediately, persist a moment after the slider stops moving
  // (but never before the saved value has been read, or we'd overwrite it with the default).
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    if (!settingsLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const store = await storePromise;
        await store.set(KEY_VOLUME, volume);
        await store.save();
      } catch {
        /* non-fatal */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [volume]);

  useEffect(() => {
    if (!autoplayRef.current) return;
    if (filteredTracks.length === 0) return;
    autoplayRef.current = false;
    playList(filteredTracks, null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks]);

  function shufflePlayPlaylist(name: string) {
    autoplayRef.current = true;
    openPlaylistView(name);
  }
  function shufflePlayArtist(name: string) {
    autoplayRef.current = true;
    setPlView("");
    setPlaylist("(all)");
    setArtistView(name);
  }
  function shufflePlayFolder(name: string) {
    autoplayRef.current = true;
    setPlView("");
    setArtistView("");
    setPlaylist(name);
  }

  const currentTrack = currentPath ? trackByPath.get(currentPath) ?? null : null;

  /** The playing song changes (a load, a move, an undo): the state, the ref and the queue follow. */
  function showPath(path: string) {
    currentPathRef.current = path;
    setCurrentPathState(path);
  }

  /** For the file edits: the playing song's file moved or came back; its queue rows follow it. */
  const setCurrentPath: Setter<string> = (value: SetStateAction<string>) => {
    const before = currentPathRef.current;
    const next = typeof value === "function" ? value(before) : value;
    showPath(next);
    if (before && next && before !== next) commitQueue(Q.remapPath(queueRef.current, before, next));
  };

  /** Loads the song at `path` into the player; plays it when `play`. */
  function loadPath(path: string, play: boolean) {
    const t = trackByPathRef.current.get(path);
    const label = displayName(t?.name ?? fileName(path));
    showPath(path);
    setCurrentName(label);
    setCurrentPlaylist(t?.playlist || "(root)");
    loader.load({ path, label }, play);
  }

  /** The playing song again from the start. */
  function restart(play: boolean) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    clock.set({ position: 0 });
    if (play) audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }

  /** Does what a move through the queue asks: load another song, restart this one, or stop. */
  function follow(step: Q.Step) {
    const before = queueRef.current.now;
    commitQueue(step.state);
    if (!step.entry) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (before && step.entry.id === before.id) {
      restart(step.play);
    } else {
      loadPath(step.entry.path, step.play);
    }
  }

  /**
   * Plays `list` (the list a song was started from) from `start`, or from the top (a random song
   * with Shuffle on): the list becomes the queue's source.
   */
  function playList(list: readonly Track[], start: Track | null, shuffleOn: boolean = queueRef.current.shuffle) {
    const index = start ? list.findIndex((t) => t.path === start.path) : -1;
    follow(Q.seed(queueRef.current, list.map((t) => t.path), index, shuffleOn, Math.random));
  }

  /** Plays `list` from its first song, or from a random one with shuffle on. */
  function playFrom(list: Track[], shuffleOn: boolean) {
    playList(list, null, shuffleOn);
  }

  // Write safety for the playing track: before its file is rewritten or moved, the player lets go
  // of it (no open handle, no range read of a half-replaced file), and afterwards it reloads the
  // file at the saved position, resuming if it was playing.

  /** Stops and releases the player when `path` is the track it holds; null otherwise. */
  function releasePlayingTrack(path: string): HeldPlayback | null {
    const audio = audioRef.current;
    if (!audio || !path || path !== currentPathRef.current) return null;
    loader.cancel();
    // The phone always plays from the file's bytes; the desktop too once the file URL was refused.
    const held = { pos: audio.currentTime || 0, wasPlaying: !audio.paused, viaBytes: isMobile || audio.src.startsWith("blob:") };
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setIsPlaying(false);
    return held;
  }

  /** Loads `path` into the released player the same way it was playing, at the saved position. */
  async function reloadHeldTrack(held: HeldPlayback, path: string) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = loader.begin(); // a newer song chosen meanwhile wins over this reload
    try {
      let src: string;
      if (held.viaBytes) {
        const buf = await invoke<ArrayBuffer>("read_file_bytes", { path });
        if (!t.live()) return;
        src = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }));
        loader.holdBytes(src);
      } else {
        src = convertFileSrc(path);
      }
      const resume = () => {
        if (!t.live()) return;
        audio.currentTime = held.pos;
        clock.set({ position: held.pos });
        if (held.wasPlaying) audio.play().then(() => t.live() && setIsPlaying(true)).catch(() => t.live() && setIsPlaying(false));
      };
      audio.addEventListener("loadedmetadata", resume, { once: true, signal: t.signal });
      audio.src = src;
      audio.load();
    } catch (e) {
      if (!t.live()) return;
      setIsPlaying(false);
      setStatus(`Can't reload the playing track: ${String(e).slice(0, 120)}`);
    }
  }

  /** Stops playback and forgets the current track (its file is gone); the rest of the queue stays. */
  function stopPlayer() {
    loader.empty();
    setIsPlaying(false);
    showPath("");
    setCurrentName("");
    setCurrentPlaylist("");
    clock.set({ position: 0, duration: 0 });
    commitQueue(Q.stopNow(queueRef.current));
  }

  /** The playing position as a fraction of the song, read from the audio element (the hairline). */
  function getProgress(): number {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return 0;
    return audio.currentTime / audio.duration;
  }

  /** Play or pause; with nothing loaded, the queue's next song (if any). */
  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentPathRef.current) {
      if (Q.upcomingCount(queueRef.current) > 0) playNext();
      return;
    }
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }

  /** Previous: the song again when it is past 3 s, else the song before it. */
  function playPrev() {
    const audio = audioRef.current;
    if (audio && currentPathRef.current && audio.currentTime > RESTART_AFTER) {
      restart(isPlaying);
      return;
    }
    follow(Q.back(queueRef.current));
  }

  function playNext() {
    follow(Q.advance(queueRef.current, false, Math.random));
  }

  /** The song ended by itself: the queue's next (Repeat one: the same again; the end: stop). */
  function onEnded() {
    setIsPlaying(false);
    follow(Q.advance(queueRef.current, true, Math.random));
  }

  // The queue's own actions (the queue pane and sheet, the row menus, the keyboard).
  const paths = (tracks: readonly Track[]) => tracks.map((t) => t.path);
  const queueActions = {
    /** Play next: these songs go to the top of "Next in queue". */
    playNextTracks(tracks: readonly Track[]) {
      commitQueue(Q.playNext(queueRef.current, paths(tracks)));
    },
    /** Add to queue: these songs go to the end of "Next in queue". */
    addToQueue(tracks: readonly Track[]) {
      commitQueue(Q.addToQueue(queueRef.current, paths(tracks)));
    },
    jumpTo(section: Q.QueueSectionId, index: number) {
      follow(Q.jump(queueRef.current, section, index));
    },
    moveInQueue(section: Q.QueueSectionId, from: number, to: number) {
      commitQueue(Q.move(queueRef.current, section, from, to));
    },
    /** Takes a row out; the result puts it back (a toast's Undo). */
    removeFromQueue(section: Q.QueueSectionId, index: number): Q.Removed | null {
      const { state, removed } = Q.remove(queueRef.current, section, index);
      commitQueue(state);
      return removed;
    },
    restoreToQueue(removed: Q.Removed) {
      commitQueue(Q.restore(queueRef.current, removed));
    },
    /** Takes every upcoming row of these songs out; returns how many went. */
    removeTracksFromQueue(tracks: readonly Track[]): number {
      const before = Q.upcomingCount(queueRef.current);
      commitQueue(Q.removePaths(queueRef.current, new Set(paths(tracks))));
      return before - Q.upcomingCount(queueRef.current);
    },
    clearQueue() {
      commitQueue(Q.clear(queueRef.current));
    },
  };

  function setShuffle(value: SetStateAction<boolean>) {
    const q = queueRef.current;
    const on = typeof value === "function" ? value(q.shuffle) : value;
    commitQueue(Q.setShuffle(q, on, Math.random));
  }

  function cycleRepeat() {
    const q = queueRef.current;
    commitQueue({ ...q, repeat: Q.nextRepeat(q.repeat) });
  }

  /** The seek bar moved (desktop player bar and phone player alike). */
  function seekTo(value: string) {
    const audio = audioRef.current;
    if (!audio) return;
    const v = Number(value);
    audio.currentTime = clamp(v, 0, audio.duration || 0);
    clock.set({ position: audio.currentTime });
  }

  // A song whose file left the library leaves the queue (the playing one is stopped elsewhere).
  useEffect(() => {
    commitQueue(Q.prune(queueRef.current, (p) => trackByPath.has(p)));
  }, [trackByPath]);

  // The handlers the element and the Media Session call between renders: always the newest.
  const handlers = useRef({ onEnded, playPrev, playNext });
  useEffect(() => {
    handlers.current = { onEnded, playPrev, playNext };
  });

  // The position, the song's length and the end of a song, whichever route loaded the file (direct
  // URL on the PC, the file's bytes on the phone, a reload after a write). Without the length the
  // seek bar's maximum stays 0: it sits at the start and cannot be dragged. A new file starting to
  // load resets the bar (on the phone the old song plays on while the new one's bytes arrive); an
  // emptied player (NaN) or a stream of unknown length (Infinity) keeps the last known length;
  // stopPlayer clears it. None of this is React state (playbackClock.ts).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => clock.set({ position: audio.currentTime || 0 });
    const onLoadStart = () => clock.set({ position: 0, duration: 0 });
    const onLength = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) clock.set({ duration: d });
    };
    const ended = () => handlers.current.onEnded();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("loadedmetadata", onLength);
    audio.addEventListener("durationchange", onLength);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("loadedmetadata", onLength);
      audio.removeEventListener("durationchange", onLength);
      audio.removeEventListener("ended", ended);
    };
  }, [clock]);

  // Cover picture embedded in the playing file (front cover), as a blob URL; "" when none. The old
  // picture is let go of when a new one arrives, when nothing plays any more, and at the end.
  const [coverUrl, setCoverUrl] = useState<string>("");
  const [cover] = useState(() => createUrlSlot((url) => URL.revokeObjectURL(url)));
  useEffect(() => {
    let cancelled = false;
    const none = () => {
      cover.clear();
      setCoverUrl("");
    };
    if (!currentPath) {
      none();
      return;
    }
    (async () => {
      try {
        const buf = await invoke<ArrayBuffer>("cover_art", { path: currentPath });
        if (cancelled) return;
        if (!buf || buf.byteLength < 16) return none();
        const b = new Uint8Array(buf, 0, 4);
        const mime = b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x52 && b[1] === 0x49 ? "image/webp" : "image/jpeg";
        const url = URL.createObjectURL(new Blob([buf], { type: mime }));
        cover.set(url);
        setCoverUrl(url);
      } catch {
        if (!cancelled) none();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPath, cover]);
  useEffect(() => () => cover.clear(), [cover]);

  // Lock screen / headset / notification controls (Media Session API). The phone shows the song
  // and artist and routes play/pause/next/previous/seek back into the app; same on desktop.
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title: currentName || "Soundhood",
        artist: currentTrack?.artist || "",
        album: currentPlaylist || "",
        artwork: coverUrl ? [{ src: coverUrl, sizes: "512x512", type: "image/jpeg" }] : [],
      });
      ms.playbackState = currentPath ? (isPlaying ? "playing" : "paused") : "none";
    } catch { /* older webview */ }
  }, [currentName, currentPath, currentPlaylist, isPlaying, currentTrack?.artist, coverUrl]);
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch { /* unsupported action */ } };
    const seek = (to: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = clamp(to, 0, a.duration || 0);
      clock.set({ position: a.currentTime });
    };
    set("play", () => { const a = audioRef.current; if (a && a.src) a.play().then(() => setIsPlaying(true)).catch(() => {}); });
    set("pause", () => { const a = audioRef.current; if (a) { a.pause(); setIsPlaying(false); } });
    set("previoustrack", () => handlers.current.playPrev());
    set("nexttrack", () => handlers.current.playNext());
    set("seekto", (d) => { if (typeof d.seekTime === "number") seek(d.seekTime); });
    set("seekbackward", (d) => seek((audioRef.current?.currentTime ?? 0) - (d.seekOffset || 10)));
    set("seekforward", (d) => seek((audioRef.current?.currentTime ?? 0) + (d.seekOffset || 10)));
    return () => { for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) set(a, null); };
  }, [clock]);
  useEffect(
    () =>
      clock.subscribe(() => {
        const ms = (navigator as any).mediaSession as MediaSession | undefined;
        const a = audioRef.current;
        const { position, duration } = clock.get();
        if (!ms || !a || !duration || !isFinite(duration)) return;
        try { ms.setPositionState({ duration, playbackRate: a.playbackRate || 1, position: Math.min(position, duration) }); } catch { /* ignore */ }
      }),
    [clock],
  );

  return {
    audioRef,
    settingsLoadedRef,
    currentPath,
    setCurrentPath,
    currentPathRef,
    currentName,
    currentPlaylist,
    setCurrentPlaylist,
    currentTrack,
    /** Every song by its path (the queue's rows, dropped songs). */
    trackByPath,
    isPlaying,
    /** The position and the length; read with usePlaybackTime(player.clock). */
    clock,
    queue,
    shuffle: queue.shuffle,
    setShuffle,
    repeat: queue.repeat,
    cycleRepeat,
    volume,
    setVolume,
    muted,
    setMuted,
    coverUrl,
    playList,
    playFrom,
    getProgress,
    releasePlayingTrack,
    reloadHeldTrack,
    stopPlayer,
    togglePlay,
    playPrev,
    playNext,
    seekTo,
    ...queueActions,
    shufflePlayPlaylist,
    shufflePlayArtist,
    shufflePlayFolder,
  };
}
