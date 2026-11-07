// Rules behind tools/hygiene-lint.mjs: nothing private reaches the public repo. The lint stores no
// owner word, not even as a hash (a hash of a first name is reversed by any list of names): the
// owner-specific words and terms come at run time from the HYGIENE_DENY secret or the deny file
// outside the repository, and are never printed.
import { createHash } from "node:crypto";
import { lineLocator } from "./common.mjs";

export const RULE_NAME = "private-name";
export const RULE_DENY_TERM = "deny-term";
export const RULE_LIBRARY = "library-path";
export const RULE_LAN_IP = "lan-ip";
export const RULE_EMAIL = "email";
export const RULE_PROFILE = "user-profile-path";
export const RULE_DEVICE = "device-id";
export const RULE_SECRET_FILE = "secret-file";
export const RULE_DASH = "dash";

/** Vendored upstream code keeps its authors' e-mail addresses and punctuation; every other rule applies. */
export const VENDORED_EXEMPT_RULES = new Set([RULE_EMAIL, RULE_DASH]);

/** True for a tracked path inside vendored upstream code (third_party/). */
export function isVendored(relPath) {
  return relPath.startsWith("third_party/");
}

/** SHA-256 hex of the lower-cased token, the form deny-list words are compared in. */
export function tokenHash(token) {
  return createHash("sha256").update(token.toLowerCase()).digest("hex");
}

/**
 * Built-in forbidden words: none, on purpose. A hash of a name published in the lint is reversed by
 * a list of names, so every private word comes from the deny list (see parseDenyList).
 */
export const FORBIDDEN_WORD_HASHES = new Set();

/** Entries shorter than this are ignored: they would match all over the tree. */
export const MIN_DENY_LENGTH = 3;

/**
 * Parses HYGIENE_DENY (a CI secret, never in the repo): entries separated by commas or new lines.
 * - 64 hex digits: the SHA-256 of a lower-cased word, checked per word like the built-in name;
 * - letters only: hashed here and checked the same way (so it also matches inside camelCase);
 * - anything else (digits, spaces, punctuation: a serial, a model name, two words): matched as
 *   text, ignoring case, but not inside a longer word or number.
 * Returns { hashes: Set, terms: string[], ignored: number } (`ignored` = entries too short).
 */
export function parseDenyList(raw) {
  const hashes = new Set();
  const terms = [];
  let ignored = 0;
  for (const entry of String(raw ?? "").split(/[,\r\n]+/)) {
    const t = entry.trim();
    if (!t) continue;
    if (/^[0-9a-f]{64}$/i.test(t)) hashes.add(t.toLowerCase());
    else if (t.length < MIN_DENY_LENGTH) ignored++;
    else if (/^\p{L}+$/u.test(t)) hashes.add(tokenHash(t));
    else terms.push(t);
  }
  return { hashes, terms, ignored };
}

