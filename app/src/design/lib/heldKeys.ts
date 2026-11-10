// A held key is one press, on every control: one rule on the window, heard in the capture phase
// before any handler, swallows the auto-repeated keydowns of a held Enter or Space on a control that
// acts on them (buttons, switches, checkboxes, a list's options and the list itself, menus and their
// items, tabs, rows, links, and every other button such as the mini player's play), and of a held
// Enter in a text field, where Enter submits or saves. So holding Enter does what one press does,
// even when that press moves the focus on: to the next control of the same kind (Remove in a list
// of links), or into the field of the sheet it opened (Edit tags). Space typed in a field, Enter in
// a text area, and every other key (the arrows, Page Up and Down, Home and End in lists and sliders,
// Ctrl+Up for the volume) still repeat. The Shell installs it (Shell.tsx), once however many mount.
import { isTypingTarget } from "./dom";

/** The controls a press of Enter or Space activates. */
const ACTIVATES = [
  "button",
  "a[href]",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  ...[
    "button",
    "link",
    "switch",
    "checkbox",
    "radio",
    "option",
    "listbox",
    "menu",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "row",
    "gridcell",
    "treeitem",
    "combobox",
  ].map((role) => `[role="${role}"]`),
].join(", ");

/** True for a keydown that is the auto-repeat of a held Enter or Space the rule swallows. */
export function isHeldPress(e: Pick<KeyboardEvent, "key" | "repeat" | "target">): boolean {
  if (!e.repeat || (e.key !== "Enter" && e.key !== " ")) return false;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  // Where Enter types a new line, it repeats as typing does.
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return false;
  // A text field: Space types and repeats; Enter submits, once.
  if (isTypingTarget(el)) return e.key === "Enter";
  return el.matches(ACTIVATES);
}

let installed = 0;
let remove: (() => void) | null = null;

/**
 * Installs the rule on the window (the first call; later ones count) and returns what takes it away
 * again (the last call's return removes it).
 */
export function holdKeysAsOnePress(): () => void {
  if (installed++ === 0) {
    const onKey = (e: KeyboardEvent) => {
      if (!isHeldPress(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    remove = () => window.removeEventListener("keydown", onKey, true);
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
