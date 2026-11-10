// The toasts' list (toastList.ts): a toast identical to one shown a moment ago is that toast again,
// never a second copy; anything else is a toast of its own.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { SAME_TOAST_MS, addToast, type ToastEntry } from "./toastList";

const UNREADABLE = "The settings (music folder and downloader) could not be read.";

describe("addToast", () => {
  it("shows a toast identical to one shown a moment ago once: the same toast, its clock started again", () => {
    const first = addToast<ToastEntry>([], { text: UNREADABLE }, 1, 1000);
    const second = addToast(first.list, { text: UNREADABLE }, 2, 1000 + SAME_TOAST_MS - 1);
    expect(second.id).toBe(1);
    expect(second.list).toEqual([{ text: UNREADABLE, id: 1, at: 1000 + SAME_TOAST_MS - 1 }]);
  });

  it("shows the same words again as a new toast once the moment has passed", () => {
    const first = addToast<ToastEntry>([], { text: UNREADABLE }, 1, 1000);
    const later = addToast(first.list, { text: UNREADABLE }, 2, 1000 + SAME_TOAST_MS);
    expect(later.id).toBe(2);
    expect(later.list.map((t) => t.id)).toEqual([1, 2]);
  });

  it("keeps different words, a toast with an action and a running download's toast as toasts of their own", () => {
    let list: readonly ToastEntry[] = [];
    let id = 0;
    const add = (t: Omit<ToastEntry, "id" | "at">) => {
      const out = addToast(list, t, ++id, 5000);
      list = out.list;
      return out.id;
    };
    add({ text: "Link queued" });
    add({ text: "Link copied" });
    add({ text: "Removed Paper Bloom from Late Night", action: { label: "Undo", onClick: () => {} } });
    add({ text: "Removed Paper Bloom from Late Night", action: { label: "Undo", onClick: () => {} } });
    add({ text: "Downloading", persistent: true });
    add({ text: "Downloading", persistent: true });
    add({ text: "Downloading", progress: 0.5 });
    add({ text: "Downloading", progress: 0.5 });
    expect(list.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
