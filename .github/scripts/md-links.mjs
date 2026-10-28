// Fails when a tracked Markdown file links to a repository file or heading that does not exist.
// Checks relative links and #anchors (GitHub's heading slugs); external URLs are not fetched.
//
//   node .github/scripts/md-links.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Vendored upstream docs (third_party/) link to files the published crate does not ship.
const files = execFileSync("git", ["ls-files", "-z", "--", "*.md", ":(exclude)third_party/**"], { cwd: repo, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

// Lines outside fenced code blocks, with their 1-based numbers.
function proseLines(md) {
  const out = [];
  let fenced = false;
  md.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) out.push([i + 1, line]);
  });
  return out;
}

// GitHub's slug: lower case, punctuation dropped (letters, digits, spaces, `-`, `_` kept), spaces
// to hyphens, a numeric suffix for repeated headings.
const slugCache = new Map();
function slugs(file) {
  if (slugCache.has(file)) return slugCache.get(file);
  const seen = new Map();
  const out = new Set();
  for (const [, line] of proseLines(readFileSync(file, "utf8"))) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  slugCache.set(file, out);
  return out;
}

let broken = 0;
for (const rel of files) {
  const abs = join(repo, rel);
  if (!existsSync(abs)) continue;
  for (const [n, line] of proseLines(readFileSync(abs, "utf8"))) {
    const prose = line.replace(/`[^`]*`/g, "");
    for (const m of prose.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto:, ...
      const [path, anchor] = target.split("#");
      const dest = path ? resolve(dirname(abs), decodeURI(path)) : abs;
      if (!existsSync(dest)) {
        console.log(`${rel}:${n}: no such file: ${target}`);
        broken++;
      } else if (anchor && dest.endsWith(".md") && statSync(dest).isFile() && !slugs(dest).has(anchor)) {
        console.log(`${rel}:${n}: no such heading: ${target}`);
        broken++;
      }
    }
  }
}

console.log(`${files.length} Markdown files, ${broken} broken links`);
process.exit(broken ? 1 : 0);
