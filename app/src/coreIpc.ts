// Shapes of the Phase 0 host commands and events that sit on soundhood-core (core/CONTRACT.md,
// "Host IPC (Phase 0)"), and the small pure helpers the UI uses to turn them into log lines.

/** `last_change`: the newest change on this device that can still be undone. */
export type ChangeSummary = { batch: string; ts: number; label: string; count: number };

/** One applied entry of a batch, in plain words; paths are the file's place before and after. */
export type BatchApplied = { label: string; path_before?: string | null; path_after?: string | null };

/** The `core:batch` event payload and the result of `undo_last`. */
export type BatchReport = {
  batch: string;
  applied: BatchApplied[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
  aborted: boolean;
};

/** `rebuild_index`. */
export type RefreshReport = { total: number; read: number; removed: number; millis: number };

/** `self_test`: one line per check, "PASS …" or "FAIL …". */
export type SelfTestReport = { passed: number; failed: number; lines: string[] };

/** `diagnostics`: the block "Copy log" puts above the log (paths already use "~" for home). */
export type Diagnostics = {
  appVersion: string;
  platform: string;
  os: string;
  deviceId: string;
  indexPath: string;
  orphansRemoved: string[];
  sidecars: string;
};

/** The log keeps its tail: once it passes 20,000 characters only the last 12,000 stay. */
export function capLog(prev: string): string {
  return prev.length > 20000 ? prev.slice(-12000) : prev;
}

/** One log line per applied, skipped and failed entry of a batch report. */
export function batchLogLines(r: BatchReport): string[] {
  const lines: string[] = [];
  for (const a of r.applied ?? []) lines.push(`[change] ${a.label}`);
  for (const s of r.skipped ?? []) lines.push(`[skipped] ${s.path} - ${s.reason}`);
  for (const f of r.failed ?? []) lines.push(`[failed] ${f.path} - ${f.error}`);
  if (r.aborted) lines.push("[failed] the batch stopped early: three files in a row failed the check after writing");
  return lines;
}

/**
 * What "Copy log" puts on the clipboard: the diagnostics block, the visible log, then the lines kept
 * only for copying (applied changes), leaving out any of those the visible log already shows.
 */
export function copyLogText(head: string[], visible: string, quiet: string): string {
  const shown = new Set(visible.split("\n").map((l) => l.trim()).filter(Boolean));
  const extra = quiet.split("\n").filter((l) => l.trim() && !shown.has(l.trim()));
  const parts = [head.join("\n")];
  const v = visible.replace(/\s+$/, "");
  if (v) parts.push(v);
  if (extra.length) parts.push(extra.join("\n"));
  return parts.join("\n\n") + "\n";
}

/** The status line after "Undo": the change's own label, or how much was left as it was. */
export function undoStatus(report: BatchReport, label: string): string {
  const left = (report.skipped?.length ?? 0) + (report.failed?.length ?? 0);
  if (left === 0 && !report.aborted) return `Undone: ${label}`;
  return `Undo: ${report.applied?.length ?? 0} restored, ${left} left as they are (see the log)`;
}

/** The diagnostics block, one "field: value" line per field. */
export function diagnosticsLines(d: Diagnostics): string[] {
  return [
    `appVersion: ${d.appVersion}`,
    `platform: ${d.platform}`,
    `os: ${d.os}`,
    `deviceId: ${d.deviceId}`,
    `indexPath: ${d.indexPath}`,
    `orphansRemoved: ${d.orphansRemoved?.length ? d.orphansRemoved.join(", ") : "none"}`,
    `sidecars: ${d.sidecars}`,
  ];
}

/**
 * Comparison key of a library file, whether `p` is absolute (under `root`) or root-relative as the
 * core reports it: forward slashes, NFC, lower case (how the core compares paths).
 */
export function libraryKey(root: string, p: string): string {
  const r = root.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  let s = p.replace(/\\/g, "/");
  if (r && s.toLowerCase().startsWith(r.toLowerCase() + "/")) s = s.slice(r.length);
  return s.replace(/^\/+/, "").normalize("NFC").toLowerCase();
}
