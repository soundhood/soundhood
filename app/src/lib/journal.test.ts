// The journal (journal.ts): one write at a time, each with the report its own command sent, whether
// that report reaches the page before the command's reply or after it.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import type { BatchReport } from "../coreIpc";
import { BATCH_EVENT, FLUSH_EVENT, createJournal, type JournalHost } from "./journal";

const report = (batch: string): BatchReport => ({ batch, applied: [{ label: `change ${batch}` }], skipped: [], failed: [], aborted: false });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A host whose events reach the page in the order it emitted them, each a macrotask later (as
 * events do), and whose replies come back first unless a command says otherwise. `commands[cmd]`
 * runs when the command does: it may emit, throw, or hold its reply.
 */
function fakeHost(commands: Record<string, (h: { emit: (event: string, payload: unknown) => void }) => unknown>) {
  const listeners = new Map<string, ((e: { payload: unknown }) => void)[]>();
  const queue: [string, unknown][] = [];
  let draining = false;
  // Held: events wait (the host's event path is busy) while replies keep coming back.
  let held = false;
  const deliver = () => {
    if (draining || held) return;
    draining = true;
    setTimeout(() => {
      draining = false;
      if (held) return;
      const [event, payload] = queue.shift() ?? [];
      if (event) for (const l of listeners.get(event) ?? []) l({ payload });
      if (queue.length) deliver();
    }, 0);
  };
  const hostEmit = (event: string, payload: unknown) => {
    queue.push([event, payload]);
    deliver();
  };
  const calls: string[] = [];
  const host: JournalHost = {
    invoke: async <T,>(cmd: string): Promise<T> => {
      calls.push(cmd);
      return (await commands[cmd]({ emit: hostEmit })) as T;
    },
    listen: async (event, handler) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler as (e: { payload: unknown }) => void]);
    },
    // The page's own emit goes to the host and comes back like any event, after those before it.
    emit: async (event, payload) => hostEmit(event, payload),
  };
  const hold = () => void (held = true);
  const release = () => {
    held = false;
    deliver();
  };
  return { host, calls, hostEmit, hold, release };
}

describe("the journal", () => {
  it("takes the command's report when it arrives after the reply", async () => {
    const { host } = fakeHost({ write_tags: (h) => (h.emit(BATCH_EVENT, report("b1")), "track") });
    const w = await createJournal(host).write<string>("write_tags", {});
    expect(w).toEqual({ value: "track", report: report("b1"), sure: true });
  });

  it("answers null for a command that changed nothing", async () => {
    const { host } = fakeHost({ playlist_add: () => "playlist" });
    expect(await createJournal(host).write("playlist_add", {})).toEqual({ value: "playlist", report: null, sure: true });
  });

  it("runs writes one at a time, so a report belongs to the write that sent it", async () => {
    let release: () => void = () => {};
    const { host, calls } = fakeHost({
      move_track: async (h) => {
        await new Promise<void>((resolve) => (release = resolve));
        h.emit(BATCH_EVENT, report("move"));
        return "moved";
      },
      playlist_add: (h) => (h.emit(BATCH_EVENT, report("add")), "added"),
    });
    const journal = createJournal(host);
    const first = journal.write("move_track", {});
    const second = journal.write("playlist_add", {});
    await tick();
    await tick();
    expect(calls).toEqual(["move_track"]); // the add waits for the move
    release();
    expect((await first).report?.batch).toBe("move");
    expect((await second).report?.batch).toBe("add");
    expect(calls).toEqual(["move_track", "playlist_add"]);
  });

  it("rethrows a refusal, and a report it sent is not the next write's", async () => {
    const { host } = fakeHost({
      playlists_from_folders: (h) => {
        h.emit(BATCH_EVENT, report("partial"));
        throw "file in use";
      },
      playlist_remove: () => "removed",
    });
    const journal = createJournal(host);
    await expect(journal.write("playlists_from_folders", {})).rejects.toBe("file in use");
    expect(await journal.write("playlist_remove", {})).toEqual({ value: "removed", report: null, sure: true });
  });

  it("is not sure when the host's events stop coming back", async () => {
    const { host } = fakeHost({ delete_track: () => null });
    const silent: JournalHost = { ...host, emit: async () => {} };
    expect(await createJournal(silent, 20).write("delete_track", {})).toEqual({ value: null, report: null, sure: false });
  });

  it("hands back no report when it is not sure, even one that arrived", async () => {
    const { host } = fakeHost({ write_tags: (h) => (h.emit(BATCH_EVENT, report("b1")), "track") });
    // The report comes through; the marker never does.
    const markerLost: JournalHost = { ...host, emit: async () => {} };
    expect(await createJournal(markerLost, 20).write("write_tags", {})).toEqual({ value: "track", report: null, sure: false });
  });

  it("never takes a late report of a write whose marker timed out for the next write's", async () => {
    // Review round 2 (journal-late): the tag save's report is held past the timeout, then arrives
    // while a playlist add that changed nothing runs.
    const { host, hold, release } = fakeHost({
      write_tags: (h) => (h.emit(BATCH_EVENT, report("tag-edit")), "track"),
      playlist_add: () => "playlist",
    });
    // Long enough for a marker to come back once events flow (each is a macrotask, ~15 ms on Windows).
    const journal = createJournal(host, 400);
    hold();
    expect(await journal.write("write_tags", {})).toEqual({ value: "track", report: null, sure: false });
    const add = journal.write("playlist_add", {});
    setTimeout(release, 5);
    expect(await add).toEqual({ value: "playlist", report: null, sure: true });
  });

  it("is not sure of any write until the host's events have caught up", async () => {
    const { host, calls, hold, release } = fakeHost({
      write_tags: (h) => (h.emit(BATCH_EVENT, report("t1")), "t"),
      move_track: (h) => (h.emit(BATCH_EVENT, report("m1")), "m"),
      delete_track: (h) => (h.emit(BATCH_EVENT, report("d1")), null),
    });
    const journal = createJournal(host, 400);
    hold();
    expect(await journal.write("write_tags", {})).toEqual({ value: "t", report: null, sure: false });
    // Still held: the fence before the move times out too; the move runs, without a report.
    expect(await journal.write("move_track", {})).toEqual({ value: "m", report: null, sure: false });
    release();
    // Caught up: the late reports are dropped at the fence, and the delete has its own.
    expect(await journal.write("delete_track", {})).toEqual({ value: null, report: report("d1"), sure: true });
    expect(calls).toEqual(["write_tags", "move_track", "delete_track"]);
  });

  it("listens once, for the reports and its own marker", async () => {
    const heard: string[] = [];
    const { host } = fakeHost({ write_tags: () => "t" });
    const journal = createJournal({ ...host, listen: (event, handler) => (heard.push(event), host.listen(event, handler)) });
    await journal.write("write_tags", {});
    await journal.write("write_tags", {});
    expect(heard).toEqual([BATCH_EVENT, FLUSH_EVENT]);
  });
});
