#!/usr/bin/env node
// Token lint (brief §6) over app/src/**/*.{ts,tsx,css}: raw hex colours outside
// app/src/design/tokens.css, controls left with their native appearance, and emoji / pictograph
// glyphs (U+1F000-1FAFF, U+2600-27BF, U+2B00-2BFF) in TSX. Violations that already existed are
// grandfathered per file and rule in tools/lint-baseline.json; any new one fails.
//
//   node tools/token-lint.mjs                   check against the baseline (exit 1 on new violations)
//   node tools/token-lint.mjs --write-baseline  record today's counts as the baseline
//   node tools/token-lint.mjs --strict          ignore the baseline and fail on every violation
import { readFileSync } from "node:fs";
import path from "node:path";
import { compareCounts, countByFileAndRule, readBaseline, writeBaseline } from "./lint/baseline.mjs";
import { REPO_ROOT, formatFinding, toRepoPath, walkFiles } from "./lint/common.mjs";
import { lintTokens } from "./lint/tokens.mjs";

const TOOL = "token-lint";
const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((a) => !["--write-baseline", "--strict"].includes(a));
if (unknown.length) {
  console.error(`token-lint: unknown argument ${unknown.join(" ")}`);
  process.exit(2);
}

const sources = walkFiles(path.join(REPO_ROOT, "app", "src"), (name) => /\.(ts|tsx|css)$/.test(name));
const files = sources.map((abs) => ({ file: toRepoPath(abs), text: readFileSync(abs, "utf8") }));
const findings = lintTokens(files);
const counts = countByFileAndRule(findings);

if (args.has("--write-baseline")) {
  writeBaseline(TOOL, counts);
  console.log(`token-lint: baseline written (${findings.length} grandfathered violations in ${Object.keys(counts).length} files)`);
  process.exit(0);
}

const baseline = args.has("--strict") ? {} : readBaseline(TOOL);
const { over, under } = compareCounts(counts, baseline);
// A file/rule pair over its allowance prints all its findings: the lint cannot tell which is new.
const failing = new Set(over.map((o) => `${o.file}\0${o.rule}`));
for (const f of findings) if (failing.has(`${f.file}\0${f.rule}`)) console.log(formatFinding(f));
for (const o of over) console.log(`token-lint: ${o.file} ${o.rule}: ${o.count} found, ${o.allowed} allowed by the baseline`);
for (const u of under) {
  console.log(`token-lint: ${u.file} ${u.rule}: ${u.count} found, baseline allows ${u.allowed}; lower it with --write-baseline`);
}

const grandfathered = findings.length - findings.filter((f) => failing.has(`${f.file}\0${f.rule}`)).length;
console.log(`token-lint: ${files.length} files, ${findings.length} violations, ${grandfathered} grandfathered, ${over.length} file/rule pairs failing`);
process.exit(over.length ? 1 : 0);
