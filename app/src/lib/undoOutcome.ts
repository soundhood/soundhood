// What an undo did, in words: the report's title, rows and reason lines, and the toast line when the
// undo came from a toast. An undo walks its changes newest first, each by its own batch id
// (undo_batch), and stops at the first one that is refused (an error, or an entry left as it was).
import type { BatchReport, Change } from "../coreIpc";
import { shownLabel, undoStatus } from "../coreIpc";
import type { BatchRow } from "../design";
import { displayName } from "./tracks";

/** One undo_batch call: the change it undid (or tried to), and its report or its refusal. */
export type UndoStep = { change: Change; report: BatchReport | null; error?: string };

/** The steps' reports as one. */
export function mergeReports(reports: readonly BatchReport[]): BatchReport {
  return {
    batch: reports.map((r) => r.batch).join(","),
    applied: reports.flatMap((r) => r.applied ?? []),
    skipped: reports.flatMap((r) => r.skipped ?? []),
    failed: reports.flatMap((r) => r.failed ?? []),
    aborted: reports.some((r) => r.aborted),
  };
}

/** True when the step put back all of its change. */
export function stepUndid(s: UndoStep): boolean {
  const r = s.report;
  return !!r && !s.error && !r.skipped?.length && !r.failed?.length && !r.aborted;
}

/** The last part of a library path, without its extension. */
function bareName(p: string): string {
  return displayName(p.slice(p.replace(/\\/g, "/").lastIndexOf("/") + 1));
}

/** One line per distinct reason: "2 skipped: already in Evenings". */
export function reasonLines(rows: readonly BatchRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "done" || !r.reason) continue;
    const key = `${r.status === "skipped" ? "skipped" : "failed"}: ${r.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${k}`);
}

/** A change's label as shown: its file names without extension, the bin by this device's name. */
function labelOf(s: UndoStep, isMobile: boolean): string {
  // The undo's own entries name the same files as the change did.
  const r = s.report;
  const paths = [
    ...(s.change.paths ?? []),
    ...(r?.applied ?? []).flatMap((a) => [a.path_before, a.path_after]),
    ...(r?.skipped ?? []).map((x) => x.path),
    ...(r?.failed ?? []).map((x) => x.path),
  ];
  return shownLabel(s.change.label, paths, isMobile);
}

export type UndoOutcome = {
  title: string;
  rows: BatchRow[];
  reasons: string[];
  /** Every change was put back. */
  clean: boolean;
  /** The line a toast shows for an undo started from a toast. */
  toast: string;
  /** The line the log keeps when the undo stopped early; "" when it did not. */
  stopped: string;
  merged: BatchReport;
};

/**
 * Words for an undo of `changes` (oldest first) after `steps` (in the order tried, newest change
 * first). The title counts the changes really put back; a stop names the change that was refused.
 */
export function undoOutcome(changes: readonly Change[], steps: readonly UndoStep[], isMobile: boolean): UndoOutcome {
  const merged = mergeReports(steps.flatMap((s) => (s.report ? [s.report] : [])));
  const undone = steps.filter(stepUndid).length;
  const total = changes.length;
  const last = steps[steps.length - 1];
  const refused = last && !stepUndid(last) ? last : null;
  const notTried = total - steps.length;
  const rows: BatchRow[] = [
    ...merged.applied.map((a, i) => ({
      key: `done-${i}`,
      before: "",
      after: shownLabel(a.label, [a.path_before, a.path_after], isMobile),
      status: "done" as const,
    })),
    ...merged.skipped.map((s, i) => ({ key: `skipped-${i}`, before: bareName(s.path), after: bareName(s.path), status: "skipped" as const, reason: s.reason })),
    ...merged.failed.map((f, i) => ({ key: `failed-${i}`, before: bareName(f.path), after: bareName(f.path), status: "failed" as const, reason: f.error })),
  ];

  let stopped = "";
  if (refused && total === 1 && refused.error) stopped = `Not undone: ${refused.error}`;
  else if (refused && total > 1) {
    const why = refused.error ?? "part of it was left as it was";
    const rest = notTried > 0 ? `; ${notTried} earlier change${notTried === 1 ? " was" : "s were"} not tried` : "";
    stopped = `Stopped at "${labelOf(refused, isMobile)}": ${why}${rest}`;
  }

  let title: string;
  if (total === 1) {
    const only = steps[0];
    title = !only || only.error ? "Nothing was undone" : undoStatus(merged, labelOf(only, isMobile));
  } else {
    title = `Undid ${undone} of ${total} changes`;
  }

  const clean = undone === total;
  let toast: string;
  if (clean) toast = `Undone: ${steps.map((s) => labelOf(s, isMobile)).join("; ")}`;
  else if (total === 1) toast = stopped || title;
  else toast = `${title} (see the log)`;

  return { title, rows, reasons: [...(stopped ? [stopped] : []), ...reasonLines(rows)], clean, toast, stopped, merged };
}
