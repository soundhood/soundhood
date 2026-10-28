#!/usr/bin/env node
// Blue-pixel scan (brief §6): fails any screenshot where more than 0.1 % of the considered pixels
// have hue 200-250 degrees and HSV saturation above 0.5. Scope is fixture-library screenshots
// only: the Playwright baselines and run output, and docs/evidence/**. Artwork on device
// screenshots is excluded with a `<name>.mask.json` sidecar ({ "masks": [{ x, y, w, h, why }] }).
//
//   node tools/blue-scan.mjs [file-or-folder ...]   scan (default: the scope above)
//   node tools/blue-scan.mjs --write-baseline       grandfather today's failing files
//   node tools/blue-scan.mjs --strict               ignore the baseline
import { statSync } from "node:fs";
import path from "node:path";
import { compareCounts, readBaseline, writeBaseline } from "./lint/baseline.mjs";
import { BLUE_MAX_RATIO, scanPng } from "./lint/blue.mjs";
import { REPO_ROOT, toRepoPath, walkFiles } from "./lint/common.mjs";

const TOOL = "blue-scan";
const RULE = "blue-pixels";
const DEFAULT_SCOPE = [
  "tools/screenshot/__screenshots__",
  "tools/screenshot/test-results",
  "docs/evidence",
];

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const unknown = [...flags].filter((a) => !["--write-baseline", "--strict"].includes(a));
if (unknown.length) {
  console.error(`blue-scan: unknown argument ${unknown.join(" ")}`);
  process.exit(2);
}
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const roots = (targets.length ? targets : DEFAULT_SCOPE).map((t) => path.resolve(targets.length ? process.cwd() : REPO_ROOT, t));

// Playwright's *-diff.png images are red/yellow change maps, not UI.
const isShot = (name) => /\.png$/i.test(name) && !/-diff\.png$/i.test(name);
const files = [];
for (const root of roots) {
  let st;
  try {
    st = statSync(root);
  } catch {
    continue; // an absent default folder (no run output yet) is fine
  }
  if (st.isFile()) files.push(root);
  else files.push(...walkFiles(root, isShot));
}

const results = [];
let errors = 0;
for (const abs of [...new Set(files)].sort()) {
  const file = toRepoPath(abs);
  try {
    results.push({ file, ...scanPng(abs) });
  } catch (e) {
    errors++;
    console.log(`blue-scan: ${file}: ${e.message}`);
  }
}

const failing = results.filter((r) => r.ratio > BLUE_MAX_RATIO);
const counts = Object.fromEntries(failing.map((r) => [r.file, { [RULE]: r.matched }]));
if (flags.has("--write-baseline")) {
  writeBaseline(TOOL, counts);
  console.log(`blue-scan: baseline written (${failing.length} grandfathered files)`);
  process.exit(errors ? 1 : 0);
}

const baseline = flags.has("--strict") ? {} : readBaseline(TOOL);
const { over } = compareCounts(counts, baseline);
const overFiles = new Set(over.map((o) => o.file));
const pct = (r) => `${(r.ratio * 100).toFixed(3)} %`;
for (const r of failing) {
  const verdict = overFiles.has(r.file) ? "FAIL" : "grandfathered";
  const masked = r.masks ? `, ${r.masks} mask(s)` : "";
  console.log(`${r.file}  ${RULE}  ${pct(r)} blue (${r.matched}/${r.considered} px${masked})  ${verdict}`);
}
console.log(
  `blue-scan: ${results.length} screenshots, ${failing.length} over ${BLUE_MAX_RATIO * 100} %, ${overFiles.size} failing` +
    (errors ? `, ${errors} unreadable` : ""),
);
process.exit(overFiles.size || errors ? 1 : 0);
