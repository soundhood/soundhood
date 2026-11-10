// Shapes of the Phase 0 host commands and events that sit on soundhood-core (core/CONTRACT.md,
// "Host IPC (Phase 0)"), and the small pure helpers the UI uses to turn them into log lines.

/** `last_change`: the newest change on this device that can still be undone. */
export type ChangeSummary = { batch: string; ts: number; label: string; count: number };

/** One applied entry of a batch, in plain words; paths are the file's place before and after. */
export type BatchApplied = { label: string; path_before?: string | null; path_after?: string | null };

/** The `core:batch` event payload and the result of `undo_last` and `undo_batch`. */
export type BatchReport = {
  batch: string;
  applied: BatchApplied[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
  aborted: boolean;
};

/**
 * One journaled change as the UI keeps it to undo it: the batch id from the report its own command
 * sent (never the newest change read afterwards) and its words.
 */
export type Change = {
  batch: string;
  label: string;
  /** The library paths its entries named (before and after), to show the label without extensions. */
  paths?: string[];
};

/**
 * The change a write's own report made, in the words `last_change` would use ("Made 5 playlists from
 * folders", "<first> and 2 more"); null when it applied nothing.
 */
export function changeOf(r: BatchReport | null | undefined): Change | null {
  const applied = r?.applied ?? [];
  if (!r || applied.length === 0) return null;
  const n = applied.length;
  const first = applied[0].label;
  let label = first;
  if (n > 1 && applied.every((a) => a.label.startsWith("Created playlist "))) label = `Made ${n} playlists from folders`;
  else if (n > 1) label = `${first} and ${n - 1} more`;
  const paths = applied.flatMap((a) => [a.path_before, a.path_after]).filter((p): p is string => !!p);
  return { batch: r.batch, label, paths };
}

/** An audio file's extension at the end of a name in a label ("Quiet Bloom - Anouk Lirr.ogg"). */
const AUDIO_EXTENSION = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wma|webm|aiff?|alac)(?=$|[\s,;)])/gi;

/**
 * A change's words as the app shows them (the core's words, as the journal keeps them, stay in the
 * log): songs, not tracks; file names without their extension; the bin by the name it has on this
 * device ("the Recycle Bin" on a PC). `paths` are the library paths the entry names (before and
 * after); without them (a `last_change` summary) the audio extensions the library holds are dropped.
 */
export function shownLabel(label: string, paths: readonly (string | null | undefined)[] | null, isMobile: boolean): string {
  let s = label;
  if (paths) {
    for (const p of paths) {
      if (!p) continue;
      const name = p.slice(p.replace(/\\/g, "/").lastIndexOf("/") + 1);
      const bare = name.replace(/\.[^./\\]+$/, "");
      if (bare && bare !== name) s = s.split(name).join(bare);
    }
  } else {
    s = s.replace(AUDIO_EXTENSION, "");
  }
  s = s.replace(/\b(\d+) tracks?\b/g, (_, n: string) => `${n} ${n === "1" ? "song" : "songs"}`);
  return isMobile ? s : s.replace(/\bthe bin\b/g, "the Recycle Bin");
}


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
