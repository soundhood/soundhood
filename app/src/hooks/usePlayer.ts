// The player: the audio element, loading a track (direct file URL on the PC, the file's bytes on
// the phone), play/pause/previous/next, shuffle, seeking, volume, the song length, letting go of
// a file before it is rewritten and picking it up again, cover art and the Media Session.
import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { clamp } from "../lib/format";
import { KEY_VOLUME, storePromise } from "../lib/store";
import { displayName } from "../lib/tracks";
import type { HeldPlayback, Setter, Track } from "../lib/types";

export type Player = ReturnType<typeof usePlayer>;

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ext === "m4a" || ext === "mp4" ? "audio/mp4"
    : ext === "mp3" ? "audio/mpeg"
    : ext === "flac" ? "audio/flac"
    : ext === "ogg" || ext === "oga" ? "audio/ogg"
    : ext === "opus" ? "audio/ogg"
    : ext === "wav" ? "audio/wav"
    : ext === "aac" ? "audio/aac"
    : "audio/*";
}

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

export function usePlayer({ isMobile, setStatus, allTracks, filteredTracks, openPlaylistView, setPlView, setPlaylist, setArtistView }: PlayerArgs) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [currentPath, setCurrentPath] = useState<string>("");
  const [currentName, setCurrentName] = useState<string>("");
  const [currentPlaylist, setCurrentPlaylist] = useState<string>("");

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [shuffle, setShuffle] = useState<boolean>(false);
  // Double-click on a playlist/artist/folder: open it, turn shuffle on, start on a random track.
  // The list is derived state, so the play happens once the new list has been computed.
  const autoplayRef = useRef<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
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
    const t = filteredTracks[Math.floor(Math.random() * filteredTracks.length)];
    loadAndPlay(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks]);

  function shufflePlayPlaylist(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    openPlaylistView(name);
  }
  function shufflePlayArtist(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    setPlView("");
    setPlaylist("(all)");
    setArtistView(name);
  }
  function shufflePlayFolder(name: string) {
    setShuffle(true);
    autoplayRef.current = true;
    setPlView("");
    setArtistView("");
    setPlaylist(name);
  }

  const currentTrack = useMemo(
    () => (currentPath ? allTracks.find((t) => t.path === currentPath) ?? null : null),
    [allTracks, currentPath]
  );

  const currentIndex = useMemo(() => {
    if (!currentPath) return -1;
    return filteredTracks.findIndex((t) => t.path === currentPath);
  }, [filteredTracks, currentPath]);

  function pickNextIndex(delta: number) {
    const n = filteredTracks.length;
    if (n === 0) return -1;
    if (shuffle) return Math.floor(Math.random() * n);
    const base = currentIndex >= 0 ? currentIndex : 0;
    return (base + delta + n) % n;
  }

  function loadAndPlay(t: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    reloadAbortRef.current?.abort(); // a newer track wins over a pending reload

    const src = convertFileSrc(t.path);
    setCurrentPath(t.path);
    setCurrentName(displayName(t.name));
    setCurrentPlaylist(t.playlist || "(root)");

    // Phone: the webview never accepts the direct file URL (and can take seconds to say so),
    // so go straight to the bytes route.
    if (isMobile) {
      playViaBlob(t, src, "android: direct file URL skipped", true);
      return;
    }
    audio.src = src;
    audio.load();

    // Any failure to load/decode the file is otherwise silent (nothing plays, no message):
    // surface it in the status pill, with the media error code.
    audio.onerror = () => {
      const code = audio.error?.code;
      const why = code === 1 ? "aborted" : code === 2 ? "network/read error" : code === 3 ? "decode error" : code === 4 ? "format not supported / file not reachable" : "unknown";
      setIsPlaying(false);
      setStatus(`Can't play "${displayName(t.name)}": ${why}`);
    };
    // play() is called right inside the tap/click (a "user gesture"): phones refuse playback
    // started later from a callback. It simply waits for enough data, then starts.
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => {
        setIsPlaying(false);
        // The direct file URL was refused (seen on Android): pull the file through the same
        // channel as a plain download and hand the bytes to the player instead.
        playViaBlob(t, src, String(e?.message || e));
      });
  }

  const blobUrlRef = useRef<string>("");
  async function playViaBlob(t: Track, src: string, firstError: string, rustOnly = false) {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("Loading…");
    try {
      let buf: ArrayBuffer;
      if (rustOnly) {
        buf = await invoke<ArrayBuffer>("read_file_bytes", { path: t.path });
      } else {
        try {
          const r = await fetch(src);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          buf = await r.arrayBuffer();
        } catch {
          // The file URL is not reachable from the page at all: ask Rust for the bytes.
          buf = await invoke<ArrayBuffer>("read_file_bytes", { path: t.path });
        }
      }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(new Blob([buf], { type: mimeFor(t.path) }));
      blobUrlRef.current = url;
      audio.onerror = () => {
        setIsPlaying(false);
        setStatus(`Can't decode "${displayName(t.name)}" (${(buf.byteLength / 1e6).toFixed(1)} MB, error ${audio.error?.code ?? "?"})`);
      };
      audio.src = url;
      audio.load();
      await audio.play();
      setIsPlaying(true);
      setStatus(`Playing (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
    } catch (e: any) {
      setIsPlaying(false);
      setStatus(`Can't play "${displayName(t.name)}": ${e?.message || e} · first: ${firstError}`);
    }
  }

  // Write safety for the playing track: before its file is rewritten or moved, the player lets go
  // of it (no open handle, no range read of a half-replaced file), and afterwards it reloads the
  // file at the saved position, resuming if it was playing.
  const currentPathRef = useRef<string>("");
  currentPathRef.current = currentPath;
  // A pending reload's listeners, dropped when something else is loaded first.
  const reloadAbortRef = useRef<AbortController | null>(null);

  /** Stops and releases the player when `path` is the track it holds; null otherwise. */
  function releasePlayingTrack(path: string): HeldPlayback | null {
    const audio = audioRef.current;
    if (!audio || !path || path !== currentPathRef.current) return null;
    reloadAbortRef.current?.abort();
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
    const ac = new AbortController();
    reloadAbortRef.current = ac;
    try {
      let src: string;
      if (held.viaBytes) {
        const buf = await invoke<ArrayBuffer>("read_file_bytes", { path });
        if (ac.signal.aborted) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        src = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }));
        blobUrlRef.current = src;
      } else {
        src = convertFileSrc(path);
      }
      const resume = () => {
        ac.abort();
        audio.currentTime = held.pos;
        setProgress(held.pos);
        if (held.wasPlaying) audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      };
      audio.addEventListener("loadedmetadata", resume, { once: true, signal: ac.signal });
      audio.addEventListener("error", () => ac.abort(), { once: true, signal: ac.signal });
      audio.src = src;
      audio.load();
    } catch (e) {
      ac.abort();
      setIsPlaying(false);
      setStatus(`Can't reload the playing track: ${String(e).slice(0, 120)}`);
    }
  }

  /** Stops playback and forgets the current track (its file is gone). */
  function stopPlayer() {
    reloadAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setIsPlaying(false);
    setCurrentPath("");
    setCurrentName("");
    setCurrentPlaylist("");
    setProgress(0);
    setDuration(0);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }

  function playPrev() {
    const idx = pickNextIndex(-1);
    if (idx >= 0) loadAndPlay(filteredTracks[idx]);
  }

  function playNext() {
    const idx = pickNextIndex(1);
    if (idx >= 0) loadAndPlay(filteredTracks[idx]);
  }

  /** The seek bar moved (desktop player bar and phone player alike). */
  function seekTo(value: string) {
    const audio = audioRef.current;
    if (!audio) return;
    const v = Number(value);
    audio.currentTime = clamp(v, 0, audio.duration || 0);
    setProgress(audio.currentTime);
  }

  // Keep progress updated
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setProgress(audio.currentTime || 0);
    const onEnded = () => {
      setIsPlaying(false);
      playNext();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks, currentIndex, shuffle]);

  // The song length, whichever route loaded the file (direct URL on the PC, the file's bytes on
  // the phone, a reload after a write). Without it the seek bar's maximum stays 0: it sits at the
  // start and cannot be dragged. A new file starting to load resets the bar (on the phone the old
  // song plays on while the new one's bytes arrive); an emptied player (NaN) or a stream of
  // unknown length (Infinity) keeps the last known length; stopPlayer clears it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadStart = () => {
      setProgress(0);
      setDuration(0);
    };
    const onLength = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("loadedmetadata", onLength);
    audio.addEventListener("durationchange", onLength);
    return () => {
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("loadedmetadata", onLength);
      audio.removeEventListener("durationchange", onLength);
    };
  }, []);

  // Cover picture embedded in the playing file (front cover), as a blob URL; "" when none.
  const [coverUrl, setCoverUrl] = useState<string>("");
  const coverUrlRef = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    if (!currentPath) { setCoverUrl(""); return; }
    (async () => {
      try {
        const buf = await invoke<ArrayBuffer>("cover_art", { path: currentPath });
        if (cancelled) return;
        if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
        coverUrlRef.current = "";
        if (!buf || buf.byteLength < 16) { setCoverUrl(""); return; }
        const b = new Uint8Array(buf, 0, 4);
        const mime = b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x52 && b[1] === 0x49 ? "image/webp" : "image/jpeg";
        const url = URL.createObjectURL(new Blob([buf], { type: mime }));
        coverUrlRef.current = url;
        setCoverUrl(url);
      } catch {
        if (!cancelled) setCoverUrl("");
      }
    })();
    return () => { cancelled = true; };
  }, [currentPath]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentName, currentPath, currentPlaylist, isPlaying, currentTrack?.artist, coverUrl]);
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    if (!ms) return;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch { /* unsupported action */ } };
    set("play", () => { const a = audioRef.current; if (a && a.src) a.play().then(() => setIsPlaying(true)).catch(() => {}); });
    set("pause", () => { const a = audioRef.current; if (a) { a.pause(); setIsPlaying(false); } });
    set("previoustrack", () => playPrev());
    set("nexttrack", () => playNext());
    set("seekto", (d) => { const a = audioRef.current; if (a && typeof d.seekTime === "number") { a.currentTime = d.seekTime; setProgress(a.currentTime); } });
    set("seekbackward", (d) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, a.currentTime - (d.seekOffset || 10)); });
    set("seekforward", (d) => { const a = audioRef.current; if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + (d.seekOffset || 10)); });
    return () => { for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) set(a, null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTracks, currentIndex, shuffle]);
  useEffect(() => {
    const ms = (navigator as any).mediaSession as MediaSession | undefined;
    const a = audioRef.current;
    if (!ms || !a || !duration || !isFinite(duration)) return;
    try { ms.setPositionState({ duration, playbackRate: a.playbackRate || 1, position: Math.min(progress, duration) }); } catch { /* ignore */ }
  }, [duration, progress]);

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
    currentIndex,
    isPlaying,
    progress,
    duration,
    shuffle,
    setShuffle,
    volume,
    setVolume,
    coverUrl,
    loadAndPlay,
    releasePlayingTrack,
    reloadHeldTrack,
    stopPlayer,
    togglePlay,
    playPrev,
    playNext,
    seekTo,
    shufflePlayPlaylist,
    shufflePlayArtist,
    shufflePlayFolder,
  };
}
