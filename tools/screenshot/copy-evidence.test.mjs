// Unit tests of copy-evidence.mjs's choices (npm run evidence:after): the arguments, the folder
// and which baselines go in. Nothing here reads or writes the repository's evidence.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_PHASE, evidenceDir, expectedShots, parseArgs, pickShots } from "./copy-evidence.mjs";

const defaults = { phase: CURRENT_PHASE, os: "win32" };

describe("parseArgs", () => {
  it("defaults to the current phase and this machine's baselines", () => {
    expect(parseArgs([], defaults)).toEqual({ phase: 1, os: "win32" });
  });

  it("takes the phase and the baseline folder", () => {
    expect(parseArgs(["--phase", "2", "--os", "linux"], defaults)).toEqual({ phase: 2, os: "linux" });
  });

  it("refuses an earlier phase, whose folder is a record", () => {
    expect(() => parseArgs(["--phase", "0"], defaults)).toThrow(/earlier phase/);
  });

  it("refuses what it does not know", () => {
    expect(() => parseArgs(["--phase"], defaults)).toThrow(/usage/);
    expect(() => parseArgs(["--phase", "one"], defaults)).toThrow(/phase number/);
    expect(() => parseArgs(["--os", "../docs"], defaults)).toThrow(/folder name/);
    expect(() => parseArgs(["win32"], defaults)).toThrow(/usage/);
  });
});

describe("evidenceDir", () => {
  it("is docs/evidence/phase-<n>/after under the repository", () => {
    expect(evidenceDir("/repo", 1)).toBe(path.join("/repo", "docs", "evidence", "phase-1", "after"));
    expect(evidenceDir("/repo", 3)).toBe(path.join("/repo", "docs", "evidence", "phase-3", "after"));
  });
});

describe("pickShots", () => {
  it("expects the eight parity screens at the four sizes", () => {
    const all = expectedShots();
    expect(all).toHaveLength(32);
    expect(all).toContain("390x844-playlists.png");
    expect(all).toContain("1920x1080-settings.png");
    expect(all).toContain("834x1194-queue.png");
  });

  it("leaves out flow captures, other screens, other sizes, folders and the other modes", () => {
    const names = [
      ...expectedShots(),
      "1280x800-after-playlist-add.png",
      "1920x1080-settings-undo.png",
      "390x844-settings-developer.png",
      "390x844-onboarding.png",
      "1024x768-playlists.png",
      "components",
      "screen-modes",
      "390x844-playlists.png.mask.json",
    ];
    const { copy, missing } = pickShots(names);
    expect(copy).toEqual(expectedShots());
    expect(missing).toEqual([]);
  });

  it("names the screens that have no baseline", () => {
    const names = expectedShots().filter((n) => n !== "834x1194-search.png" && n !== "390x844-queue.png");
    expect(pickShots(names).missing).toEqual(["390x844-queue.png", "834x1194-search.png"]);
  });
});
