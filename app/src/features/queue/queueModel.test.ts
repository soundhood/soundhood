// The queue model (queueModel.ts): seeding from a list, Next and Previous, Play next and Add to
// queue, jumping, moving, removing and putting back, Shuffle and Repeat, and following a moved file.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import {
  addToQueue,
  advance,
  back,
  clear,
  emptyQueue,
  jump,
  move,
  nextRepeat,
  playNext,
  prune,
  queuedPaths,
  remapPath,
  remove,
  removePaths,
  restore,
  seed,
  setShuffle,
  shuffled,
  stopNow,
  type QueueState,
} from "./queueModel";

/** A repeatable random sequence. */
function rng(seedValue = 7): () => number {
  let s = seedValue;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const LIST = ["a", "b", "c", "d", "e"];
const paths = (list: readonly { path: string }[]) => list.map((e) => e.path);
const now = (q: QueueState) => q.now?.path ?? null;

/** Starts LIST at `start`, Shuffle off, Repeat all. */
function started(start = 0, q = emptyQueue()): QueueState {
  return seed(q, LIST, start, false, rng()).state;
}

/** Presses Next `n` times. */
function nextTimes(q: QueueState, n: number): QueueState {
  for (let i = 0; i < n; i++) q = advance(q, false, rng()).state;
  return q;
}

describe("seeding from a list", () => {
  it("plays the chosen song; the songs below it come next and the ones above are behind it", () => {
    const q = started(2);
    expect(now(q)).toBe("c");
    expect(paths(q.rest)).toEqual(["d", "e"]);
    expect(paths(q.past)).toEqual(["a", "b"]);
    expect(q.next).toEqual([]);
  });

  it("with Shuffle on: the chosen song first, every other song once, in a random order", () => {
    const step = seed(emptyQueue(), LIST, 1, true, rng());
    expect(step.entry?.path).toBe("b");
    expect(step.play).toBe(true);
    expect([...paths(step.state.rest)].sort()).toEqual(["a", "c", "d", "e"]);
    expect(step.state.past).toEqual([]);
  });

  it("with no song chosen: the first, or a random one with Shuffle on", () => {
    expect(now(seed(emptyQueue(), LIST, -1, false, rng()).state)).toBe("a");
    expect(LIST).toContain(now(seed(emptyQueue(), LIST, -1, true, rng()).state));
  });

  it("an empty list plays nothing", () => {
    expect(seed(emptyQueue(), [], 0, false, rng()).entry).toBeNull();
  });

  it("keeps the songs added with Play next", () => {
    const q = seed(playNext(started(0), ["x"]), ["p", "q"], 0, false, rng()).state;
    expect(now(q)).toBe("p");
    expect(paths(q.next)).toEqual(["x"]);
    expect(paths(q.rest)).toEqual(["q"]);
  });

  it("gives every row its own id, the same song twice included", () => {
    const q = addToQueue(seed(emptyQueue(), ["a", "a", "b"], 0, false, rng()).state, ["a"]);
    const ids = [q.now, ...q.next, ...q.rest, ...q.past].map((e) => e?.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Next", () => {
  it("follows the list", () => {
    let q = started(0);
    q = advance(q, false, rng()).state;
    expect(now(q)).toBe("b");
    expect(paths(q.past)).toEqual(["a"]);
  });

  it("plays what was added before the rest of the list: Play next first, Add to queue after", () => {
    let q = started(0);
    q = addToQueue(q, ["y"]);
    q = playNext(q, ["x"]);
    q = addToQueue(q, ["z"]);
    expect(paths(q.next)).toEqual(["x", "y", "z"]);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      q = advance(q, false, rng()).state;
      order.push(now(q) as string);
    }
    expect(order).toEqual(["x", "y", "z", "b", "c"]);
  });

  it("Repeat all: after the last song the list starts again, playing", () => {
    const step = advance(started(4), true, rng());
    expect(step.entry?.path).toBe("a");
    expect(step.play).toBe(true);
    expect(paths(step.state.rest)).toEqual(["b", "c", "d", "e"]);
  });

  it("Repeat off: after the last song the first one is loaded and waits", () => {
    const q = { ...started(4), repeat: "off" as const };
    const step = advance(q, true, rng());
    expect(step.entry?.path).toBe("a");
    expect(step.play).toBe(false);
  });

  it("Repeat one: the end of a song plays it again; Next still moves on", () => {
    const q = { ...started(1), repeat: "one" as const };
    const again = advance(q, true, rng());
    expect(again.entry).toBe(q.now);
    expect(again.state).toBe(q);
    expect(now(advance(q, false, rng()).state)).toBe("c");
  });

  it("an empty queue after Clear: nothing more plays", () => {
    const step = advance(clear(started(1)), true, rng());
    expect(step.entry).toBeNull();
    expect(step.play).toBe(false);
  });

  it("Shuffle with Repeat all reshuffles the list for the next round", () => {
    let q = seed(emptyQueue(), LIST, 0, true, rng(3)).state;
    q = nextTimes(q, 4);
    const step = advance(q, false, rng(11));
    expect([step.entry?.path, ...paths(step.state.rest)].sort()).toEqual(LIST);
  });
});

describe("Previous", () => {
  it("goes back one song and puts the current one back in front of the rest", () => {
    const q = back(started(2)).state;
    expect(now(q)).toBe("b");
    expect(paths(q.rest)).toEqual(["c", "d", "e"]);
    expect(paths(q.past)).toEqual(["a"]);
  });

  it("a song added to the queue goes back to the top of Next in queue", () => {
    let q = playNext(started(0), ["x"]);
    q = advance(q, false, rng()).state;
    expect(now(q)).toBe("x");
    q = back(q).state;
    expect(now(q)).toBe("a");
    expect(paths(q.next)).toEqual(["x"]);
  });

  it("with nothing before it: the same song again", () => {
    const q = started(0);
    const step = back(q);
    expect(step.entry).toBe(q.now);
    expect(step.state).toBe(q);
  });
});

describe("jumping to a row", () => {
  it("skips the rows above it in its section; Previous reaches them", () => {
    let q = jump(started(0), "rest", 2).state;
    expect(now(q)).toBe("d");
    expect(paths(q.rest)).toEqual(["e"]);
    expect(paths(q.past)).toEqual(["a", "b", "c"]);
    q = back(q).state;
    expect(now(q)).toBe("c");
  });

  it("in Next in queue, keeps the rest of the source as it was", () => {
    const q = jump(addToQueue(started(0), ["x", "y"]), "next", 1).state;
    expect(now(q)).toBe("y");
    expect(q.next).toEqual([]);
    expect(paths(q.rest)).toEqual(["b", "c", "d", "e"]);
  });

  it("a row that is not there changes nothing", () => {
    const q = started(0);
    expect(jump(q, "next", 3).entry).toBeNull();
  });
});

describe("moving, removing, clearing", () => {
  it("moves a row within its section; without Shuffle the list's own order follows", () => {
    let q = move(started(0), "rest", 0, 2);
    expect(paths(q.rest)).toEqual(["c", "d", "b", "e"]);
    q = nextTimes(q, 4);
    // Repeat all: the next round keeps the new order.
    q = advance(q, false, rng()).state;
    expect([now(q), ...paths(q.rest)]).toEqual(["a", "c", "d", "b", "e"]);
  });

  it("ignores a move out of range", () => {
    const q = started(0);
    expect(move(q, "next", 0, 1)).toBe(q);
  });

  it("removes a row, also from the list Repeat all starts again; Undo puts it back", () => {
    const q = started(0);
    const { state, removed } = remove(q, "rest", 1);
    expect(paths(state.rest)).toEqual(["b", "d", "e"]);
    expect(paths(state.source)).toEqual(["a", "b", "d", "e"]);
    const back2 = restore(state, removed!);
    expect(paths(back2.rest)).toEqual(["b", "c", "d", "e"]);
    expect(paths(back2.source)).toEqual(LIST);
    // Twice changes nothing more.
    expect(restore(back2, removed!)).toBe(back2);
  });

  it("removes every upcoming row of some songs; the playing one stays", () => {
    const q = removePaths(addToQueue(started(0), ["c", "a"]), new Set(["a", "c"]));
    expect(now(q)).toBe("a");
    expect(q.next).toEqual([]);
    expect(paths(q.rest)).toEqual(["b", "d", "e"]);
  });

  it("Clear empties everything after the playing song", () => {
    const q = clear(addToQueue(started(2), ["x"]));
    expect(now(q)).toBe("c");
    expect(q.next).toEqual([]);
    expect(q.rest).toEqual([]);
    expect(q.past).toEqual([]);
    expect(queuedPaths(q)).toEqual(["c"]);
  });

  it("lists the playing song and what follows, in play order", () => {
    expect(queuedPaths(playNext(started(3), ["x"]))).toEqual(["d", "x", "e"]);
  });
});

describe("Shuffle and Repeat", () => {
  it("Shuffle on mixes the rest; off puts the list back in order after the playing song", () => {
    let q = started(1);
    q = setShuffle(q, true, rng(5));
    expect([...paths(q.rest)].sort()).toEqual(["c", "d", "e"]);
    q = setShuffle(q, false, rng());
    expect(paths(q.rest)).toEqual(["c", "d", "e"]);
    expect(q.shuffle).toBe(false);
  });

  it("Shuffle off while a queued song plays resumes the list after the last song from it", () => {
    let q = seed(emptyQueue(), LIST, 0, true, rng(2)).state;
    const first = now(q);
    q = playNext(q, ["x"]);
    q = advance(q, false, rng()).state;
    q = setShuffle(q, false, rng());
    expect(paths(q.rest)).toEqual(LIST.slice(LIST.indexOf(first as string) + 1));
  });

  it("the same Shuffle again changes nothing", () => {
    const q = started(0);
    expect(setShuffle(q, false, rng())).toBe(q);
  });

  it("Repeat cycles off, all, one", () => {
    expect(nextRepeat("off")).toBe("all");
    expect(nextRepeat("all")).toBe("one");
    expect(nextRepeat("one")).toBe("off");
  });

  it("shuffles every item once", () => {
    expect([...shuffled(LIST, rng())].sort()).toEqual(LIST);
  });
});

describe("following the library", () => {
  it("a moved file: every row of it follows", () => {
    const q = remapPath(addToQueue(started(0), ["a"]), "a", "moved/a");
    expect(now(q)).toBe("moved/a");
    expect(paths(q.next)).toEqual(["moved/a"]);
    expect(paths(q.source)[0]).toBe("moved/a");
  });

  it("a deleted file leaves the queue; the playing song is left to the player", () => {
    const q = prune(started(0), (p) => p !== "c" && p !== "a");
    expect(now(q)).toBe("a");
    expect(paths(q.rest)).toEqual(["b", "d", "e"]);
  });

  it("nothing gone: the same queue", () => {
    const q = started(0);
    expect(prune(q, () => true)).toBe(q);
  });

  it("stopping forgets the playing song but keeps what comes next", () => {
    const q = stopNow(started(1));
    expect(q.now).toBeNull();
    expect(paths(q.rest)).toEqual(["c", "d", "e"]);
    expect(now(advance(q, false, rng()).state)).toBe("c");
  });
});
