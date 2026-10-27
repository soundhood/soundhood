// The grandfather baseline shared by the lints (tools/lint-baseline.json): per tool, per file,
// per rule, how many violations already existed when the lint landed. Counts at or under the
// baseline pass and anything above fails, so pre-design-system code can only get cleaner.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./common.mjs";

/** The committed baseline file. */
export const BASELINE_PATH = path.join(REPO_ROOT, "tools", "lint-baseline.json");

const ABOUT =
  "Grandfathered lint violations: tool -> file -> rule -> count. Written by `--write-baseline`; " +
  "never raise a count by hand. Lower it (re-run --write-baseline) whenever code gets cleaner.";

/** Counts findings as { file: { rule: n } }. */
export function countByFileAndRule(findings) {
  const counts = {};
  for (const f of findings) {
    counts[f.file] ??= {};
    counts[f.file][f.rule] = (counts[f.file][f.rule] ?? 0) + 1;
  }
  return counts;
}

function readAll(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

/** The section of the baseline owned by `tool`; empty when the file or the section is missing. */
export function readBaseline(tool, file = BASELINE_PATH) {
  return readAll(file)[tool] ?? {};
}

function sortKeysDeep(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeysDeep(value[k])]),
  );
}

/** Replaces the `tool` section with `counts`, keeping the other tools' sections; keys sorted. */
export function writeBaseline(tool, counts, file = BASELINE_PATH) {
  const all = readAll(file);
  all._about = ABOUT;
  all[tool] = counts;
  writeFileSync(file, JSON.stringify(sortKeysDeep(all), null, 2) + "\n");
}

/**
 * Compares current counts with a baseline section. `over` lists file/rule pairs above their
 * allowance (these fail); `under` lists pairs that improved (the baseline can be lowered).
 */
export function compareCounts(counts, baseline) {
  const over = [];
  const under = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (count > allowed) over.push({ file, rule, count, allowed });
    }
  }
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, allowed] of Object.entries(rules)) {
      const count = counts[file]?.[rule] ?? 0;
      if (count < allowed) under.push({ file, rule, count, allowed });
    }
  }
  return { over, under };
}
