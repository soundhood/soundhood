#!/usr/bin/env node
// Copies the committed screenshot baselines into docs/evidence/phase-0/baseline/ as
// <viewport>-<screen>.png, the evidence set for the Phase 0 report.
//
//   node screenshot/copy-evidence.mjs [os]   os = the __screenshots__ subfolder (default: this machine's)
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const os = process.argv[2] ?? process.platform;
const from = path.join(HERE, "__screenshots__", os);
const to = path.resolve(HERE, "..", "..", "docs", "evidence", "phase-0", "baseline");

let shots;
try {
  shots = readdirSync(from).filter((f) => f.endsWith(".png")).sort();
} catch {
  console.error(`copy-evidence: no baselines in ${from}; run npm run test:visual:update first`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const f of shots) copyFileSync(path.join(from, f), path.join(to, f));
console.log(`copy-evidence: ${shots.length} screenshots copied to ${path.relative(process.cwd(), to)}`);
