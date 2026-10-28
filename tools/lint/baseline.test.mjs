import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareCounts, countByFileAndRule, readBaseline, writeBaseline } from "./baseline.mjs";

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sh-baseline-"));
  file = path.join(dir, "lint-baseline.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("countByFileAndRule", () => {
  it("counts per file and rule", () => {
    const counts = countByFileAndRule([
      { file: "a", rule: "x" },
      { file: "a", rule: "x" },
      { file: "a", rule: "y" },
      { file: "b", rule: "x" },
    ]);
    expect(counts).toEqual({ a: { x: 2, y: 1 }, b: { x: 1 } });
  });
});

describe("baseline file", () => {
  it("reads an empty section when the file is missing", () => {
    expect(readBaseline("token-lint", file)).toEqual({});
  });

  it("writes one tool's section and keeps the others, sorted", () => {
    writeBaseline("blue-scan", { "z.png": { "blue-pixels": 9 } }, file);
    writeBaseline("token-lint", { "b.tsx": { y: 1 }, "a.tsx": { x: 2 } }, file);
    const all = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(all)).toEqual(["_about", "blue-scan", "token-lint"]);
    expect(Object.keys(all["token-lint"])).toEqual(["a.tsx", "b.tsx"]);
    expect(readBaseline("blue-scan", file)).toEqual({ "z.png": { "blue-pixels": 9 } });
  });

  it("reports a corrupt baseline instead of treating it as empty", () => {
    writeFileSync(file, "{ nope");
    expect(() => readBaseline("token-lint", file)).toThrow(/not valid JSON/);
  });
});

describe("compareCounts", () => {
  it("fails only counts above the allowance and lists improvements", () => {
    const baseline = { "a.tsx": { hex: 3, glyph: 2 }, "gone.tsx": { hex: 1 } };
    const counts = { "a.tsx": { hex: 3, glyph: 1 }, "new.tsx": { hex: 1 } };
    const { over, under } = compareCounts(counts, baseline);
    expect(over).toEqual([{ file: "new.tsx", rule: "hex", count: 1, allowed: 0 }]);
    expect(under).toEqual([
      { file: "a.tsx", rule: "glyph", count: 1, allowed: 2 },
      { file: "gone.tsx", rule: "hex", count: 0, allowed: 1 },
    ]);
  });

  it("fails a new violation in a grandfathered file", () => {
    const { over } = compareCounts({ "a.tsx": { hex: 4 } }, { "a.tsx": { hex: 3 } });
    expect(over).toEqual([{ file: "a.tsx", rule: "hex", count: 4, allowed: 3 }]);
  });
});
