// How the user last pressed something: with a pointer (a mouse, a finger, a pen) or with the
// keyboard. One listener pair on the window, heard in the capture phase before any handler, so a
// surface that opens from a press can ask which kind of press opened it (useFocusReturn: the full
// player opened with a pointer gives the focus to the screen's heading when it goes, as every
// navigation does; opened with the keyboard, back to what opened it). The Shell installs it
// (Shell.tsx), once however many mount. No React here.

export type InputKind = "pointer" | "keyboard";

let last: InputKind = "keyboard";
let installed = 0;
let remove: (() => void) | null = null;

/** The kind of the newest press heard on the window ("keyboard" before any). */
export function lastInput(): InputKind {
  return last;
}

/**
 * Starts listening (the first call; later ones count) and returns what stops it again (the last
 * call's return removes the listeners).
 */
export function watchInput(): () => void {
  if (installed++ === 0) {
    const onPointer = () => {
      last = "pointer";
    };
    const onKey = (e: KeyboardEvent) => {
      // A modifier on its own (Shift held for Shift+click) presses nothing.
      if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") last = "keyboard";
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    remove = () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--installed === 0) {
      remove?.();
      remove = null;
    }
  };
}
