// Rules behind tools/token-lint.mjs (brief §6): raw hex colours outside the token file, native
// control appearance, and emoji / pictograph glyphs in TSX. Pure functions over file text, so
// every rule is unit-tested without touching the repo.
import { codePointLabel, lineLocator } from "./common.mjs";

export const RULE_RAW_HEX = "raw-hex";
export const RULE_APPEARANCE = "appearance";
export const RULE_GLYPH = "emoji-glyph";

/** The one file allowed to contain raw hex colours. */
export const TOKENS_FILE = "app/src/design/tokens.css";

// #rgb, #rgba, #rrggbb, #rrggbbaa not glued to a word, an HTML entity (&#123;), a private class
// field (this.#cafe) or an id-like name (#add-row).
const HEX_RE = /(?<![\w&.#$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

/** Every raw hex colour in `text`: [{ index, match }]. */
export function findRawHex(text) {
  return [...text.matchAll(HEX_RE)].map((m) => ({ index: m.index, match: m[0] }));
}

// The brief's glyph ranges: pictographs/emoji, Misc Symbols + Dingbats, Misc Symbols and Arrows.
const GLYPH_RANGES = [
  [0x1f000, 0x1faff],
  [0x2600, 0x27bf],
  [0x2b00, 0x2bff],
];

/** True for a code point the UI must draw as an SVG icon instead of a font glyph. */
export function isForbiddenGlyph(cp) {
  return GLYPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

// Escaped spellings that render the same glyph: \u{1F50A}, a 🔊 surrogate pair,
// ✓, &#x2713; and &#10003;.
const ESCAPE_RE =
  /\\u\{([0-9a-fA-F]{1,6})\}|\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|&#[xX]([0-9a-fA-F]{1,6});|&#(\d{1,7});/g;

/** Every forbidden glyph in `text`, literal or escaped: [{ index, codePoint, match }]. */
export function findGlyphs(text) {
  const out = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const len = cp > 0xffff ? 2 : 1;
    if (isForbiddenGlyph(cp)) out.push({ index: i, codePoint: cp, match: text.slice(i, i + len) });
    i += len;
  }
  for (const m of text.matchAll(ESCAPE_RE)) {
    let cp;
    if (m[1]) cp = parseInt(m[1], 16);
    else if (m[2]) cp = 0x10000 + ((parseInt(m[2], 16) - 0xd800) << 10) + (parseInt(m[3], 16) - 0xdc00);
    else if (m[4]) cp = parseInt(m[4], 16);
    else if (m[5]) cp = parseInt(m[5], 16);
    else cp = parseInt(m[6], 10);
    if (isForbiddenGlyph(cp)) out.push({ index: m.index, codePoint: cp, match: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

// `appearance` in CSS (any vendor prefix) or in a React style object (WebkitAppearance, ...).
const APPEARANCE_RE = /(?<![\w-])(?:-webkit-|-moz-|Webkit|Moz)?[aA]ppearance\s*:\s*["'`]?([\w-]+)/g;
// Declarations that make a control with `appearance: none` custom-styled rather than bare.
const CUSTOM_STYLE_RE =
  /(?<![\w-])(?:background|border|box-shadow|boxShadow|outline|color|width|height|mask|fill|stroke|display)/;
// Native decorations that `appearance: none` legitimately just hides (search clear button, spinners).
const DECORATION_RE =
  /::-webkit-(?:search-[\w-]+|inner-spin-button|outer-spin-button|calendar-picker-indicator|clear-button)|::-ms-/;

/**
 * Innermost `{ ... }` blocks of `text` with their `appearance` declarations:
 * [{ selector, body, bodyIndex, appearance: [{ value, index }] }]. Works on stylesheets and on
 * TSX (CSS in template strings, React style objects); nested @media blocks flatten naturally.
 */
export function cssBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    const bodyIndex = m.index + m[1].length + 1;
    const body = m[2];
    const appearance = [...body.matchAll(APPEARANCE_RE)].map((a) => ({
      value: a[1].toLowerCase(),
      index: bodyIndex + a.index,
    }));
    out.push({ selector: m[1].trim(), body, bodyIndex, appearance });
  }
  return out;
}

/** Class names in the last compound of each selector in a list (`.app .range, .x` -> range, x). */
export function lastCompoundClasses(selector) {
  const out = [];
  for (const part of selector.split(",")) {
    const last = part.trim().split(/[\s>+~]+/).pop() ?? "";
    for (const m of last.matchAll(/\.([\w-]+)/g)) out.push(m[1]);
  }
  return out;
}

// Index just past the first `stop` character found at brace depth 0 after `start`, skipping
// quoted strings; text.length when there is none.
function scanTo(text, start, stop) {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (stop === "}" && depth === 0) return i + 1;
    } else if (c === stop && depth === 0) return i + 1;
  }
  return text.length;
}

/** End (exclusive) of the JSX/HTML opening tag that starts at `start`, honouring {...} and quotes. */
export function openingTagEnd(text, start) {
  return scanTo(text, start + 1, ">");
}

/** The static class names a JSX `className` can take: every string literal inside the attribute. */
export function classNamesOf(tag) {
  const at = /\bclassName\s*=\s*/.exec(tag);
  if (!at) return [];
  const rest = tag.slice(at.index + at[0].length);
  let value;
  if (rest[0] === '"' || rest[0] === "'") {
    const end = rest.indexOf(rest[0], 1);
    value = rest.slice(0, end < 0 ? rest.length : end + 1);
  } else if (rest[0] === "{") {
    value = rest.slice(0, scanTo(rest, 0, "}"));
  } else {
    return [];
  }
  const names = [];
  const add = (s) => {
    for (const n of s.split(/\s+/)) if (/^[\w-]+$/.test(n)) names.push(n);
  };
  // Quoted strings anywhere (also inside ${...}), then the static parts of template literals.
  for (const m of value.matchAll(/"([^"]*)"|'([^']*)'/g)) add(m[1] ?? m[2]);
  for (const m of value.matchAll(/`([^`]*)`/g)) add(m[1].replace(/\$\{[^}]*\}/g, " "));
  return names;
}

const CONTROL_TAG_RE = /<(input|select|progress|meter)(?=[\s/>])/g;
const STRIPPED_INPUT_TYPES = new Set(["range", "checkbox", "radio"]);

/** `text` with comments blanked to spaces (offsets kept), so markup named in a comment is not judged. */
export function blankComments(text) {
  // "//" right after ":" is a URL scheme, not a comment.
  return text.replace(/\/\*[\s\S]*?\*\/|(?<![:\\])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
}

/**
 * Appearance problems in one file: [{ index, message }]. Three cases, all "a control that
 * shows its native look": an `appearance` value other than `none`; `appearance: none` with no
 * custom styling in the same rule; a range/checkbox/radio input, select, progress or meter in
 * markup with no class that sets `appearance: none` (`strippedClasses`, gathered across files).
 */
export function appearanceIssues(text, blocks, strippedClasses) {
  const out = [];
  for (const b of blocks) {
    for (const d of b.appearance) {
      if (d.value !== "none") {
        out.push({ index: d.index, message: `appearance: ${d.value} keeps the native control look` });
      }
    }
    if (b.appearance.some((d) => d.value === "none") && !DECORATION_RE.test(b.selector)) {
      const rest = b.body.replace(APPEARANCE_RE, "");
      if (!CUSTOM_STYLE_RE.test(rest)) {
        out.push({
          index: b.appearance[0].index,
          message: "appearance: none without custom styling in the same rule (bare control)",
        });
      }
    }
  }
  const code = blankComments(text);
  for (const m of code.matchAll(CONTROL_TAG_RE)) {
    const tag = code.slice(m.index, openingTagEnd(code, m.index));
    let what = `<${m[1]}>`;
    if (m[1] === "input") {
      // Only literal types are judged; a type chosen at runtime cannot be checked statically.
      const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/.exec(tag);
      const t = type ? (type[1] ?? type[2] ?? type[3]).toLowerCase() : "";
      if (!STRIPPED_INPUT_TYPES.has(t)) continue;
      what = `<input type="${t}">`;
    }
    if (!classNamesOf(tag).some((c) => strippedClasses.has(c))) {
      out.push({ index: m.index, message: `${what} has no class with appearance: none (native control styling)` });
    }
  }
  return out;
}

/**
 * Runs every token rule over `files` ([{ file, text }], repo-relative paths) and returns
 * findings [{ file, line, rule, message }], ordered by file then line.
 */
export function lintTokens(files) {
  const parsed = files.map((f) => ({ ...f, blocks: cssBlocks(f.text) }));
  const strippedClasses = new Set();
  for (const f of parsed) {
    for (const b of f.blocks) {
      if (b.appearance.some((d) => d.value === "none")) {
        for (const c of lastCompoundClasses(b.selector)) strippedClasses.add(c);
      }
    }
  }
  const findings = [];
  for (const { file, text, blocks } of parsed) {
    const line = lineLocator(text);
    const local = [];
    if (file !== TOKENS_FILE) {
      for (const h of findRawHex(text)) {
        local.push({ index: h.index, rule: RULE_RAW_HEX, message: `raw colour ${h.match}: use a token from ${TOKENS_FILE}` });
      }
    }
    for (const a of appearanceIssues(text, blocks, strippedClasses)) {
      local.push({ index: a.index, rule: RULE_APPEARANCE, message: a.message });
    }
    if (file.endsWith(".tsx")) {
      for (const g of findGlyphs(text)) {
        local.push({
          index: g.index,
          rule: RULE_GLYPH,
          message: `${codePointLabel(g.codePoint)} ${JSON.stringify(g.match)}: draw it as an SVG icon`,
        });
      }
    }
    local.sort((a, b) => a.index - b.index);
    for (const f of local) findings.push({ file, line: line(f.index), rule: f.rule, message: f.message });
  }
  return findings;
}
