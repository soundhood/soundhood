import { describe, expect, it } from "vitest";
import {
  RULE_APPEARANCE,
  RULE_GLYPH,
  RULE_RAW_HEX,
  TOKENS_FILE,
  blankComments,
  classNamesOf,
  cssBlocks,
  findGlyphs,
  findRawHex,
  isForbiddenGlyph,
  lastCompoundClasses,
  lintTokens,
  openingTagEnd,
} from "./tokens.mjs";

const rules = (findings) => findings.map((f) => `${f.line}:${f.rule}`);

describe("findRawHex", () => {
  it("finds 3, 4, 6 and 8 digit colours in CSS and strings", () => {
    const text = 'a{color:#fff;background:#0f0f0fcc} const c = "#00FFBF"; x = `#abcd`;';
    expect(findRawHex(text).map((h) => h.match)).toEqual(["#fff", "#0f0f0fcc", "#00FFBF", "#abcd"]);
  });

  it("ignores entities, private fields, ids and other lengths", () => {
    const text = "&#123; this.#cafe #add-row #12345 #1234567 #root a#fff";
    expect(findRawHex(text)).toEqual([]);
  });
});

describe("glyphs", () => {
  it("covers exactly the three brief ranges", () => {
    for (const cp of [0x1f000, 0x1f50a, 0x1faff, 0x2600, 0x2699, 0x26a1, 0x2713, 0x27bf, 0x2b00, 0x2b50, 0x2bff]) {
      expect(isForbiddenGlyph(cp), cp.toString(16)).toBe(true);
    }
    for (const cp of [0x25be, 0x2192, 0x2026, 0x00b7, 0x2c00, 0x1fb00, 0x27c0, 0x25b4]) {
      expect(isForbiddenGlyph(cp), cp.toString(16)).toBe(false);
    }
  });

  it("finds literal glyphs, astral ones included, with their offsets", () => {
    const found = findGlyphs("ok ✓ then 🔊 and ▾");
    expect(found.map((g) => g.codePoint)).toEqual([0x2713, 0x1f50a]);
    expect(found[0].index).toBe(3);
  });

  it("finds escaped spellings of the same glyphs", () => {
    const text = String.raw`"✓" "\u{1F507}" "🔊" &#x2699; &#9889; "▾"`;
    expect(findGlyphs(text).map((g) => g.codePoint)).toEqual([0x2713, 0x1f507, 0x1f50a, 0x2699, 0x26a1]);
  });
});

describe("cssBlocks and selectors", () => {
  it("returns innermost blocks with their appearance declarations", () => {
    const css = "@media (x){ .a{ -webkit-appearance: none; appearance:none; } } .b{color:red}";
    const blocks = cssBlocks(css);
    expect(blocks.map((b) => b.selector)).toEqual([".a", ".b"]);
    expect(blocks[0].appearance.map((a) => a.value)).toEqual(["none", "none"]);
  });

  it("reads React style objects too", () => {
    const blocks = cssBlocks('<i style={{ WebkitAppearance: "auto" }} />');
    expect(blocks.flatMap((b) => b.appearance.map((a) => a.value))).toEqual(["auto"]);
  });

  it("takes classes from the last compound of each selector", () => {
    expect(lastCompoundClasses(".app.mobile .range, .x > .y.z::-webkit-slider-thumb")).toEqual(["range", "y", "z"]);
  });
});

describe("JSX helpers", () => {
  it("finds the end of an opening tag across arrow functions and strings", () => {
    const text = '<input onChange={(e) => go(e)} title="a > b" type="range" /> rest';
    expect(text.slice(0, openingTagEnd(text, 0))).toBe('<input onChange={(e) => go(e)} title="a > b" type="range" />');
  });

  it("collects static class names from strings and template literals", () => {
    expect(classNamesOf('<input className="range volRange" />')).toEqual(["range", "volRange"]);
    expect(classNamesOf("<div className={`row ${on ? \"active\" : \"\"} big`} />").sort()).toEqual(["active", "big", "row"]);
    expect(classNamesOf("<input className={cls} />")).toEqual([]);
  });

  it("blanks comments without moving offsets and keeps URLs", () => {
    const text = 'a // <select>\nb /* <meter> */ c "https://x.y"';
    const out = blankComments(text);
    expect(out.length).toBe(text.length);
    expect(out).not.toContain("<select>");
    expect(out).not.toContain("<meter>");
    expect(out).toContain("https://x.y");
  });
});

describe("lintTokens", () => {
  it("flags raw hex everywhere except the token file", () => {
    const findings = lintTokens([
      { file: TOKENS_FILE, text: ":root{--aqua:#00ffbf}" },
      { file: "app/src/a.css", text: ".x{color:#00ffbf}" },
    ]);
    expect(findings).toEqual([
      { file: "app/src/a.css", line: 1, rule: RULE_RAW_HEX, message: expect.stringContaining("#00ffbf") },
    ]);
  });

  it("checks glyphs in .tsx only", () => {
    const findings = lintTokens([
      { file: "app/src/a.tsx", text: "const a = 1;\nreturn <span>♪</span>;" },
      { file: "app/src/b.ts", text: "export const tick = '✓';" },
    ]);
    expect(findings.map((f) => `${f.file}:${f.line}:${f.rule}`)).toEqual([`app/src/a.tsx:2:${RULE_GLYPH}`]);
  });

  it("accepts a stripped control that has custom styling and a class that strips it", () => {
    const tsx = [
      "const css = `.range{ -webkit-appearance:none; appearance:none; height:4px; background: var(--x); }",
      ".range::-webkit-slider-thumb{ -webkit-appearance:none; width:14px; background: var(--y); }",
      "input[type=search]::-webkit-search-cancel-button{ -webkit-appearance:none; }`;",
      '<input className="range volRange" type="range" onChange={(e) => set(e)} />',
    ].join("\n");
    expect(lintTokens([{ file: "app/src/a.tsx", text: tsx }])).toEqual([]);
  });

  it("flags native appearance values, bare stripping and unstyled native controls", () => {
    const css = ".a{ appearance: auto; }\n.b{ -webkit-appearance: none; }\n.c{ appearance:none; border:0 }";
    const tsx = [
      '<input type="checkbox" />',
      '<input className="c" type={"radio"} />',
      '<input type="text" />',
      "<select className={`dd`}>",
      '<input className="other" type="range" />',
    ].join("\n");
    const findings = lintTokens([
      { file: "app/src/x.css", text: css },
      { file: "app/src/y.tsx", text: tsx },
    ]);
    expect(findings.every((f) => f.rule === RULE_APPEARANCE)).toBe(true);
    expect(findings.map((f) => `${f.file}:${f.line}`)).toEqual([
      "app/src/x.css:1",
      "app/src/x.css:2",
      "app/src/y.tsx:1",
      "app/src/y.tsx:4",
      "app/src/y.tsx:5",
    ]);
    expect(rules(findings).length).toBe(5);
  });
});
