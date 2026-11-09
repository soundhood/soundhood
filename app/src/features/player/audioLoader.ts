// Loading songs into the audio element, one at a time. Plain functions, no React (the player hook
// owns one loader; audioLoader.test.ts drives it with a fake element).
//
// Two routes: the file's URL straight into the element (the PC), or the file's bytes as a blob URL
// (the phone, whose WebView never accepts the file URL, and the PC when the file URL is refused).
//
// Only the newest load may act. Every load takes a ticket; whatever an older load still had pending
// (a play() promise, bytes on their way, an error listener) finds its ticket out of date and does
// nothing. That is the fix for a song chosen before the previous one started: the previous play()
// is rejected by the new load ("interrupted by a new load request"), and its error handler used to
// take that for a refused file and play the OLD song again through the bytes route.
//
// Object URLs (the bytes of the playing song, the cover) are held in slots that let go of the old
// URL when a new one arrives and when playback stops.

/** The parts of an <audio> element the loader uses. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  readonly error: { code: number } | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
}

export interface LoaderDeps {
  audio: () => AudioLike | null;
  /** Skip the file URL and read the bytes straight away (the phone). */
  bytesOnly: () => boolean;
  fileUrl: (path: string) => string;
  /** The file's bytes from the host (read_file_bytes). */
  readBytes: (path: string) => Promise<ArrayBuffer>;
  /** The file's bytes through its URL, like a download. */
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  objectUrl: (bytes: ArrayBuffer, mime: string) => string;
  revokeUrl: (url: string) => void;
  setPlaying: (playing: boolean) => void;
  setStatus: (text: string) => void;
}

/** One song to load: its file, and its name for the status line. */
export interface LoadItem {
  path: string;
  label: string;
}

/** A load in progress: is it still the newest, and the signal that drops its listeners. */
export interface LoadTicket {
  live: () => boolean;
  signal: AbortSignal;
}

export function mimeFor(path: string): string {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ext === "m4a" || ext === "mp4" ? "audio/mp4"
    : ext === "mp3" ? "audio/mpeg"
    : ext === "flac" ? "audio/flac"
    : ext === "ogg" || ext === "oga" || ext === "opus" ? "audio/ogg"
    : ext === "wav" ? "audio/wav"
    : ext === "aac" ? "audio/aac"
    : "audio/*";
}

/** A play() that stopped because something newer happened (a new load, a pause), not a refusal. */
export function isInterrupted(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}

/** Holds one object URL: a new one lets go of the old, clear() lets go of it. */
export function createUrlSlot(revoke: (url: string) => void) {
  let url = "";
  return {
    get: () => url,
    set(next: string) {
      if (url && url !== next) revoke(url);
      url = next;
    },
    clear() {
      if (url) revoke(url);
      url = "";
    },
  };
}

export type Loader = ReturnType<typeof createLoader>;

export function createLoader(d: LoaderDeps) {
  let ticket = 0;
  let attempt: AbortController | null = null;
  const bytes = createUrlSlot(d.revokeUrl);

  /** Drops the listeners of the attempt before (the file URL's, when the bytes route takes over). */
  function newAttempt(): AbortSignal {
    attempt?.abort();
    attempt = new AbortController();
    return attempt.signal;
  }

  /** Starts a load: everything older is cancelled. */
  function begin(): LoadTicket {
    const mine = ++ticket;
    return { live: () => mine === ticket, signal: newAttempt() };
  }

  /** Cancels whatever is pending without loading anything. */
  function cancel() {
    ticket++;
    attempt?.abort();
    attempt = null;
  }

  /** Loads `item`; plays it when `autoplay` (else it waits, paused). */
  function load(item: LoadItem, autoplay: boolean) {
    const audio = d.audio();
    if (!audio) return;
    const t = begin();
    const src = d.fileUrl(item.path);
    if (d.bytesOnly()) {
      void viaBytes(item, src, "android: direct file URL skipped", true, autoplay, t);
      return;
    }
    // A failure to load or decode the file is otherwise silent: say so, with the media error code.
    audio.addEventListener(
      "error",
      () => {
        if (!t.live()) return;
        const code = audio.error?.code;
        const why = code === 1 ? "aborted" : code === 2 ? "network/read error" : code === 3 ? "decode error" : code === 4 ? "format not supported / file not reachable" : "unknown";
        d.setPlaying(false);
        d.setStatus(`Can't play "${item.label}": ${why}`);
      },
      { signal: t.signal },
    );
    audio.src = src;
    audio.load();
    if (!autoplay) {
      d.setPlaying(false);
      return;
    }
    // play() is called right inside the tap or click (a user gesture): phones refuse playback
    // started later from a callback. It waits for enough data, then starts.
    audio
      .play()
      .then(() => {
        if (t.live()) d.setPlaying(true);
      })
      .catch((e) => {
        if (!t.live()) return; // a newer song was chosen: never retry this one
        d.setPlaying(false);
        if (isInterrupted(e)) return; // paused before it started
        // The file URL was refused: pull the file through the same channel as a plain download.
        void viaBytes(item, src, String((e as Error)?.message || e), false, true, t);
      });
  }

  async function viaBytes(item: LoadItem, src: string, firstError: string, hostOnly: boolean, autoplay: boolean, t: LoadTicket) {
    const audio = d.audio();
    if (!audio) return;
    const signal = newAttempt();
    d.setStatus("Loading…");
    let size = 0;
    try {
      let buf: ArrayBuffer;
      if (hostOnly) {
        buf = await d.readBytes(item.path);
      } else {
        try {
          buf = await d.fetchBytes(src);
        } catch {
          if (!t.live()) return;
          // The file URL is not reachable from the page at all: ask the host for the bytes.
          buf = await d.readBytes(item.path);
        }
      }
      if (!t.live()) return; // a newer song was chosen while the bytes were read
      size = buf.byteLength;
      bytes.set(d.objectUrl(buf, mimeFor(item.path)));
      audio.addEventListener(
        "error",
        () => {
          if (!t.live()) return;
          d.setPlaying(false);
          d.setStatus(`Can't decode "${item.label}" (${(size / 1e6).toFixed(1)} MB, error ${audio.error?.code ?? "?"})`);
        },
        { signal },
      );
      audio.src = bytes.get();
      audio.load();
      if (!autoplay) {
        d.setPlaying(false);
        d.setStatus(`Ready (${(size / 1e6).toFixed(1)} MB)`);
        return;
      }
      await audio.play();
      if (!t.live()) return;
      d.setPlaying(true);
      d.setStatus(`Playing (${(size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      if (!t.live()) return;
      d.setPlaying(false);
      if (isInterrupted(e)) return;
      d.setStatus(`Can't play "${item.label}": ${(e as Error)?.message || e} · first: ${firstError}`);
    }
  }

  /** Stops, empties the element and lets go of the bytes it held. */
  function empty() {
    cancel();
    const audio = d.audio();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    bytes.clear();
  }

  return {
    load,
    begin,
    cancel,
    empty,
    /** Keeps `url` as the bytes of the playing song (a reload after a write). */
    holdBytes: (url: string) => bytes.set(url),
  };
}
