#!/usr/bin/env node
// Hygiene lint over every tracked file (`git ls-files`). In the text of each file: paths inside a
// Proton Drive folder, private LAN addresses, e-mail addresses other than GitHub noreply / the
// commit trailer / example domains, Windows user-profile paths, device serials and IMEIs next to
// the word that names them, en and em dashes (U+2013, U+2014, also as HTML entities), and the
// owner-specific words and terms of the deny list (comma- or newline-separated words, terms or
// 64-hex SHA-256 hashes; see lint/hygiene.mjs parseDenyList).
// The deny list is never in the repository: it is the HYGIENE_DENY environment variable (a CI
// secret) plus, when it exists, the deny file %USERPROFILE%\.soundhood\hygiene-deny.txt (or the
// path in HYGIENE_DENY_FILE), kept outside the repo like keystore.properties.
// In every tracked path, binaries included: the same rules, and file names that hold keys or
// secrets (*.jks, keystore.properties, cookies.txt, .env, ...). Binary contents are skipped.
// Exit 1 on any finding; there is no baseline, a leak is always fixed at the source. Deny-list
// terms, forbidden words and device ids are never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT, formatFinding } from "./lint/common.mjs";
import {
  FORBIDDEN_WORD_HASHES,
  MIN_DENY_LENGTH,
  VENDORED_EXEMPT_RULES,
  isVendored,
  parseDenyList,
  scanPath,
  scanText,
} from "./lint/hygiene.mjs";

const MAX_BYTES = 8 * 1024 * 1024;

// The local deny file: same format as HYGIENE_DENY, never committed.
const denyFile = process.env.HYGIENE_DENY_FILE || path.join(os.homedir(), ".soundhood", "hygiene-deny.txt");
const fileDeny = existsSync(denyFile) ? readFileSync(denyFile, "utf8") : "";
const deny = parseDenyList([process.env.HYGIENE_DENY ?? "", fileDeny].join("\n"));
const hashes = new Set([...FORBIDDEN_WORD_HASHES, ...deny.hashes]);
const denyCount = deny.hashes.size + deny.terms.length;
if (deny.ignored) {
  console.log(`hygiene-lint: ${deny.ignored} HYGIENE_DENY entries shorter than ${MIN_DENY_LENGTH} characters ignored`);
}

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
  // The path first: a keystore is binary, so its contents are never read.
  for (const f of scanPath(file, hashes, deny.terms)) findings.push({ file, ...f });
  // Vendored upstream code (third_party/) keeps its authors' e-mail addresses and dashes; every
  // other rule still applies.
  const vendored = isVendored(file);
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
  for (const f of scanText(bytes.toString("utf8"), hashes, deny.terms)) {
    if (vendored && VENDORED_EXEMPT_RULES.has(f.rule)) continue;
    findings.push({ file, ...f });
  }
}

for (const f of findings) console.log(formatFinding(f));
const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
const summary = Object.entries(byRule)
  .map(([rule, n]) => `${rule} ${n}`)
  .join(", ");
const fileNote = fileDeny ? " (with the local deny file)" : "";
const denyNote = denyCount ? `, ${denyCount} HYGIENE_DENY entries${fileNote}` : ", HYGIENE_DENY not set, no local deny file";
console.log(
  `hygiene-lint: ${scanned} text files of ${tracked.length} tracked${denyNote}, ${findings.length} findings${summary ? ` (${summary})` : ""}`,
);
process.exit(findings.length ? 1 : 0);
