#!/usr/bin/env node
// Hygiene lint over every tracked file (`git ls-files`): the owner's first name (matched by
// SHA-256 of each word, so this lint never contains it), his library path, private LAN
// addresses, e-mail addresses other than GitHub noreply / the commit trailer / example domains,
// and Windows user-profile paths. Binary files are skipped. Exit 1 on any finding; there is no
// baseline, a leak is always fixed at the source.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, formatFinding } from "./lint/common.mjs";
import { scanText } from "./lint/hygiene.mjs";

const MAX_BYTES = 8 * 1024 * 1024;

let listing;
try {
  listing = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error(`hygiene-lint: git ls-files failed: ${e.message}`);
  process.exit(2);
}
const tracked = listing.toString("utf8").split("\0").filter(Boolean);

let scanned = 0;
const findings = [];
for (const file of tracked) {
  const abs = path.join(REPO_ROOT, file);
  let bytes;
  try {
    if (statSync(abs).size > MAX_BYTES) continue;
    bytes = readFileSync(abs);
  } catch {
    continue; // tracked but deleted in the working tree
  }
  // A NUL byte in the first 8 KiB marks a binary file (images, audio, keystores).
  if (bytes.subarray(0, 8192).includes(0)) continue;
  scanned++;
  for (const f of scanText(bytes.toString("utf8"))) findings.push({ file, ...f });
}

for (const f of findings) console.log(formatFinding(f));
const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
const summary = Object.entries(byRule)
  .map(([rule, n]) => `${rule} ${n}`)
  .join(", ");
console.log(`hygiene-lint: ${scanned} text files of ${tracked.length} tracked, ${findings.length} findings${summary ? ` (${summary})` : ""}`);
process.exit(findings.length ? 1 : 0);
