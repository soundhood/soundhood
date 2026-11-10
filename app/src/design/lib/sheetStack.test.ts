// The open sheets' order (sheetStack.ts): the newest is on top, whatever order they were mounted in,
// and the layers stay as low as the number of open sheets.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it, vi } from "vitest";
import { createSheetStack } from "./sheetStack";

describe("createSheetStack", () => {
  it("puts the sheet that opens last on top, whatever order the sheets were mounted in", () => {
    const stack = createSheetStack<string>();
    stack.open("queue");
    stack.open("new playlist");
    expect(stack.layer("queue")).toBe(0);
    expect(stack.layer("new playlist")).toBe(1);
    expect(stack.top()).toBe("new playlist");
  });

  it("gives a sheet not open yet the layer above every open one", () => {
    const stack = createSheetStack<string>();
    expect(stack.layer("settings")).toBe(0);
    stack.open("settings");
    expect(stack.layer("where")).toBe(1);
    stack.open("where");
    expect(stack.layer("where")).toBe(1);
  });

  it("moves the sheets above a closed one down a layer and leaves the sheet below on top", () => {
    const stack = createSheetStack<string>();
    for (const s of ["settings", "where", "log"]) stack.open(s);
    stack.close("where");
    expect(stack.layer("settings")).toBe(0);
    expect(stack.layer("log")).toBe(1);
    stack.close("log");
    expect(stack.top()).toBe("settings");
    stack.close("settings");
    expect(stack.top()).toBeUndefined();
  });

  it("keeps layers no higher than the number of open sheets after many opens and closes", () => {
    const stack = createSheetStack<number>();
    stack.open(0);
    for (let i = 1; i < 50; i++) {
      stack.open(i);
      stack.close(i - 1);
    }
    expect(stack.layer(49)).toBe(0);
  });

  it("opens a sheet once: opening it again moves it to the top", () => {
    const stack = createSheetStack<string>();
    stack.open("a");
    stack.open("b");
    stack.open("a");
    expect(stack.top()).toBe("a");
    expect(stack.layer("b")).toBe(0);
  });

  it("tells its listeners about each change, and only about changes", () => {
    const stack = createSheetStack<string>();
    const listener = vi.fn();
    const stop = stack.subscribe(listener);
    stack.open("a");
    stack.close("b");
    stack.close("a");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    stack.open("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lists the open entries oldest first", () => {
    const stack = createSheetStack<string>();
    for (const s of ["sort", "menu", "folder"]) stack.open(s);
    stack.close("menu");
    expect(stack.list()).toEqual(["sort", "folder"]);
  });
});
