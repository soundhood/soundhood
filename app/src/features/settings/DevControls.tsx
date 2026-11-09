// The developer controls: rows at the bottom of the phone's settings sheet, a row under the
// desktop top bar. Plain buttons; the switch is a toggle button that says its state in words.
import type { DevMode } from "../../hooks/useDevMode";
import type { Library } from "../../hooks/useLibrary";

type DevControlsProps = {
  lib: Library;
  dev: DevMode;
  dlBusy: boolean;
  protonBusy: string;
  undoBusy: boolean;
};

export function DevControls({ lib, dev, dlBusy, protonBusy, undoBusy }: DevControlsProps) {
  const { fixtureOn, folder } = lib;
  const { devBusy } = dev;
  return (
    <>
      <span className="modalHint" style={{ marginTop: 0 }}>Developer</span>
      <button
        className={`btn ${fixtureOn ? "primaryBtn" : ""}`}
        role="switch"
        aria-checked={fixtureOn}
        onClick={() => dev.switchFixtureRoot(!fixtureOn)}
        disabled={devBusy !== "" || dlBusy || protonBusy !== "" || undoBusy}
        title="Point the app at the generated test library (screenshots, tests); off goes back to your library"
      >
        {devBusy === "fixture" ? "Switching…" : `Test library: ${fixtureOn ? "on" : "off"}`}
      </button>
      <button className="btn" onClick={dev.runSelfTest} disabled={devBusy !== ""} title="Run the bundled checks through this build; the result goes to the log">
        {devBusy === "selftest" ? "Testing…" : "Run self-test"}
      </button>
      <button className="btn" onClick={dev.rebuildIndex} disabled={devBusy !== "" || !folder} title="Rebuild the library index from the files alone; the time goes to the log">
        {devBusy === "rebuild" ? "Rebuilding…" : "Rebuild index"}
      </button>
    </>
  );
}
