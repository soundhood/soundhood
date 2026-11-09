#!/usr/bin/env node
// Contrast lint (brief §6, accessibility): the WCAG 2.x contrast of every (foreground, background)
// token pair in app/src/design/tokens.css that the design system puts together, in the default
// values and in the `prefers-contrast: more` values. Text pairs need 4.5:1, the slider knob 3:1;
// non-text tokens are only reported. The pairs, their minimums and the reason for each are the
// RULES table at the top of tools/lint/contrast.mjs.
//
//   node tools/contrast-lint.mjs [tokens.css]   check (exit 1 on a pair below its minimum or a
//                                               token that is missing or unreadable)
//
// Until the design system lands there is no tokens.css: the lint says so and passes.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkContrast, formatRatio } from "./lint/contrast.mjs";
import { REPO_ROOT, toRepoPath } from "./lint/common.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((a) => a.startsWith("--"))) {
  console.error("usage: node tools/contrast-lint.mjs [tokens.css]");
  process.exit(2);
}
const file = args.length ? path.resolve(process.cwd(), args[0]) : path.join(REPO_ROOT, "app", "src", "design", "tokens.css");
const shown = toRepoPath(file);

if (!existsSync(file)) {
  console.log(`contrast-lint: skipped, ${shown} does not exist yet (the design system has not landed)`);
  process.exit(0);
}

const { hasMore, rows } = checkContrast(readFileSync(file, "utf8"));
const width = Math.max(...rows.map((r) => `${r.fg} on ${r.bg}`.length));
for (const r of rows) {
  const pair = `${r.fg} on ${r.bg}`.padEnd(width);
  const need = r.min === null ? "report" : `>= ${r.min}`;
  const ratio = r.ratio === null ? "  -  " : formatRatio(r.ratio).padStart(5);
  let line = `${r.mode.padEnd(7)}  ${pair}  ${ratio}  ${need.padEnd(6)}  ${r.kind.padEnd(8)}  ${r.verdict.toUpperCase()}`;
  if (r.verdict === "fail") line += `  (${r.why})`;
  if (r.verdict === "error") line += `  ${r.error}`;
  console.log(line);
}

const count = (v) => rows.filter((r) => r.verdict === v).length;
const failing = count("fail") + count("error");
if (!hasMore) console.log(`contrast-lint: ${shown} has no prefers-contrast: more block; default values only`);
console.log(
  `contrast-lint: ${shown}, ${rows.length} pairs: ${count("pass")} pass, ${count("report")} reported only, ` +
    `${count("fail")} below their minimum, ${count("error")} unreadable`,
);
process.exit(failing ? 1 : 0);
