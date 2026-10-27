// Rules behind tools/hygiene-lint.mjs: nothing private reaches the public repo. Forbidden words
// are stored only as SHA-256 hashes, so the lint itself never publishes what it guards.
import { createHash } from "node:crypto";
import { lineLocator } from "./common.mjs";

export const RULE_NAME = "private-name";
export const RULE_LIBRARY = "library-path";
export const RULE_LAN_IP = "lan-ip";
export const RULE_EMAIL = "email";
export const RULE_PROFILE = "user-profile-path";

/** SHA-256 hex of the lower-cased token, the only form a forbidden word is kept in. */
export function tokenHash(token) {
  return createHash("sha256").update(token.toLowerCase()).digest("hex");
}

/** Hashes of words that must never appear in the repo: the owner's first name. */
export const FORBIDDEN_WORD_HASHES = new Set(["4097889236a2af26c293033feb964c4cf118c0224e0d063fec0a89e9d0569ef2"]);

/**
 * Word tokens of `text`: every run of letters, plus its camelCase parts when it has any
 * ("JohnSmith" -> "JohnSmith", "John", "Smith"). Digits, underscores and punctuation split words.
 */
export function wordTokens(text) {
  const out = [];
  for (const m of text.matchAll(/\p{L}+/gu)) {
    out.push({ word: m[0], index: m.index });
    const parts = [...m[0].matchAll(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})/gu)];
    if (parts.length > 1) for (const p of parts) out.push({ word: p[0], index: m.index + p.index });
  }
  return out;
}

// The owner's library root on the PC (a folder inside the Proton Drive sync folder), in
// any slash style. The pattern is spelled with classes so this file never contains the path.
const LIBRARY_RE = /Proton(?:\s|%20)Drive[\\/]+Shared[\\/]+Albums/gi;

// Dotted quads not embedded in a longer dotted number (1.10.0.0.1) or a word (v10.0.0.1).
const IPV4_RE = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)/g;

/** True for an RFC 1918 address: 10/8, 172.16/12, 192.168/16. */
export function isPrivateIpv4(octets) {
  const [a, b] = octets;
  if (octets.some((o) => o > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const EMAIL_RE = /(?<![\w.%+-])[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
// "icon@2x.png" and friends are file names, not addresses.
const FILE_EXT_RE = /\.(?:png|jpe?g|gif|svg|webp|ico|icns|bmp|pdf|js|mjs|ts|tsx|css|json|md|html?)$/i;

/** True for addresses the repo may carry: GitHub noreply, the commit trailer, example domains. */
export function isAllowedEmail(email) {
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1).toLowerCase();
  return (
    domain === "users.noreply.github.com" ||
    email.toLowerCase() === "noreply@anthropic.com" ||
    /(?:^|\.)example\.[a-z]+$/.test(domain)
  );
}

// C:\Users\<name>, C:\\Users\\<name> (escaped), C:/Users/<name>, /c/Users/<name>, /mnt/c/Users/<name>.
const PROFILE_RE = /(?:\b[A-Za-z]:|(?<![\w])(?:\/mnt)?\/[a-zA-Z])(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)([^\\/\s"'`<>|:*?,;)\]]+)/gi;
const PROFILE_PLACEHOLDERS = new Set([
  "public",
  "default",
  "default user",
  "all users",
  "runneradmin",
  "user",
  "username",
  "you",
  "yourname",
  "name",
  "me",
]);

/** True when the user-folder name is a placeholder (`%USERNAME%`, `$env:USERNAME`, `{user}`, Public). */
export function isProfilePlaceholder(name) {
  return /^[%${]/.test(name) || PROFILE_PLACEHOLDERS.has(name.toLowerCase());
}

/**
 * Hygiene findings in one file's text: [{ line, rule, message }]. Messages never repeat a
 * forbidden word; other matches are shown so they can be found and removed.
 */
export function scanText(text, forbiddenHashes = FORBIDDEN_WORD_HASHES) {
  const line = lineLocator(text);
  const found = [];
  for (const t of wordTokens(text)) {
    if (forbiddenHashes.has(tokenHash(t.word))) {
      found.push({ index: t.index, rule: RULE_NAME, message: `forbidden word (${t.word.length} letters, redacted)` });
    }
  }
  for (const m of text.matchAll(LIBRARY_RE)) {
    found.push({ index: m.index, rule: RULE_LIBRARY, message: "the owner's library path: say \"the library root\"" });
  }
  for (const m of text.matchAll(IPV4_RE)) {
    const octets = m.slice(1, 5).map(Number);
    if (isPrivateIpv4(octets)) found.push({ index: m.index, rule: RULE_LAN_IP, message: `private LAN address ${m[0]}` });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    if (FILE_EXT_RE.test(m[0]) || isAllowedEmail(m[0])) continue;
    found.push({ index: m.index, rule: RULE_EMAIL, message: `e-mail address ${m[0]}` });
  }
  for (const m of text.matchAll(PROFILE_RE)) {
    if (isProfilePlaceholder(m[1])) continue;
    found.push({ index: m.index, rule: RULE_PROFILE, message: "Windows user-profile path: use %USERPROFILE% or a placeholder" });
  }
  // Same position reported once per rule (a camelCase part shares its word's index).
  const seen = new Set();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((f) => {
      const key = `${f.index}:${f.rule}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f) => ({ line: line(f.index), rule: f.rule, message: f.message }));
}
