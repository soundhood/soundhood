// The developer switch "Use fixture root" points the app at the generated test library (screenshots,
// gate runs). Whether the test library is shown is derived from the current library folder and the
// fixture root the host returned, never stored as a flag, so the switch, the folder line, the note in
// the top bar and the sync buttons cannot disagree with what is on screen.
// Unit tests: tools/screenshot/ui-logic.test.mjs.

/** What the folder line says instead of the test library's path, which sits in the user's app data. */
export const TEST_LIBRARY_LABEL = "test library";

/** The line under the Proton buttons while they are off. */
export const SYNC_OFF_LINE = "Sync is off while the test library is shown";

const WINDOWS_PATH = /^[A-Za-z]:\//;

function normalise(p: string): string {
  const s = String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return s || (String(p ?? "").trim() ? "/" : "");
}

/** Same folder, whatever the slash style or a trailing separator; Windows paths ignore letter case. */
export function sameFolder(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  return WINDOWS_PATH.test(x) || WINDOWS_PATH.test(y) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** True when the library folder `folder` is the test library at `fixtureRoot`. */
export function isTestLibrary(folder: string, fixtureRoot: string): boolean {
  return sameFolder(folder, fixtureRoot);
}

/** The library folder as the UI prints it: the test library by name, any other folder as is. */
export function shownFolder(folder: string, fixtureRoot: string): string {
  return isTestLibrary(folder, fixtureRoot) ? TEST_LIBRARY_LABEL : folder;
}
