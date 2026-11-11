// How the user last pressed something: with a pointer (a mouse, a finger, a pen) or with the
// keyboard, and what a pointer's newest press landed on. One listener pair on the window, heard in
// the capture phase before any handler, so a surface that opens or closes from a press can ask which
// kind of press did it (useFocusReturn: the focus goes back to the opener only when the keyboard both
// opened and closed it; a pointer's press either way gives it to the screen's heading). The Shell
// installs it (Shell.tsx), once however many mount. No React here.

export type InputKind = "pointer" | "keyboard";

/**
 * How long after a pointer's press a surface that goes counts as closed by it: the commit a click
 * causes comes within a frame or two; a pane hidden by a window resize long after a click is not.
 */
const PRESS_MS = 1000;

let last: InputKind = "keyboard";
let pressedOn: EventTarget | null = null;
let pressedAt = -Infinity;
let installed = 0;
let remove: (() => void) | null = null;

/** The kind of the newest press heard on the window ("keyboard" before any). */
export function lastInput(): InputKind {
  return last;
}

/**
 * True when the newest press was a pointer's, landed inside `el` and came just now (within
 * PRESS_MS): `el` is the control a click or a tap pressed, such as the toggle that closed a pane.
 */
export function pointerPressed(el: Element): boolean {
  return last === "pointer" && pressedOn instanceof Node && el.contains(pressedOn) && performance.now() - pressedAt < PRESS_MS;
}

/**
 * Starts listening (the first call; later ones count) and returns what stops it again (the last
 * call's return removes the listeners).
 */
export function watchInput(): () => void {
  if (installed++ === 0) {
    const onPointer = (e: PointerEvent) => {
      last = "pointer";
      pressedOn = e.target;
      pressedAt = performance.now();
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
