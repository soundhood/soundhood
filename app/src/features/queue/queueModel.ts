// The play queue as plain data and pure functions (no React; queueModel.test.ts). The player hook
// (hooks/usePlayer.ts) keeps one QueueState and asks these functions what plays next.
//
// The queue is three runs of songs around the one playing:
//   past   the songs played before it, oldest first (Previous walks back through them);
//   next   "Next in queue": songs added with Play next or Add to queue; they play first;
//   rest   "Next from <source>": the rest of the list the song was started from.
// `source` keeps that list in its own order (a copy the queue owns, shuffled or not), so Repeat all
// can start it again and turning Shuffle off can put the rest back in order.
//
// Decisions (Musicolet keeps the queue first-class; the sections follow DESIGN.md's Queue):
// - Starting a song from a list seeds `source` and `rest` with that list (shuffled with the song
//   first when Shuffle is on) and keeps "Next in queue": songs the user added still play next.
// - Play next puts songs at the top of "Next in queue"; Add to queue at its end. Both play before
//   the rest of the source.
// - Next: the first of "Next in queue", else the next of the source. At the end, Repeat all starts
//   the source again (reshuffled when Shuffle is on); Repeat off loads the first song and stops.
// - The end of a song with Repeat one plays it again; Next and Previous still move.
// - Previous goes back one song (the player restarts the song instead when it is past 3 s).
// - Tapping a song further down the queue skips the ones above it in its section (they go to the
//   past, so Previous reaches them).
// - Clear empties everything after the playing song; the playing song plays on.
// - The queue lives in memory only: it starts empty when the app starts (Phase 3 keeps it).
export type RepeatMode = "off" | "all" | "one";

/** The two sections the queue shows under "Now playing". */
export type QueueSectionId = "next" | "rest";

export interface QueueEntry {
  /** Unique within the queue: rows are keyed by it, and the same song may be queued twice. */
  id: number;
  path: string;
  /** "queue": added with Play next or Add to queue; "source": from the list it was started from. */
  from: "queue" | "source";
}

export interface QueueState {
  now: QueueEntry | null;
  next: readonly QueueEntry[];
  rest: readonly QueueEntry[];
  past: readonly QueueEntry[];
  source: readonly QueueEntry[];
  /** The id of the newest source song played (where the source resumes when Shuffle goes off). */
  cursor: number | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** The next free id. */
  seq: number;
}

/** What a move through the queue asks the player to do. */
export interface Step {
  state: QueueState;
  /** The song to load (the same entry as before: play it again from the start); null: nothing. */
  entry: QueueEntry | null;
  /** Start playing it (false: load it and stay paused, e.g. at the end with Repeat off). */
  play: boolean;
}

/** A removed row, kept so a toast's Undo can put it back where it was. */
export interface Removed {
  section: QueueSectionId;
  index: number;
  entry: QueueEntry;
  /** Where it sat in `source` (-1: not there). */
  sourceIndex: number;
}

/** A random number in [0, 1); Math.random in the app, a seeded one in tests. */
export type Rng = () => number;

/** How many played songs Previous can walk back through. */
const PAST_LIMIT = 500;

