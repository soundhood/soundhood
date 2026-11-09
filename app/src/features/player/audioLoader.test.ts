// The audio loader (audioLoader.ts) on a fake <audio>: only the newest load plays (the race where a
// song chosen before the previous one started left the previous one playing), the bytes route and
// its fallbacks, object URLs let go of; and the playback clock (playbackClock.ts).
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { createLoader, createUrlSlot, isInterrupted, mimeFor, type AudioLike, type LoaderDeps } from "./audioLoader";
import { createClock } from "./playbackClock";

const abortError = () => Object.assign(new Error("The play() request was interrupted by a new load request."), { name: "AbortError" });

/** An <audio> whose play() waits until the test settles it; load() rejects a waiting play() as Chromium does. */
function fakeAudio() {
  const listeners: { type: string; fn: () => void; signal?: AbortSignal }[] = [];
  const plays: { resolve: () => void; reject: (e: unknown) => void; src: string }[] = [];
  let waiting: (typeof plays)[number] | null = null;
  const audio: AudioLike & { loads: string[]; fire: (type: string) => void } = {
    src: "",
    currentTime: 0,
    paused: true,
    error: null,
    loads: [],
    load() {
      this.loads.push(this.src);
      if (waiting) {
        const w = waiting;
        waiting = null;
        w.reject(abortError());
      }
    },
    play() {
      return new Promise<void>((resolve, reject) => {
        waiting = { resolve, reject, src: this.src };
        plays.push(waiting);
      });
    },
    pause() {},
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    },
    addEventListener(type, fn, opts) {
      listeners.push({ type, fn, signal: opts?.signal });
    },
    fire(type) {
      for (const l of listeners) if (l.type === type && !l.signal?.aborted) l.fn();
    },
  };
  return { audio, plays, settle: () => plays[plays.length - 1]?.resolve() };
}

