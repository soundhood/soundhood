// Rules behind tools/contrast-lint.mjs (brief §6, accessibility): WCAG 2.x contrast of every
// (foreground, background) token pair the design system uses together. Text needs 4.5:1, a UI
// boundary that is the only mark of a state needs 3:1. Pure functions over the CSS text of
// app/src/design/tokens.css, so every rule is unit-tested with synthetic values.

/**
 * The pairs to check. Each row: foreground tokens, background tokens, the minimum ratio (null =
 * reported, never fails), the kind of use, and why. Every fg is checked against every bg of its row,
 * in the default values and in the `prefers-contrast: more` values.
 */
export const RULES = [
  {
    fg: ["--fg-0", "--fg-1", "--aqua", "--lilac", "--danger", "--warn"],
    bg: ["--bg-0", "--bg-1", "--bg-2"],
    min: 4.5,
    kind: "text",
    why: "text colours on the canvas, sheets and cards, and inputs and chips (WCAG 1.4.3)",
  },
  {
    fg: ["--aqua-ink"],
    bg: ["--aqua", "--danger"],
    min: 4.5,
    kind: "text",
    why: "the label on an aqua-filled button and on a danger fill",
  },
  {
    fg: ["--fg-0"],
    bg: ["--purple"],
    min: 4.5,
    kind: "text",
    why: "white text on a purple badge",
  },
  {
    fg: ["--fg-2", "--fg-disabled"],
    bg: ["--bg-0", "--bg-1", "--bg-2"],
    min: null,
    kind: "non-text",
    why: "tokens.css declares them non-text (inactive handles, separators, disabled controls), so only reported",
  },
  {
    fg: ["--lilac"],
    bg: ["--bg-3", "--bg-1"],
    min: 3,
    kind: "boundary",
    why: "tokens.css names lilac the slider knob, the mark of the position on the bg-3 track (WCAG 1.4.11)",
  },
  {
    fg: ["--purple"],
    bg: ["--bg-3", "--bg-1"],
    min: null,
    kind: "boundary",
    why: "the slider fill: tokens.css says purple never carries meaning alone (the lilac knob marks the position), so only reported",
  },
];

/** The token every translucent background is laid over: the app canvas. */
export const CANVAS = "--bg-0";

/** Matches the media condition of the more-contrast block. */
const MORE_CONTRAST_RE = /prefers-contrast\s*:\s*more/;

/** `text` with CSS comments blanked to spaces (offsets kept). */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

/**
 * Every rule block of a stylesheet: [{ prelude, parents, body }], where `prelude` is the selector
 * or at-rule text before `{`, `parents` the preludes of the blocks around it (outermost first) and
 * `body` the text between its braces. Strings are skipped; comments must be stripped first.
 */
export function cssBlocks(text) {
  const out = [];
  let i = 0;
  const level = (parents) => {
    let start = i;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") {
        i++;
        while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
        i++;
        continue;
      }
      if (c === "{") {
        const prelude = text.slice(start, i).trim();
        i++;
        const bodyStart = i;
        level([...parents, prelude]);
        out.push({ prelude, parents, body: text.slice(bodyStart, Math.max(bodyStart, i - 1)) });
        start = i;
        continue;
      }
      if (c === "}") {
        i++;
        return;
      }
      if (c === ";") start = i + 1;
      i++;
    }
  };
  level([]);
  return out;
}

