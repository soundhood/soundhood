import { describe, expect, it } from "vitest";
import {
  RULES,
  checkContrast,
  colorMix,
  contrastRatio,
  cssBlocks,
  customProperties,
  formatRatio,
  fromOklab,
  luminance,
  over,
  pairRatio,
  parseColor,
  resolveVars,
  splitTopLevel,
  stripComments,
  toOklab,
  tokenModes,
} from "./contrast.mjs";

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const rgb = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });
const tokens = (obj) => new Map(Object.entries(obj));

describe("parsing the token file", () => {
  const css = `
    /* --fg-0: #ff0000; in a comment is not a token */
    @font-face { font-family: "X"; src: url("a;b{c}.woff2"); }
    :root {
      color-scheme: dark;
      --bg-0: #000;
      --fg-0: #ffffff; /* trailing comment */
      --font: "A; B", sans-serif;
      --mix: color-mix(in oklab, var(--fg-0) 50%, transparent)
    }
    @media (pointer: coarse) { :root { --fg-0: #111111; } }
    @media (prefers-contrast: more) {
      :root { --fg-1: #cccccc; --fg-0: #eeeeee !important; }
    }
    .x :root { --bg-0: #333333; }
  `;

  it("finds blocks with their nesting, skipping strings", () => {
    const blocks = cssBlocks(stripComments(css));
    expect(blocks.map((b) => b.prelude)).toContain("@font-face");
    const nested = blocks.filter((b) => b.prelude === ":root" && b.parents.length === 1);
    expect(nested.map((b) => b.parents[0])).toEqual(["@media (pointer: coarse)", "@media (prefers-contrast: more)"]);
  });

  it("reads custom properties, ignoring other declarations and splitting only at top level", () => {
    const props = customProperties('color: red; --a: rgb(1, 2, 3); --b: "x;y"; --c: var(--a, rgb(0 0 0 / 50%))');
    expect([...props.keys()]).toEqual(["--a", "--b", "--c"]);
    expect(props.get("--c")).toBe("var(--a, rgb(0 0 0 / 50%))");
    expect(splitTopLevel("a(b,c),d", ",")).toEqual(["a(b,c)", "d"]);
  });

  it("builds the default and the more-contrast values; other media blocks and selectors do not count", () => {
    const modes = tokenModes(css);
    expect(modes.hasMore).toBe(true);
    expect(modes.default.get("--fg-0")).toBe("#ffffff");
    expect(modes.default.get("--bg-0")).toBe("#000");
    expect(modes.default.has("--fg-1")).toBe(false);
    expect(modes.more.get("--fg-0")).toBe("#eeeeee");
    expect(modes.more.get("--fg-1")).toBe("#cccccc");
    expect(modes.more.get("--bg-0")).toBe("#000");
  });

  it("says when there is no more-contrast block", () => {
    expect(tokenModes(":root { --a: #fff; }").hasMore).toBe(false);
  });
});