function setup(over: Partial<LoaderDeps> = {}) {
  const { audio, plays } = fakeAudio();
  const log = { playing: [] as boolean[], status: [] as string[], fetched: [] as string[], read: [] as string[], made: [] as string[], revoked: [] as string[] };
  let n = 0;
  const deps: LoaderDeps = {
    audio: () => audio,
    bytesOnly: () => false,
    fileUrl: (p) => `asset://${p}`,
    readBytes: async (p) => {
      log.read.push(p);
      return new ArrayBuffer(2_000_000);
    },
    fetchBytes: async (u) => {
      log.fetched.push(u);
      return new ArrayBuffer(1_000_000);
    },
    objectUrl: () => {
      const u = `blob:${++n}`;
      log.made.push(u);
      return u;
    },
    revokeUrl: (u) => log.revoked.push(u),
    setPlaying: (p) => log.playing.push(p),
    setStatus: (s) => log.status.push(s),
    ...over,
  };
  return { loader: createLoader(deps), audio, plays, log };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("only the newest load plays", () => {
  it("a song chosen before the previous one started: the previous one is not retried", async () => {
    const { loader, audio, plays, log } = setup();
    loader.load({ path: "old.mp3", label: "Old" }, true);
    loader.load({ path: "new.mp3", label: "New" }, true);
    await flush();
    // The old play() was rejected by the new load; nothing went to fetch the old file's bytes.
    expect(log.fetched).toEqual([]);
    expect(log.read).toEqual([]);
    plays[1].resolve();
    await flush();
    expect(audio.src).toBe("asset://new.mp3");
    expect(log.playing).toEqual([true]);
  });

  it("an old load's error listener stays quiet after a newer load", async () => {
    const { loader, audio, log } = setup();
    loader.load({ path: "old.mp3", label: "Old" }, true);
    loader.load({ path: "new.mp3", label: "New" }, true);
    (audio as unknown as { error: { code: number } }).error = { code: 4 };
    audio.fire("error");
    expect(log.status.filter((s) => s.includes("Old"))).toEqual([]);
    expect(log.status[log.status.length - 1]).toBe('Can\'t play "New": format not supported / file not reachable');
  });

  it("bytes read for an older song never reach the element", async () => {
    let release: (b: ArrayBuffer) => void = () => {};
    const { loader, audio, log } = setup({
      bytesOnly: () => true,
      readBytes: (p) =>
        new Promise((r) => {
          if (p === "old.mp3") release = r;
          else r(new ArrayBuffer(10));
        }),
    });
    loader.load({ path: "old.mp3", label: "Old" }, true);
    loader.load({ path: "new.mp3", label: "New" }, true);
    await flush();
    release(new ArrayBuffer(10));
    await flush();
    expect(log.made).toEqual(["blob:1"]);
    expect(audio.src).toBe("blob:1");
  });

  it("cancel() stops a pending load from acting", async () => {
    const { loader, plays, log } = setup();
    loader.load({ path: "a.mp3", label: "A" }, true);
    loader.cancel();
    plays[0].resolve();
    await flush();
    expect(log.playing).toEqual([]);
  });
});

describe("the routes", () => {
  it("a refused file URL is played from its bytes, fetched first, then from the host", async () => {
    const { loader, audio, plays, log } = setup({
      fetchBytes: async () => {
        throw new Error("blocked");
      },
    });
    loader.load({ path: "a.mp3", label: "A" }, true);
    plays[0].reject(Object.assign(new Error("no"), { name: "NotSupportedError" }));
    await flush();
    await flush();
    expect(log.read).toEqual(["a.mp3"]);
    expect(audio.src).toBe("blob:1");
    plays[1].resolve();
    await flush();
    expect(log.status[log.status.length - 1]).toBe("Playing (2.0 MB)");
  });

  it("a play() interrupted by a pause is not a refusal", async () => {
    const { loader, plays, log } = setup();
    loader.load({ path: "a.mp3", label: "A" }, true);
    plays[0].reject(abortError());
    await flush();
    expect(log.fetched).toEqual([]);
    expect(log.playing).toEqual([false]);
  });

  it("without autoplay the song is loaded and waits", () => {
    const { loader, audio, plays, log } = setup();
    loader.load({ path: "a.mp3", label: "A" }, false);
    expect(audio.src).toBe("asset://a.mp3");
    expect(plays).toEqual([]);
    expect(log.playing).toEqual([false]);
  });

  it("the phone reads the bytes from the host straight away and lets go of the last song's", async () => {
    const { loader, plays, log } = setup({ bytesOnly: () => true });
    loader.load({ path: "a.mp3", label: "A" }, true);
    await flush();
    plays[0].resolve();
    await flush();
    loader.load({ path: "b.mp3", label: "B" }, true);
    await flush();
    expect(log.read).toEqual(["a.mp3", "b.mp3"]);
    expect(log.revoked).toEqual(["blob:1"]);
    loader.empty();
    expect(log.revoked).toEqual(["blob:1", "blob:2"]);
  });

  it("names the file types", () => {
    expect(mimeFor("x.M4A")).toBe("audio/mp4");
    expect(mimeFor("x.opus")).toBe("audio/ogg");
    expect(mimeFor("x")).toBe("audio/*");
    expect(isInterrupted(abortError())).toBe(true);
    expect(isInterrupted(new Error("x"))).toBe(false);
  });
});

describe("object URL slot", () => {
  it("lets go of the old URL when a new one arrives, and of the last one when cleared", () => {
    const revoked: string[] = [];
    const slot = createUrlSlot((u) => revoked.push(u));
    slot.set("blob:a");
    slot.set("blob:a");
    slot.set("blob:b");
    expect(revoked).toEqual(["blob:a"]);
    slot.clear();
    slot.clear();
    expect(revoked).toEqual(["blob:a", "blob:b"]);
    expect(slot.get()).toBe("");
  });
});

describe("playback clock", () => {
  it("tells its listeners about a change, once, and not about the same values", () => {
    const clock = createClock();
    let calls = 0;
    const stop = clock.subscribe(() => calls++);
    clock.set({ duration: 3 });
    clock.set({ position: 1.5 });
    clock.set({ position: 1.5, duration: 3 });
    expect(calls).toBe(2);
    expect(clock.get()).toEqual({ position: 1.5, duration: 3 });
    const snapshot = clock.get();
    expect(clock.get()).toBe(snapshot);
    stop();
    clock.set({ position: 2 });
    expect(calls).toBe(2);
  });
});