/** Splits `text` at `sep` characters outside parentheses and strings. */
export function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The custom properties declared in one block body: Map(name -> value). */
export function customProperties(body) {
  const out = new Map();
  for (const decl of splitTopLevel(body, ";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    out.set(name, decl.slice(colon + 1).replace(/!important\s*$/i, "").trim());
  }
  return out;
}

/**
 * The token values of a stylesheet in each mode: `default` from the `:root` blocks outside any
 * at-rule, `more` from those plus the `:root` blocks inside `@media (prefers-contrast: more)` (later
 * declarations win, as in the browser). `hasMore` says whether such a block exists.
 */
export function tokenModes(css) {
  const blocks = cssBlocks(stripComments(css)).filter((b) => b.prelude === ":root");
  const base = new Map();
  const more = new Map();
  let hasMore = false;
  for (const b of blocks) {
    if (b.parents.length === 0) {
      for (const [k, v] of customProperties(b.body)) base.set(k, v);
    }
  }
  for (const b of blocks) {
    if (b.parents.length === 1 && MORE_CONTRAST_RE.test(b.parents[0])) {
      hasMore = true;
      for (const [k, v] of customProperties(b.body)) more.set(k, v);
    }
  }
  return { default: base, more: new Map([...base, ...more]), hasMore };
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** `value` with every `var(--x[, fallback])` replaced by the token's value, recursively. */
export function resolveVars(value, tokens, seen = new Set()) {
  let out = value;
  for (let at = out.indexOf("var("); at >= 0; at = out.indexOf("var(")) {
    const close = closingParen(out, at + 3);
    if (close < 0) throw new Error(`unbalanced var() in "${value}"`);
    const [name, ...fallback] = splitTopLevel(out.slice(at + 4, close), ",");
    const key = name.trim();
    let sub;
    if (tokens.has(key)) {
      if (seen.has(key)) throw new Error(`${key} refers to itself`);
      sub = resolveVars(tokens.get(key), tokens, new Set([...seen, key]));
    } else if (fallback.length) {
      sub = resolveVars(fallback.join(",").trim(), tokens, seen);
    } else {
      throw new Error(`${key} is not defined`);
    }
    out = out.slice(0, at) + sub + out.slice(close + 1);
  }
  return out;
}

const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
};

/** A colour as { r, g, b, a }: sRGB channels and alpha in 0..1. */
const rgba = (r, g, b, a = 1) => ({ r, g, b, a });

function parseHex(hex) {
  const h = hex.slice(1);
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const n = (i) => parseInt(full.slice(i, i + 2), 16) / 255;
  return rgba(n(0), n(2), n(4), full.length === 8 ? n(6) : 1);
}

/** A channel of rgb(): a number 0..255 or a percentage. */
function channel(s) {
  const t = s.trim();
  if (t.endsWith("%")) return clamp01(parseFloat(t) / 100);
  return clamp01(parseFloat(t) / 255);
}

/** An alpha value: a number 0..1 or a percentage. */
function alphaOf(s) {
  const t = s.trim();
  return clamp01(t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t));
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function parseRgbFunction(args) {
  let parts;
  let alpha = "1";
  if (args.includes(",")) {
    parts = args.split(",");
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const [rgb, a] = args.split("/");
    parts = rgb.trim().split(/\s+/);
    if (a !== undefined) alpha = a;
  }
  if (parts.length !== 3) throw new Error(`cannot read rgb(${args})`);
  const [r, g, b] = parts.map(channel);
  return rgba(r, g, b, alphaOf(alpha));
}

/**
 * Parses one CSS colour after var() resolution: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() in
 * comma or space syntax, `transparent`, `black`, `white`, and color-mix() in oklab or srgb.
 * Throws on anything else, so an unreadable token is reported, never guessed.
 */
export function parseColor(value) {
  const v = value.trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return parseHex(v);
  if (v in NAMED) return rgba(...NAMED[v]);
  const fn = /^([a-z-]+)\(/.exec(v);
  if (fn && closingParen(v, fn[0].length - 1) === v.length - 1) {
    const args = v.slice(fn[0].length, -1);
    if (fn[1] === "rgb" || fn[1] === "rgba") return parseRgbFunction(args);
    if (fn[1] === "color-mix") return colorMix(args);
  }
  throw new Error(`not a colour this lint can read: "${value}"`);
}

// sRGB transfer function and OKLab (Bjorn Ottosson's matrices, as in CSS Color 4).
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLab [L, a, b] of an sRGB colour (alpha ignored). */
export function toOklab({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** sRGB { r, g, b } (gamma-encoded, clamped to the gamut) of an OKLab [L, a, b]. */
export function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, b] = lin.map((c) => clamp01(toGamma(clamp01(c))));
  return { r, g, b };
}

/** One color-mix() argument: a colour and an optional percentage, in either order. */
function mixPart(text) {
  const t = text.trim();
  const after = /\s([\d.]+)%$/.exec(t);
  if (after) return { colour: parseColor(t.slice(0, after.index)), pct: parseFloat(after[1]) };
  const before = /^([\d.]+)%\s/.exec(t);
  if (before) return { colour: parseColor(t.slice(before[0].length)), pct: parseFloat(before[1]) };
  return { colour: parseColor(t), pct: null };
}

/**
 * color-mix(in oklab|srgb, c1 [p1%], c2 [p2%]) as CSS Color 5 defines it: percentages normalised
 * to a sum of 100 (a missing one is 100 minus the other, both missing is 50/50), premultiplied
 * alpha interpolation, and an alpha multiplier when the percentages sum to less than 100.
 */
export function colorMix(args) {
  const [space, a, b, ...extra] = splitTopLevel(args, ",");
  const where = /^in\s+(oklab|srgb)$/.exec(space.trim());
  if (!where || b === undefined || extra.length) throw new Error(`unsupported color-mix(${args})`);
  const p = mixPart(a);
  const q = mixPart(b);
  let p1 = p.pct;
  let p2 = q.pct;
  if (p1 === null && p2 === null) p1 = p2 = 50;
  else if (p1 === null) p1 = 100 - p2;
  else if (p2 === null) p2 = 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) throw new Error(`color-mix percentages sum to 0: ${args}`);
  const w1 = p1 / sum;
  const w2 = p2 / sum;
  const alpha = p.colour.a * w1 + q.colour.a * w2;
  const multiplier = sum < 100 ? sum / 100 : 1;
  if (alpha === 0) return rgba(0, 0, 0, 0);
  const coords = where[1] === "oklab" ? toOklab : ({ r, g, b }) => [r, g, b];
  const back = where[1] === "oklab" ? fromOklab : ([r, g, b]) => ({ r, g, b });
  const c1 = coords(p.colour);
  const c2 = coords(q.colour);
  const mixed = c1.map((v, i) => (v * p.colour.a * w1 + c2[i] * q.colour.a * w2) / alpha);
  const { r, g, b: blue } = back(mixed);
  return rgba(r, g, blue, alpha * multiplier);
}

/** `top` laid over the opaque `bottom` with source-over blending in sRGB, as the browser paints. */
export function over(top, bottom) {
  const k = top.a;
  return rgba(top.r * k + bottom.r * (1 - k), top.g * k + bottom.g * (1 - k), top.b * k + bottom.b * (1 - k), 1);
}

/** WCAG 2.x relative luminance of an opaque sRGB colour. */
export function luminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(x, y) {
  const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour of a token in `tokens`, resolved and parsed. */
export function tokenColour(tokens, name) {
  if (!tokens.has(name)) throw new Error(`${name} is not defined`);
  return parseColor(resolveVars(tokens.get(name), tokens, new Set([name])));
}

/**
 * The ratio `fg` reaches on `bg`: a translucent background is laid over the canvas token first, a
 * translucent foreground over that background.
 */
export function pairRatio(tokens, fg, bg) {
  let back = tokenColour(tokens, bg);
  if (back.a < 1) {
    const canvas = tokenColour(tokens, CANVAS);
    if (canvas.a < 1) throw new Error(`${CANVAS} must be opaque: it is what translucent backgrounds sit on`);
    back = over(back, canvas);
  }
  return contrastRatio(over(tokenColour(tokens, fg), back), back);
}

/**
 * Checks every pair of `rules` in every mode of `css`: [{ mode, fg, bg, ratio, min, kind, why,
 * verdict, error }], verdict "pass", "fail", "report" (no minimum) or "error" (a token missing or
 * unreadable). The `more` mode runs only when the stylesheet has a more-contrast block.
 */
export function checkContrast(css, rules = RULES) {
  const modes = tokenModes(css);
  const rows = [];
  for (const mode of modes.hasMore ? ["default", "more"] : ["default"]) {
    const tokens = modes[mode];
    for (const rule of rules) {
      for (const fg of rule.fg) {
        for (const bg of rule.bg) {
          const row = { mode, fg, bg, min: rule.min, kind: rule.kind, why: rule.why, ratio: null, verdict: "", error: "" };
          try {
            row.ratio = pairRatio(tokens, fg, bg);
            row.verdict = rule.min === null ? "report" : row.ratio >= rule.min ? "pass" : "fail";
          } catch (e) {
            row.verdict = "error";
            row.error = e.message;
          }
          rows.push(row);
        }
      }
    }
  }
  return { hasMore: modes.hasMore, rows };
}

/**
 * A ratio as printed: truncated (never rounded up) to two decimals, so a printed 4.50 always
 * passes 4.5.
 */
export function formatRatio(ratio) {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}
