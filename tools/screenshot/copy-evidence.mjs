#!/usr/bin/env node
// Copies the visual suite's default-mode captures of the parity screens (playlists, artists,
// folders, tracks, playing, queue, search, settings) at the four sizes from __screenshots__/<os>/
// into docs/evidence/phase-<n>/after/ as <width>x<height>-<screen>.png: the UI of that phase on the
// fixture library, as the visual suite renders it. Flow captures (after-playlist-add,
// settings-undo, ...), the captures in the other modes (screen-modes/) and the component pages
// (components/) stay out. The folder is made to match exactly, so a screen that no longer exists
// does not linger. An earlier phase's folder is a record and is never rewritten, and neither is
// docs/evidence/phase-0/before-0.1.0/.
//
//   node screenshot/copy-evidence.mjs [--phase <n>] [--os <name>]
//     --phase  the phase folder to fill (default: the current phase, CURRENT_PHASE)
//     --os     the __screenshots__ subfolder to read (default: this machine's)
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/** The phase being built; earlier phases' evidence folders are not rewritten. */
export const CURRENT_PHASE = 1;

/** The screens the parity grid pairs, photographed at every size. */
export const PARITY_SCREENS = ["playlists", "artists", "folders", "tracks", "playing", "queue", "search", "settings"];

/** The visual suite's four sizes. */
export const SIZES = ["390x844", "834x1194", "1280x800", "1920x1080"];

/** { phase, os } from the command line; throws on anything it does not know. */
export function parseArgs(argv, defaults = { phase: CURRENT_PHASE, os: process.platform }) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--phase" && flag !== "--os") || value === undefined || value.startsWith("--")) {
      throw new Error(`usage: copy-evidence.mjs [--phase <n>] [--os <name>] (got "${argv.slice(i).join(" ")}")`);
    }
    if (flag === "--phase") {
      if (!/^\d+$/.test(value)) throw new Error(`--phase takes a phase number, not "${value}"`);
      out.phase = Number(value);
    } else {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`--os takes a folder name, not "${value}"`);
      out.os = value;
    }
    i++;
  }
  if (out.phase < CURRENT_PHASE) {
    throw new Error(`phase-${out.phase} is an earlier phase's record and is not rewritten (the current phase is ${CURRENT_PHASE})`);
  }
  return out;
}

/** Where a phase's evidence of the visual suite goes: docs/evidence/phase-<n>/after/. */
export function evidenceDir(root, phase) {
  return path.join(root, "docs", "evidence", `phase-${phase}`, "after");
}

/** Every file name the evidence holds: each parity screen at each size, sorted. */
export function expectedShots() {
  return SIZES.flatMap((size) => PARITY_SCREENS.map((screen) => `${size}-${screen}.png`)).sort();
}

/**
 * Which of `names` (the files at the top of a baseline folder) go into the evidence, and which of
 * the expected ones are missing: { copy, missing }, both sorted.
 */
export function pickShots(names) {
  const have = new Set(names);
  const wanted = expectedShots();
  return { copy: wanted.filter((n) => have.has(n)), missing: wanted.filter((n) => !have.has(n)) };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`copy-evidence: ${e.message}`);
    process.exit(2);
  }
  const from = path.join(HERE, "__screenshots__", args.os);
  const to = evidenceDir(REPO_ROOT, args.phase);

  let names;
  try {
    names = readdirSync(from);
  } catch {
    console.error(`copy-evidence: no baselines in ${from}; run npm run test:visual:update first`);
    process.exit(1);
  }
  const { copy, missing } = pickShots(names);
  if (missing.length) {
    console.error(`copy-evidence: baselines missing in ${from}: ${missing.join(", ")}`);
    process.exit(1);
  }

  mkdirSync(to, { recursive: true });
  let removed = 0;
  for (const f of readdirSync(to)) {
    if (f.endsWith(".png") && !copy.includes(f)) {
      rmSync(path.join(to, f));
      removed++;
    }
  }
  for (const f of copy) copyFileSync(path.join(from, f), path.join(to, f));
  console.log(
    `copy-evidence: ${copy.length} screenshots copied to ${path.relative(process.cwd(), to)}` +
      (removed ? `, ${removed} stale removed` : ""),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
