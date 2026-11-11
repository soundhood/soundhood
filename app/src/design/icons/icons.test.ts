// The icon pairs that must read as one family: a glyph and its counterpart differ only where their
// meaning differs.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, test } from "vitest";
import { ICONS } from "./icons";

/** The `d` of every path of an icon, in order. */
const paths = (markup: string) => [...markup.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);

describe("playlistAdd and playlistRemove", () => {
  test("playlistRemove is playlistAdd's list with a minus where the plus is: the same three lines, the plus's bar alone", () => {
    const [addList, addSign] = paths(ICONS.playlistAdd);
    const [removeList, removeSign, ...rest] = paths(ICONS.playlistRemove);
    expect(rest).toEqual([]);
    expect(removeList).toBe(addList);
    expect(addList).toBe("M4 6h12M4 11h12M4 16h7");
    // The plus is a vertical and a horizontal stroke; the minus is that horizontal stroke alone.
    const bar = /M[\d.]+ [\d.]+h[\d.]+/.exec(addSign)?.[0];
    expect(bar).toBe("M14.5 16.5h7");
    expect(removeSign).toBe(bar);
  });
});
