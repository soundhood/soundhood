// The one way the UI runs a journaled write (core/CONTRACT.md, "Host IPC"): one at a time, each with
// the report its own command sent, so an Undo always names its own change by id (undo_batch).
//
// The host emits `core:batch` with a command's BatchReport before the command returns, and only when
// the command changed something; a write that was already in effect (same tags, already a member, a
// playlist that exists) sends nothing. Events and command replies reach the page on separate
// channels, so the report may arrive after the reply. Once the reply is in, a marker event goes to
// the host and back (`soundhood:flush`): the host delivers events in the order it emitted them, so
// when the marker is back the command's own report has arrived, if it sent one. Writes run one at a
// time, so a report that arrives while a write runs is that write's.
//
// When the marker does not come back in time, a report of that write may still be on its way. The
// next write then first sends another marker and waits for it with no write running, so a late
// report is dropped there and never taken for the next write's; until a marker comes back, no write
// is sure of its report. A write that is not sure hands back no report, so it never offers an Undo.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import type { BatchReport } from "../coreIpc";

/** What a journaled write returned, and the report it sent. */
export type Written<T> = {
  value: T;
  /** The command's own report; null when it changed nothing, and always null when `sure` is false. */
  report: BatchReport | null;
  /**
   * False when a marker did not come back in time (after this write, or before it, after an earlier
   * write's timeout): which report is this write's is not known.
   */
  sure: boolean;
};

/** The calls the journal needs (the Tauri API in the app; fakes in the tests). */
export type JournalHost = {
  invoke: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<unknown>;
  emit: (event: string, payload: unknown) => Promise<void>;
};

export const BATCH_EVENT = "core:batch";
export const FLUSH_EVENT = "soundhood:flush";

/** A journal over `host`: `write` runs one journaled command at a time. */
export function createJournal(host: JournalHost, flushMs = 5000) {
  let tail: Promise<unknown> = Promise.resolve();
  let ready: Promise<unknown> | null = null;
  // The reports of the write that runs now; null between writes.
  let current: BatchReport[] | null = null;
  const markers = new Map<string, () => void>();
  let seq = 0;
  // A marker did not come back in time: the host's events may still hold an earlier write's report.
  let behind = false;

  function listenOnce() {
    ready ??= Promise.all([
      host.listen<BatchReport>(BATCH_EVENT, (e) => {
        if (current && e.payload) current.push(e.payload);
      }),
      host.listen<string>(FLUSH_EVENT, (e) => markers.get(e.payload)?.()),
    ]);
    return ready;
  }

  /** True once every event the host emitted before now has arrived; false after `flushMs`. */
  async function flush(): Promise<boolean> {
    const id = `flush-${++seq}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const back = new Promise<boolean>((resolve) => {
      markers.set(id, () => resolve(true));
      timer = setTimeout(() => resolve(false), flushMs);
    });
    try {
      await host.emit(FLUSH_EVENT, id);
      return await back;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      markers.delete(id);
    }
  }

  async function run<T>(cmd: string, args: Record<string, unknown>): Promise<Written<T>> {
    await listenOnce();
    // The fence: catch up with the host's events before this write starts. A late report that
    // arrives now finds no write running and is dropped.
    if (behind) behind = !(await flush());
    const fenced = !behind;
    const reports: BatchReport[] = [];
    current = reports;
    try {
      let value: T | undefined;
      let failure: { error: unknown } | null = null;
      try {
        value = await host.invoke<T>(cmd, args);
      } catch (error) {
        failure = { error };
      }
      // Also after a refusal: a report it sent must not be taken for the next write's.
      const back = await flush();
      // Back: every event the host sent before it has arrived, late ones included.
      behind = !back;
      const sure = fenced && back;
      if (failure) throw failure.error;
      return { value: value as T, report: sure ? (reports[0] ?? null) : null, sure };
    } finally {
      current = null;
    }
  }

  /** Runs `cmd` after every write before it has finished, and returns its result and its report. */
  const write = <T>(cmd: string, args: Record<string, unknown>): Promise<Written<T>> => {
    const next = tail.then(() => run<T>(cmd, args));
    tail = next.catch(() => undefined);
    return next;
  };
  return { write };
}

const appJournal = createJournal({
  invoke: (cmd, args) => tauriInvoke(cmd, args),
  listen: (event, handler) => tauriListen(event, handler),
  emit: (event, payload) => tauriEmit(event, payload),
});

/** Runs a journaled host command (a write to a user file, or an undo) through the app's one journal. */
export const journaled = appJournal.write;
