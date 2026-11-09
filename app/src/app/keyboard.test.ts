// The keyboard map (keyboard.ts): every decided key means its command, and the keys that are not
// this map's (J and K, Ctrl+comma, Ctrl+V, Enter) mean nothing here.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { IN_QUEUE_SHEET, PLAYBACK, SHORTCUTS, shortcutFor, type Command, type KeyPress } from "./keyboard";

function press(spec: string): KeyPress {
  const parts = spec.split("+");
  const key = parts.pop() as string;
  const has = (m: string) => parts.includes(m);
  return { key, ctrlKey: has("Ctrl"), metaKey: has("Cmd"), altKey: has("Alt"), shiftKey: has("Shift") };
}
const command = (spec: string): Command | null => shortcutFor(press(spec))?.command ?? null;

describe("the keyboard map", () => {
  it.each([
    [" ", "playPause"],
    ["Ctrl+ArrowRight", "next"],
    ["Ctrl+ArrowLeft", "previous"],
    ["Ctrl+ArrowUp", "volumeUp"],
    ["Ctrl+ArrowDown", "volumeDown"],
    ["m", "mute"],
    ["M", "mute"],
    ["q", "toggleQueue"],
    ["Ctrl+k", "search"],
    ["Cmd+k", "search"],
    ["/", "search"],
    ["Escape", "escape"],
    ["1", "tab"],
    ["4", "tab"],
    ["a", "addToQueue"],
    ["Shift+A", "playNext"],
    ["Delete", "remove"],
    ["Ctrl+e", "editTags"],
    ["Ctrl+s", "saveAsPlaylist"],
    ["x", "removeFromQueue"],
    ["Ctrl+l", "clearQueue"],
  ])("%s means %s", (key: string, expected: Command) => {
    expect(command(key)).toBe(expected);
  });

  it.each(["j", "k", "J", "K", "Ctrl+,", "Ctrl+v", "Enter", "5", "Alt+ArrowUp", "Ctrl+Shift+ArrowUp", "Alt+q", "Ctrl+a", "Shift+ "])(
    "%s is not this map's",
    (key: string) => {
      expect(command(key)).toBeNull();
    },
  );

  it("every entry says its keys and what it does", () => {
    for (const s of SHORTCUTS) {
      expect(s.keys).toMatch(/\S/);
      expect(s.does).toMatch(/\S/);
    }
    expect(SHORTCUTS.filter((s) => s.whileTyping).map((s) => s.keys)).toEqual(["Ctrl+K"]);
    expect(SHORTCUTS.filter((s) => s.repeats).map((s) => s.command)).toEqual(["volumeUp", "volumeDown"]);
  });

  it("with a sheet open only the music answers; the queue sheet also takes Q and Ctrl+L", () => {
    expect([...PLAYBACK].sort()).toEqual(["mute", "next", "playPause", "previous", "volumeDown", "volumeUp"]);
    expect(IN_QUEUE_SHEET.has("toggleQueue")).toBe(true);
    expect(IN_QUEUE_SHEET.has("clearQueue")).toBe(true);
    expect(IN_QUEUE_SHEET.has("addToQueue")).toBe(false);
  });
});
