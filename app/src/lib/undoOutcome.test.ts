// An undo's words (undoOutcome.ts) and a change's (coreIpc.ts): the title counts the changes really
// put back, a stop names the change that was refused, labels lose file extensions and name the bin
// the way this device does.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { changeOf, shownLabel, type BatchReport, type Change } from "../coreIpc";
import { undoOutcome, type UndoStep } from "./undoOutcome";

const moveA: Change = { batch: "b1", label: "Moved A - X.opus to Archive", paths: ["Evenings/A - X.opus", "Archive/A - X.opus"] };
const moveB: Change = { batch: "b2", label: "Moved B - Y.opus to Archive", paths: ["Evenings/B - Y.opus", "Archive/B - Y.opus"] };
const back = (name: string): BatchReport => ({
  batch: `u-${name}`,
  applied: [{ label: `Moved ${name}.opus back to Evenings`, path_before: `Archive/${name}.opus`, path_after: `Evenings/${name}.opus` }],
  skipped: [],
  failed: [],
  aborted: false,
});
const refusedAt = (path: string): BatchReport => ({ batch: "u-r", applied: [], skipped: [{ path, reason: "changed since, not undone" }], failed: [], aborted: false });

describe("undoOutcome", () => {
  it("a clean undo of every change: counted, newest first, without extensions", () => {
    const steps: UndoStep[] = [
      { change: moveB, report: back("B - Y") },
      { change: moveA, report: back("A - X") },
    ];
    const out = undoOutcome([moveA, moveB], steps, false);
    expect(out.title).toBe("Undid 2 of 2 changes");
    expect(out.clean).toBe(true);
    expect(out.reasons).toEqual([]);
    expect(out.rows.map((r) => r.after)).toEqual(["Moved B - Y back to Evenings", "Moved A - X back to Evenings"]);
    expect(out.toast).toBe("Undone: Moved B - Y to Archive; Moved A - X to Archive");
  });

  it("a refused newest change: nothing counted, the stop names it and what was not tried", () => {
    const out = undoOutcome([moveA, moveB], [{ change: moveB, report: refusedAt("Archive/B - Y.opus") }], false);
    expect(out.title).toBe("Undid 0 of 2 changes");
    expect(out.reasons).toEqual([
      'Stopped at "Moved B - Y to Archive": part of it was left as it was; 1 earlier change was not tried',
      "1 skipped: changed since, not undone",
    ]);
    expect(out.rows).toEqual([{ key: "skipped-0", before: "B - Y", after: "B - Y", status: "skipped", reason: "changed since, not undone" }]);
    expect(out.clean).toBe(false);
  });

  it("an older change refused after a newer one went back: one of two, and why", () => {
    const steps: UndoStep[] = [
      { change: moveB, report: back("B - Y") },
      { change: moveA, report: null, error: "this change was undone already" },
    ];
    const out = undoOutcome([moveA, moveB], steps, false);
    expect(out.title).toBe("Undid 1 of 2 changes");
    expect(out.stopped).toBe('Stopped at "Moved A - X to Archive": this change was undone already');
    expect(out.toast).toBe("Undid 1 of 2 changes (see the log)");
  });

  it("one change: its own words, or why nothing was undone", () => {
    const del: Change = { batch: "d", label: "Deleted A - X.opus (in the bin)", paths: ["Evenings/A - X.opus"] };
    const restored: BatchReport = {
      batch: "u",
      applied: [{ label: "Restored A - X.opus from the bin", path_before: null, path_after: "Evenings/A - X.opus" }],
      skipped: [],
      failed: [],
      aborted: false,
    };
    const pc = undoOutcome([del], [{ change: del, report: restored }], false);
    expect(pc.title).toBe("Undone: Deleted A - X (in the Recycle Bin)");
    expect(pc.rows[0].after).toBe("Restored A - X from the Recycle Bin");
    expect(undoOutcome([del], [{ change: del, report: restored }], true).title).toBe("Undone: Deleted A - X (in the bin)");

    const no = undoOutcome([del], [{ change: del, report: null, error: "this change was undone already" }], false);
    expect(no.title).toBe("Nothing was undone");
    expect(no.reasons).toEqual(["Not undone: this change was undone already"]);
    expect(no.toast).toBe("Not undone: this change was undone already");
  });

  it("a partial undo of one playlist change says how much was left", () => {
    const add: Change = { batch: "a", label: "Added 1 track to Focus" };
    const out = undoOutcome([add], [{ change: add, report: refusedAt("_Playlists/Focus.m3u8") }], false);
    expect(out.title).toBe("Undo: 0 restored, 1 left as they are (see the log)");
    expect(out.rows[0].before).toBe("Focus");
    expect(out.toast).toBe(out.title);
  });
});

describe("changeOf and shownLabel", () => {
  it("no applied entry is no change", () => {
    expect(changeOf(null)).toBeNull();
    expect(changeOf({ batch: "b", applied: [], skipped: [{ path: "a", reason: "no change" }], failed: [], aborted: false })).toBeNull();
  });

  it("names a batch the way last_change does", () => {
    const made = changeOf({
      batch: "m",
      applied: ["Ambient", "Archive"].map((n) => ({ label: `Created playlist ${n}`, path_before: null, path_after: null })),
      skipped: [],
      failed: [],
      aborted: false,
    });
    expect(made).toEqual({ batch: "m", label: "Made 2 playlists from folders", paths: [] });
    const moves = changeOf({ batch: "x", applied: [back("A - X").applied[0], back("B - Y").applied[0]], skipped: [], failed: [], aborted: false });
    expect(moves?.label).toBe("Moved A - X.opus back to Evenings and 1 more");
  });

  it("drops the extensions of the files it names, and only those", () => {
    expect(shownLabel("Edited tags of Mr. Brightside.mp3", ["Rock/Mr. Brightside.mp3"], true)).toBe("Edited tags of Mr. Brightside");
    expect(shownLabel("Added 1 track to Late Night", [null, undefined], false)).toBe("Added 1 track to Late Night");
  });
});