export function emptyQueue(repeat: RepeatMode = "all", shuffle = false): QueueState {
  return { now: null, next: [], rest: [], past: [], source: [], cursor: null, shuffle, repeat, seq: 1 };
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function entries(q: QueueState, paths: readonly string[], from: QueueEntry["from"]): { list: QueueEntry[]; seq: number } {
  let seq = q.seq;
  return { list: paths.map((path) => ({ id: seq++, path, from })), seq };
}

const pastWith = (past: readonly QueueEntry[], ...more: (QueueEntry | null)[]) =>
  [...past, ...more.filter((e): e is QueueEntry => !!e)].slice(-PAST_LIMIT);

/** The newest source song among the past and the playing one. */
function cursorOf(past: readonly QueueEntry[], now: QueueEntry | null): number | null {
  if (now?.from === "source") return now.id;
  for (let i = past.length - 1; i >= 0; i--) if (past[i].from === "source") return past[i].id;
  return null;
}

/**
 * Starts the list `paths` at `start` (-1: the first song, or a random one with Shuffle on). With
 * Shuffle the rest is shuffled; without it the songs above the start become the past, so Previous
 * steps up the list. "Next in queue" is kept.
 */
export function seed(q: QueueState, paths: readonly string[], start: number, shuffle: boolean, rng: Rng): Step {
  const { list, seq } = entries(q, paths, "source");
  if (list.length === 0) return { state: { ...q, shuffle }, entry: null, play: false };
  const at = start >= 0 && start < list.length ? start : shuffle ? Math.floor(rng() * list.length) : 0;
  const now = list[at];
  const others = list.filter((_, i) => i !== at);
  const state: QueueState = {
    ...q,
    seq,
    shuffle,
    source: list,
    now,
    cursor: now.id,
    past: shuffle ? [] : list.slice(0, at),
    rest: shuffle ? shuffled(others, rng) : list.slice(at + 1),
  };
  return { state, entry: now, play: true };
}

/**
 * Moves on one song. `auto`: the song ended by itself (Repeat one plays it again); otherwise the
 * user pressed Next.
 */
export function advance(q: QueueState, auto: boolean, rng: Rng): Step {
  if (auto && q.repeat === "one" && q.now) return { state: q, entry: q.now, play: true };
  if (q.next.length > 0) {
    const [now, ...next] = q.next;
    return { state: { ...q, now, next, past: pastWith(q.past, q.now) }, entry: now, play: true };
  }
  if (q.rest.length > 0) {
    const [now, ...rest] = q.rest;
    return { state: { ...q, now, rest, past: pastWith(q.past, q.now), cursor: now.id }, entry: now, play: true };
  }
  if (q.source.length === 0) return { state: q, entry: null, play: false };
  // The end of the source: start it again; with Repeat off the first song waits, paused.
  const order = q.shuffle ? shuffled(q.source, rng) : [...q.source];
  const [now, ...rest] = order;
  return { state: { ...q, now, rest, past: [], cursor: now.id }, entry: now, play: q.repeat !== "off" };
}

/** Back one song; with nothing before it, the same song again (from the start). */
export function back(q: QueueState): Step {
  if (q.past.length === 0 || !q.now) return { state: q, entry: q.now, play: true };
  const prev = q.past[q.past.length - 1];
  const past = q.past.slice(0, -1);
  const cur = q.now;
  const state: QueueState = {
    ...q,
    now: prev,
    past,
    next: cur.from === "queue" ? [cur, ...q.next] : q.next,
    rest: cur.from === "source" ? [cur, ...q.rest] : q.rest,
    cursor: cursorOf(past, prev),
  };
  return { state, entry: prev, play: true };
}

/** Plays the row `index` of a section; the rows above it in that section go to the past. */
export function jump(q: QueueState, section: QueueSectionId, index: number): Step {
  const rows = q[section];
  const target = rows[index];
  if (!target) return { state: q, entry: null, play: false };
  const past = pastWith(q.past, q.now, ...rows.slice(0, index));
  const state: QueueState = { ...q, now: target, past, [section]: rows.slice(index + 1), cursor: cursorOf(past, target) };
  return { state, entry: target, play: true };
}

/** Play next: the songs go to the top of "Next in queue", in the order given. */
export function playNext(q: QueueState, paths: readonly string[]): QueueState {
  const { list, seq } = entries(q, paths, "queue");
  return { ...q, seq, next: [...list, ...q.next] };
}

/** Add to queue: the songs go to the end of "Next in queue", before the rest of the source. */
export function addToQueue(q: QueueState, paths: readonly string[]): QueueState {
  const { list, seq } = entries(q, paths, "queue");
  return { ...q, seq, next: [...q.next, ...list] };
}

/** `source` with the rest's songs in the rest's order (the other songs keep their places). */
function sourceFollowingRest(source: readonly QueueEntry[], rest: readonly QueueEntry[]): QueueEntry[] {
  const ids = new Set(rest.map((e) => e.id));
  const slots = source.flatMap((e, i) => (ids.has(e.id) ? [i] : []));
  const out = [...source];
  slots.forEach((slot, k) => (out[slot] = rest[k]));
  return out;
}

/** Reorders a section. Without Shuffle the source follows, so Repeat all keeps the new order. */
export function move(q: QueueState, section: QueueSectionId, from: number, to: number): QueueState {
  const rows = [...q[section]];
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return q;
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  const next = { ...q, [section]: rows };
  if (section === "rest" && !q.shuffle) next.source = sourceFollowingRest(q.source, rows);
  return next;
}

/** Takes one row out (out of the source too, so Repeat all does not bring it back). */
export function remove(q: QueueState, section: QueueSectionId, index: number): { state: QueueState; removed: Removed | null } {
  const entry = q[section][index];
  if (!entry) return { state: q, removed: null };
  const sourceIndex = q.source.findIndex((e) => e.id === entry.id);
  const state: QueueState = {
    ...q,
    [section]: q[section].filter((_, i) => i !== index),
    source: sourceIndex >= 0 ? q.source.filter((_, i) => i !== sourceIndex) : q.source,
  };
  return { state, removed: { section, index, entry, sourceIndex } };
}

/** Puts a removed row back where it was (or as near as the queue now allows). */
export function restore(q: QueueState, r: Removed): QueueState {
  if (q.now?.id === r.entry.id || q[r.section].some((e) => e.id === r.entry.id)) return q;
  const rows = [...q[r.section]];
  rows.splice(Math.min(r.index, rows.length), 0, r.entry);
  const source = [...q.source];
  if (r.sourceIndex >= 0 && !source.some((e) => e.id === r.entry.id)) source.splice(Math.min(r.sourceIndex, source.length), 0, r.entry);
  return { ...q, [r.section]: rows, source };
}

/** Takes every upcoming row of these songs out of the queue; the playing song stays. */
export function removePaths(q: QueueState, paths: ReadonlySet<string>): QueueState {
  const keep = (e: QueueEntry) => !paths.has(e.path);
  return { ...q, next: q.next.filter(keep), rest: q.rest.filter(keep), source: q.source.filter((e) => e.id === q.now?.id || keep(e)) };
}

/** Empties the queue after the playing song. */
export function clear(q: QueueState): QueueState {
  return { ...q, next: [], rest: [], past: [], source: [], cursor: null };
}

/** Shuffle on: the rest of the source in a random order. Off: the source again, from where it is. */
export function setShuffle(q: QueueState, on: boolean, rng: Rng): QueueState {
  if (on === q.shuffle) return q;
  if (on) return { ...q, shuffle: true, rest: shuffled(q.rest, rng) };
  const at = q.cursor === null ? -1 : q.source.findIndex((e) => e.id === q.cursor);
  return { ...q, shuffle: false, rest: q.source.slice(at + 1).filter((e) => e.id !== q.now?.id) };
}

/** Repeat: off, then all, then one, then off again. */
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

/** A song's file moved or was renamed: every row of it follows. */
export function remapPath(q: QueueState, from: string, to: string): QueueState {
  if (!from || from === to) return q;
  const fix = (e: QueueEntry) => (e.path === from ? { ...e, path: to } : e);
  const all = (list: readonly QueueEntry[]) => (list.some((e) => e.path === from) ? list.map(fix) : list);
  return { ...q, now: q.now && fix(q.now), next: all(q.next), rest: all(q.rest), past: all(q.past), source: all(q.source) };
}

/** Drops the rows whose file is gone from the library (the playing song is the player's to stop). */
export function prune(q: QueueState, exists: (path: string) => boolean): QueueState {
  const gone = (list: readonly QueueEntry[]) => list.some((e) => !exists(e.path));
  if (!gone(q.next) && !gone(q.rest) && !gone(q.past) && !gone(q.source)) return q;
  const keep = (list: readonly QueueEntry[]) => list.filter((e) => e.id === q.now?.id || exists(e.path));
  return { ...q, next: keep(q.next), rest: keep(q.rest), past: keep(q.past), source: keep(q.source) };
}

/** Nothing plays: the queue forgets the playing song (what comes after it stays). */
export function stopNow(q: QueueState): QueueState {
  return q.now ? { ...q, now: null, past: pastWith(q.past, q.now) } : q;
}

/** The playing song and everything after it, in play order (Save as playlist). */
export function queuedPaths(q: QueueState): string[] {
  return [...(q.now ? [q.now] : []), ...q.next, ...q.rest].map((e) => e.path);
}

/** Songs after the playing one. */
export function upcomingCount(q: QueueState): number {
  return q.next.length + q.rest.length;
}