describe("resolving values", () => {
  it("replaces var() recursively and uses fallbacks", () => {
    const t = tokens({ "--a": "#123456", "--b": "var(--a)", "--c": "var(--missing, var(--b))" });
    expect(resolveVars("var(--c)", t)).toBe("#123456");
  });

  it("refuses undefined and self-referencing tokens", () => {
    expect(() => resolveVars("var(--nope)", tokens({}))).toThrow(/--nope is not defined/);
    expect(() => resolveVars("var(--a)", tokens({ "--a": "var(--b)", "--b": "var(--a)" }))).toThrow(/refers to itself/);
  });

  it("parses hex, rgb() in both syntaxes and named colours", () => {
    expect(parseColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("#00000080").a).toBeCloseTo(128 / 255);
    expect(parseColor("#0f0f")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(parseColor("rgba(255, 255, 255, 0.08)")).toEqual({ r: 1, g: 1, b: 1, a: 0.08 });
    expect(parseColor("rgb(0 255 0 / 50%)")).toEqual({ r: 0, g: 1, b: 0, a: 0.5 });
    expect(parseColor("transparent").a).toBe(0);
    expect(() => parseColor("hsl(0 0% 0%)")).toThrow(/not a colour/);
    expect(() => parseColor("#12")).toThrow(/not a colour/);
  });

  it("round-trips sRGB through OKLab", () => {
    for (const c of [rgb(0, 255, 191), rgb(140, 25, 255), rgb(15, 15, 15)]) {
      const back = fromOklab(toOklab(c));
      expect(close(back.r, c.r) && close(back.g, c.g) && close(back.b, c.b)).toBe(true);
    }
    // White is L = 1, a = b = 0.
    const [L, a, b] = toOklab(rgb(255, 255, 255));
    expect(close(L, 1) && close(a, 0) && close(b, 0)).toBe(true);
  });

  it("mixes with transparent into the same colour at that alpha", () => {
    const m = colorMix("in oklab, #00ffbf 18%, transparent");
    expect(m.a).toBeCloseTo(0.18);
    expect(close(m.r, 0) && close(m.g, 1) && close(m.b, 191 / 255)).toBe(true);
  });

  it("normalises percentages and applies the alpha multiplier below 100", () => {
    const half = colorMix("in srgb, #000000, #ffffff");
    expect(half.r).toBeCloseTo(0.5);
    expect(colorMix("in srgb, #000000 25%, #ffffff").r).toBeCloseTo(0.75);
    expect(colorMix("in srgb, 25% #000000, #ffffff 25%").a).toBeCloseTo(0.5);
    expect(() => colorMix("in hsl, red, blue")).toThrow(/unsupported/);
  });
});

describe("WCAG contrast", () => {
  it("matches the reference values", () => {
    expect(luminance(rgb(255, 255, 255))).toBeCloseTo(1);
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21);
    expect(contrastRatio(rgb(255, 255, 255), rgb(0, 0, 0))).toBeCloseTo(21);
    // #777777 on white is the classic just-below-AA grey: 4.48.
    expect(contrastRatio(rgb(0x77, 0x77, 0x77), rgb(255, 255, 255))).toBeCloseTo(4.48, 2);
  });

  it("lays a translucent colour over its background", () => {
    expect(over({ r: 1, g: 1, b: 1, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it("puts a translucent background on the canvas first", () => {
    const t = tokens({ "--bg-0": "#000000", "--veil": "rgba(255, 255, 255, 0.5)", "--fg": "#ffffff" });
    const grey = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    expect(pairRatio(t, "--fg", "--veil")).toBeCloseTo(contrastRatio(rgb(255, 255, 255), grey));
    expect(() => pairRatio(tokens({ "--bg-0": "transparent", "--fg": "#fff", "--b": "transparent" }), "--fg", "--b")).toThrow(
      /must be opaque/,
    );
  });

  it("prints ratios truncated, never rounded up past a threshold", () => {
    expect(formatRatio(4.4999)).toBe("4.49");
    expect(formatRatio(21)).toBe("21.00");
  });
});

describe("checkContrast", () => {
  const rules = [
    { fg: ["--fg-0", "--fg-1"], bg: ["--bg-0"], min: 4.5, kind: "text", why: "text" },
    { fg: ["--fg-2"], bg: ["--bg-0"], min: null, kind: "non-text", why: "reported" },
    { fg: ["--knob"], bg: ["--bg-0"], min: 3, kind: "boundary", why: "knob" },
  ];
  const css = `
    :root { --bg-0: #000000; --fg-0: #ffffff; --fg-1: #575757; --fg-2: #222222; --knob: var(--fg-0); }
    @media (prefers-contrast: more) { :root { --fg-1: #808080; } }
  `;

  it("checks every pair in both modes and gives each a verdict", () => {
    const { hasMore, rows } = checkContrast(css, rules);
    expect(hasMore).toBe(true);
    const verdicts = rows.map((r) => `${r.mode} ${r.fg} ${r.verdict}`);
    expect(verdicts).toEqual([
      "default --fg-0 pass",
      "default --fg-1 fail",
      "default --fg-2 report",
      "default --knob pass",
      "more --fg-0 pass",
      "more --fg-1 pass",
      "more --fg-2 report",
      "more --knob pass",
    ]);
  });

  it("fails a boundary below 3:1 and reports a missing token as an error", () => {
    const dim = ":root { --bg-0: #000000; --fg-0: #ffffff; --fg-1: #ffffff; --fg-2: #111111; --knob: #444444; }";
    const rows = checkContrast(dim, rules).rows;
    expect(rows.find((r) => r.fg === "--knob").verdict).toBe("fail");
    const missing = checkContrast(":root { --bg-0: #000; --fg-0: #fff; }", rules).rows;
    expect(missing.find((r) => r.fg === "--fg-1")).toMatchObject({ verdict: "error", error: "--fg-1 is not defined" });
  });

  it("has a rule table where every row says why and enforced rows use the WCAG minimums", () => {
    for (const r of RULES) {
      expect(r.why.length).toBeGreaterThan(10);
      expect([null, 3, 4.5]).toContain(r.min);
      expect(r.kind === "text" ? r.min : 4.5).toBe(4.5);
    }
  });
});
