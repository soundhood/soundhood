// The toasts' list (toastList.ts): every toast is a toast of its own, added as the newest, even in
// the same words; only a notice with a key stands for an earlier one of that key, and then it moves
// to the newest place. At most two exist: a third pushes the oldest out, gone for good.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { MAX_TOASTS, addToast, type ToastEntry } from "./toastList";

const UNREADABLE = "The settings (music folder and downloader) could not be read.";

/** Adds each toast in turn at `now`; returns the list and the ids returned. */
function run(toasts: Omit<ToastEntry, "id" | "at">[], now = 5000) {
  let list: readonly ToastEntry[] = [];
  const ids: number[] = [];
  toasts.forEach((t, i) => {
    const out = addToast(list, t, i + 1, now + i);
    list = out.list;
    ids.push(out.id);
  });
  return { list, ids };
}

describe("addToast", () => {
  it("adds a toast in the same words as the one before as a toast of its own (A pressed twice says so twice)", () => {
    const { list, ids } = run([{ text: "Added Paper Bloom to the queue" }, { text: "Added Paper Bloom to the queue" }]);
    expect(ids).toEqual([1, 2]);
    expect(list.map((t) => t.text)).toEqual(["Added Paper Bloom to the queue", "Added Paper Bloom to the queue"]);
  });

  it("adds A again after B and C as the newest toast of its own, last in the list (where it is drawn)", () => {
    const { list, ids } = run([{ text: "A" }, { text: "B" }, { text: "C" }, { text: "A" }]);
    expect(ids).toEqual([1, 2, 3, 4]);
    expect(list[list.length - 1]).toMatchObject({ id: 4, text: "A" });
  });

  it("keeps toasts with an action and a running download's as toasts of their own", () => {
    const undo = { label: "Undo", onClick: () => {} };
    const { ids } = run([
      { text: "Removed Paper Bloom from Late Night", action: undo },
      { text: "Removed Paper Bloom from Late Night", action: undo },
      { text: "Downloading", persistent: true },
      { text: "Downloading", progress: 0.5 },
    ]);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("lets a keyed notice stand for an earlier one of the same key: shown once, its clock started again", () => {
    const { list, ids } = run([
      { text: UNREADABLE, key: "settings-unreadable" },
      { text: UNREADABLE, key: "settings-unreadable" },
    ]);
    expect(ids).toEqual([1, 1]);
    expect(list).toEqual([{ text: UNREADABLE, key: "settings-unreadable", id: 1, at: 5001 }]);
  });

  it("moves a keyed notice shown again to the newest place, with its new words, pushing nothing out", () => {
    const { list, ids } = run([{ text: "first", key: "k" }, { text: "B" }, { text: "again", key: "k" }]);
    expect(ids).toEqual([1, 2, 1]);
    expect(list.map((t) => `${t.id}:${t.text}`)).toEqual(["2:B", "1:again"]);
  });

  it("never lets a toast without a key stand for a keyed one in the same words, or the other way round", () => {
    const { ids } = run([{ text: UNREADABLE, key: "settings-unreadable" }, { text: UNREADABLE }, { text: UNREADABLE, key: "other" }]);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("the stack of two", () => {
  it("holds at most two: a third pushes the oldest out, gone for good", () => {
    expect(MAX_TOASTS).toBe(2);
    const { list } = run([{ text: "A" }, { text: "B" }, { text: "C" }, { text: "A" }]);
    expect(list.map((t) => `${t.id}:${t.text}`)).toEqual(["3:C", "4:A"]);
  });

  it("leaves the last two of eight presses, each with the time it was shown", () => {
    const { list } = run(Array.from({ length: 8 }, () => ({ text: "Added Paper Bloom to the queue" })), 1000);
    expect(list.map((t) => `${t.id}@${t.at}`)).toEqual(["7@1006", "8@1007"]);
  });

  it("pushes out an Undo toast like any other (its change stays undoable from Settings)", () => {
    const undo = { label: "Undo", onClick: () => {} };
    const { list } = run([
      { text: "Removed Amber Comets from Late Night", action: undo },
      { text: "Removed Static Comets from Late Night", action: undo },
      { text: "Removed Silver Garden from Late Night", action: undo },
    ]);
    expect(list.map((t) => t.text)).toEqual(["Removed Static Comets from Late Night", "Removed Silver Garden from Late Night"]);
  });

  it("never pushes out a running download's toast while another toast can go", () => {
    const { list } = run([{ text: "Downloading", persistent: true }, { text: "A" }, { text: "B" }, { text: "C" }]);
    expect(list.map((t) => `${t.id}:${t.text}`)).toEqual(["1:Downloading", "4:C"]);
  });

  it("pushes out the oldest when every toast stays until dismissed", () => {
    const { list } = run([
      { text: "one", persistent: true },
      { text: "two", persistent: true },
      { text: "three", persistent: true },
    ]);
    expect(list.map((t) => t.text)).toEqual(["two", "three"]);
  });
});
