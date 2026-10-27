// Plumbing shared by the repo lints: where the repo is, how files are found, how findings print.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (the folder that holds tools/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `abs` relative to `root` with forward slashes: the form findings and baselines use. */
export function toRepoPath(abs, root = REPO_ROOT) {
  return path.relative(root, abs).split(path.sep).join("/");
}

const SKIPPED_DIRS = new Set(["node_modules", "target"]);

/**
 * Every file under `dir` whose name passes `keep(name, abs)`, sorted. Skips dependency and
 * build folders and dot-folders; a missing `dir` yields no files.
 */
export function walkFiles(dir, keep = () => true) {
  const out = [];
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !SKIPPED_DIRS.has(e.name)) visit(abs);
      } else if (e.isFile() && keep(e.name, abs)) {
        out.push(abs);
      }
    }
  };
  visit(dir);
  return out.sort();
}

/** Returns a function mapping a character offset in `text` to its 1-based line number. */
export function lineLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** One finding as `file:line  rule  message`, the format every lint prints. */
export function formatFinding(f) {
  return `${f.file}:${f.line}  ${f.rule}  ${f.message}`;
}

/** Hex form of a code point for messages, e.g. U+266A. */
export function codePointLabel(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
