// The toasts' list (toastList.ts): every toast is a toast of its own, added as the newest, even in
// the same words; only a notice with a key stands for an earlier one of that key, and then it moves
// to the newest place.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { addToast, type ToastEntry } from "./toastList";

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

  it("adds A again after B and C as the newest toast, last in the list (where it is drawn)", () => {
    const { list } = run([{ text: "A" }, { text: "B" }, { text: "C" }, { text: "A" }]);
    expect(list.map((t) => `${t.id}:${t.text}`)).toEqual(["1:A", "2:B", "3:C", "4:A"]);
  });

  it("keeps toasts with an action and a running download's as toasts of their own", () => {
    const undo = { label: "Undo", onClick: () => {} };
    const { list } = run([
      { text: "Removed Paper Bloom from Late Night", action: undo },
      { text: "Removed Paper Bloom from Late Night", action: undo },
      { text: "Downloading", persistent: true },
      { text: "Downloading", progress: 0.5 },
    ]);
    expect(list.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("lets a keyed notice stand for an earlier one of the same key: shown once, its clock started again", () => {
    const { list, ids } = run([
      { text: UNREADABLE, key: "settings-unreadable" },
      { text: UNREADABLE, key: "settings-unreadable" },
    ]);
    expect(ids).toEqual([1, 1]);
    expect(list).toEqual([{ text: UNREADABLE, key: "settings-unreadable", id: 1, at: 5001 }]);
  });

  it("moves a keyed notice shown again to the newest place, with its new words", () => {
    const { list } = run([{ text: "first", key: "k" }, { text: "B" }, { text: "C" }, { text: "again", key: "k" }]);
    expect(list.map((t) => `${t.id}:${t.text}`)).toEqual(["2:B", "3:C", "1:again"]);
  });

  it("never lets a toast without a key stand for a keyed one in the same words, or the other way round", () => {
    const { list } = run([{ text: UNREADABLE, key: "settings-unreadable" }, { text: UNREADABLE }, { text: UNREADABLE, key: "other" }]);
    expect(list.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});
