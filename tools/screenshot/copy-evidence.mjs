#!/usr/bin/env node
// Copies the committed screenshot baselines into docs/evidence/phase-0/after/ as
// <viewport>-<screen>.png: the Phase 0 UI on the fixture library, as the visual suite renders it
// (baseline.spec.mjs: the screens of the old UI; undo.spec.mjs: Undo after an edit, the developer
// section, the desktop after a playlist add). The folder is made to match the baselines exactly, so
// a screen that no longer exists does not linger. The pre-rebuild screens (0.1.0) stay in
// docs/evidence/phase-0/before-0.1.0/, which this script never writes.
//
//   node screenshot/copy-evidence.mjs [os]   os = the __screenshots__ subfolder (default: this machine's)
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const os = process.argv[2] ?? process.platform;
const from = path.join(HERE, "__screenshots__", os);
const to = path.resolve(HERE, "..", "..", "docs", "evidence", "phase-0", "after");

let shots;
try {
  shots = readdirSync(from).filter((f) => f.endsWith(".png")).sort();
} catch {
  console.error(`copy-evidence: no baselines in ${from}; run npm run test:visual:update first`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
let removed = 0;
for (const f of readdirSync(to)) {
  if (f.endsWith(".png") && !shots.includes(f)) {
    rmSync(path.join(to, f));
    removed++;
  }
}
for (const f of shots) copyFileSync(path.join(from, f), path.join(to, f));
console.log(
  `copy-evidence: ${shots.length} screenshots copied to ${path.relative(process.cwd(), to)}` +
    (removed ? `, ${removed} stale removed` : ""),
);