const REGEXP_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** A case-insensitive pattern for a deny-list term; whitespace inside it matches any whitespace. */
export function denyTermPattern(term) {
  const body = term
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(REGEXP_SYNTAX, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

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

// A path inside a Proton Drive sync folder, in any slash style or with URL-encoded spaces: the folder
// as a path component (a slash or backslash before it) with something below it, or a relative path
// at least two folders deep. No public file needs one, and a real library lives in one; the rule
// names no folder below Proton Drive, so it says nothing about where any library is. The name in
// prose, even followed by one slash and a word, is not a path (see the tests).
const LIBRARY_RE =
  /(?:(?<=[\\/])Proton(?:\s|%20)Drive[\\/]+(?=[^\\/\s"'`<>|)\]])|Proton(?:\s|%20)Drive[\\/]+[^\\/\r\n"'`<>|]+[\\/])/gi;

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

// A device serial only counts next to the words that name one, so hashes, ids and version strings
// elsewhere never match: `adb -s <serial>`, `adb --serial <serial>`, `ANDROID_SERIAL=<serial>`,
// `serialno: <serial>` (also ro.serialno and getprop's `[ro.serialno]: [<serial>]`),
// `serial number <serial>`, `serial: <serial>`. A serial is 6 to 20 letters and digits with at
// least one digit (checked after the match), so placeholders (`<serial>`, `$Serial`, `None`) and
// 64-hex hashes never match.
const SERIAL_RE =
  /(?:\badb(?:\.exe)?["']?\s+(?:-s|--serial)\s+["']?|\b(?:ANDROID_SERIAL|serial(?:no|_?number| number)?)\b[\s"'[\]:=]{0,6})([A-Za-z0-9]{6,20})(?![A-Za-z0-9_-])/gi;
// A line of `adb devices` output: "<serial>  device" (or unauthorized, offline, ...).
const ADB_LIST_RE =
  /^[ \t]*([A-Za-z0-9]{6,20})[ \t]+(?:device|unauthorized|offline|recovery|sideload|bootloader|no permissions)\b/gim;
// A 15-digit IMEI written after the word IMEI.
const IMEI_RE = /\bIMEI\b[^\d\n]{0,12}(\d{15})(?!\d)/gi;

/** True for a token that can be a device serial: 6 to 20 letters and digits, at least one digit. */
export function looksLikeSerial(token) {
  return /^[A-Za-z0-9]{6,20}$/.test(token) && /\d/.test(token);
}

// File names that hold signing keys, sessions or secrets, wherever they sit. .gitignore keeps them
// out; this catches a forced `git add -f`. Same list as the "Signing material" block of .gitignore.
const SECRET_FILE_NAMES = [
  /\.jks$/i,
  /\.keystore$/i,
  /\.p12$/i,
  /^keystore\.properties$/i,
  /^key\.properties$/i,
  /^cookies\.txt$/i,
  /^\.env$/i,
  /^\.env\..+$/i,
];

// En and em dashes, as characters or as HTML entities (named, decimal or hex, leading zeros
// allowed). Public text uses a hyphen, a colon or a comma instead: the long dashes read as
// machine-written, and some filters flag them. The patterns use escapes and never spell out a
// whole entity, so this file passes the rule it defines.
const DASH_RE = /[\u2013\u2014]|&(?:ndash|mdash|#0*821[12]|#x0*201[34]);/gi;
const EN_DASH_ENTITY_RE = /^&(?:ndash|#0*8211|#x0*2013);$/i;

/** Plain name of a dash match for messages: "en dash (U+2013)", "em dash (U+2014)" or the entity. */
export function dashLabel(match) {
  if (match === "\u2013") return "en dash (U+2013)";
  if (match === "\u2014") return "em dash (U+2014)";
  return `HTML entity ${match} (${EN_DASH_ENTITY_RE.test(match) ? "en" : "em"} dash)`;
}

/** True when a tracked file's name (the last path segment) marks a key, session or secret file. */
export function isSecretFileName(relPath) {
  const name = relPath.split(/[\\/]/).pop() ?? "";
  return SECRET_FILE_NAMES.some((re) => re.test(name));
}

/**
 * Hygiene findings in one file's text: [{ line, rule, message }]. Messages never repeat a
 * forbidden word, a deny-list term or a device id; other matches are shown so they can be found
 * and removed. `denyTerms` are HYGIENE_DENY entries matched as text (see parseDenyList).
 */
export function scanText(text, forbiddenHashes = FORBIDDEN_WORD_HASHES, denyTerms = []) {
  const line = lineLocator(text);
  const found = [];
  for (const t of wordTokens(text)) {
    if (forbiddenHashes.has(tokenHash(t.word))) {
      found.push({ index: t.index, rule: RULE_NAME, message: `forbidden word (${t.word.length} letters, redacted)` });
    }
  }
  for (const term of denyTerms) {
    for (const m of text.matchAll(denyTermPattern(term))) {
      found.push({ index: m.index, rule: RULE_DENY_TERM, message: `HYGIENE_DENY term (${m[0].length} characters, redacted)` });
    }
  }
  for (const m of text.matchAll(SERIAL_RE)) {
    if (!looksLikeSerial(m[1])) continue;
    found.push({ index: m.index, rule: RULE_DEVICE, message: `device serial (${m[1].length} characters, redacted)` });
  }
  for (const m of text.matchAll(ADB_LIST_RE)) {
    if (!looksLikeSerial(m[1])) continue;
    found.push({ index: m.index, rule: RULE_DEVICE, message: `adb devices line with a serial (${m[1].length} characters, redacted)` });
  }
  for (const m of text.matchAll(IMEI_RE)) {
    found.push({ index: m.index, rule: RULE_DEVICE, message: "IMEI (15 digits, redacted)" });
  }
  for (const m of text.matchAll(LIBRARY_RE)) {
    found.push({ index: m.index, rule: RULE_LIBRARY, message: "a path inside a Proton Drive folder: say \"the library root\"" });
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
  for (const m of text.matchAll(DASH_RE)) {
    found.push({ index: m.index, rule: RULE_DASH, message: `${dashLabel(m[0])}: write a hyphen, a colon or a comma` });
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

/**
 * Findings for one tracked path itself, binaries included: a key, session or secret file name,
 * and the text rules applied to the path. Reported on line 0 (the whole file).
 */
export function scanPath(relPath, forbiddenHashes = FORBIDDEN_WORD_HASHES, denyTerms = []) {
  const out = [];
  if (isSecretFileName(relPath)) {
    out.push({
      line: 0,
      rule: RULE_SECRET_FILE,
      message: "a key, session or secret file: `git rm --cached` it and keep it outside the repository",
    });
  }
  for (const f of scanText(relPath, forbiddenHashes, denyTerms)) {
    out.push({ line: 0, rule: f.rule, message: `in the file path: ${f.message}` });
  }
  return out;
}
