// The settings sheet: one component on every device, a bottom sheet on the phone and a centred
// dialog on wider shells (the Sheet's own container query). It opens from actions.openSettings()
// (the sidebar, the rail, the phone's header button) and with Ctrl+comma (registered here; the
// general keyboard map lives elsewhere). Groups in DESIGN.md's order, each only with rows that work
// today: Library, YouTube, Proton Drive (phone), Appearance, Tools, About, and the hidden Developer
// section at the bottom (7 taps on the version row on the phone, Ctrl+Alt+Shift+D on the PC).
//
// Appearance shows "Show the queue beside the list" when the shell passes `queuePane` (Overlays.tsx
// does, on a window wide and tall enough for the right pane); elsewhere the row is left out.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Dropdown, Icon, SettingGroup, SettingRow, Sheet, SwitchRow, onePress, sheetMayOpen } from "../../design";
import { useApp } from "../../app/context";
import type { Diagnostics } from "../../coreIpc";
import { TEXT_SCALES } from "../../hooks/usePrefs";
import { YouTubeGroup } from "../ingest/YouTubeGroup";
import { LinksWaitingSheet } from "../ingest/LinksWaitingSheet";
import { LogSheet } from "../log/LogSheet";
import { ProtonGroup } from "../sync/ProtonGroup";
import { LibraryGroup } from "./LibraryGroup";
import "./settings.css";

export interface QueuePaneSetting {
  shown: boolean;
  onChange: (shown: boolean) => void;
}

const SCALE_OPTIONS = TEXT_SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }));

/**
 * Ctrl+comma opens the settings (a PC shortcut; harmless elsewhere): over the screens or on top of
 * another sheet, never under the first-launch setup, which is drawn above sheets. An open list or
 * menu closes as the sheet opens (Sheet.tsx). Heard on the way down (capture), so a menu that keeps
 * its keys from the list behind it (the row menu) still lets this one through.
 */
function useSettingsShortcut(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ",") {
        if (!sheetMayOpen()) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [setOpen]);
}

function AppearanceGroup({ queuePane }: { queuePane?: QueuePaneSetting }) {
  const { prefs } = useApp();
  return (
    <SettingGroup title="Appearance">
      <SettingRow label="Text size" help="Every screen, on this device">
        <Dropdown label="Text size" options={SCALE_OPTIONS} value={String(prefs.textScale)} onChange={(v) => prefs.setTextScale(Number(v))} />
      </SettingRow>
      {queuePane && <SwitchRow label="Show the queue beside the list" help="On wide windows" checked={queuePane.shown} onChange={queuePane.onChange} />}
    </SettingGroup>
  );
}

function ToolsGroup({ onViewLog }: { onViewLog: () => void }) {
  const { log } = useApp();
  return (
    <SettingGroup title="Tools">
      <SettingRow label="Copy log" help="The log with the app and device details on top, for a bug report">
        <Button small icon="copy" onClick={() => void log.copyLog()}>
          Copy log
        </Button>
      </SettingRow>
      {/* View log, with the newest line of the log as its help line. */}
      <button type="button" className="SettingRow is-clickable LogRow" onClick={onViewLog} onKeyDown={onePress()}>
        <span className="SettingRow-text">
          <span className="SettingRow-label">View log</span>
          <span className="SettingRow-help">{log.lastLine || "Nothing logged yet"}</span>
        </span>
        <span className="SettingRow-value">
          <Icon name="chevronRight" size={20} />
        </span>
      </button>
    </SettingGroup>
  );
}

function AboutGroup({ version }: { version: string }) {
  const { dev } = useApp();
  return (
    <SettingGroup title="About">
      {/* Seven taps on this row show or hide the developer section on the phone. */}
      <div className="SettingRow VersionRow" onClick={dev.onVersionTap}>
        <div className="SettingRow-text">
          <div className="SettingRow-label">Soundhood</div>
          <div className="SettingRow-help">{version ? `Version ${version}` : "Version"}</div>
        </div>
      </div>
      <SettingRow label="Typeface" help="Inter typeface, SIL Open Font License 1.1" />
      <SettingRow
        label="Licences"
        help="Soundhood is MIT licensed. yt-dlp, deno, ffmpeg, youtubedl-android, rclone, Tauri, React, SQLite and lofty each keep their own licence (LEGAL.md in the source)."
      />
    </SettingGroup>
  );
}

function DeveloperGroup() {
  const { lib, dev, dl, proton, edits } = useApp();
  if (!dev.devMode) return null;
  const switching = dev.devBusy === "fixture";
  return (
    <SettingGroup title="Developer">
      <SwitchRow
        label="Test library"
        help={
          switching
            ? "Switching"
            : lib.fixtureOn
              ? "On: the generated test library is shown, and sync is off"
              : "Off: your own library is shown"
        }
        checked={lib.fixtureOn}
        onChange={(on) => void dev.switchFixtureRoot(on)}
        disabled={dev.devBusy !== "" || dl.dlBusy || proton.protonBusy !== "" || edits.undoBusy}
      />
      <SettingRow label="Self-test" help="Runs the bundled checks through this build; the result goes to the log">
        <Button small onClick={() => void dev.runSelfTest()} disabled={dev.devBusy !== ""}>
          {dev.devBusy === "selftest" ? "Testing" : "Run self-test"}
        </Button>
      </SettingRow>
      <SettingRow label="Index" help="Rebuilds the index from the files alone; the time goes to the log">
        <Button small onClick={() => void dev.rebuildIndex()} disabled={dev.devBusy !== "" || !lib.folder}>
          {dev.devBusy === "rebuild" ? "Rebuilding" : "Rebuild index"}
        </Button>
      </SettingRow>
    </SettingGroup>
  );
}

export function SettingsSheet({ queuePane }: { queuePane?: QueuePaneSetting }) {
  const { phone } = useApp();
  const open = phone.mSettings;
  const setOpen = phone.setMSettings;
  const [sub, setSub] = useState<"log" | "links" | null>(null);
  const [version, setVersion] = useState("");

  useSettingsShortcut(setOpen);

  // The running build's version, asked once the sheet first opens.
  useEffect(() => {
    if (!open || version) return;
    let live = true;
    invoke<Diagnostics>("diagnostics", { libraryDir: null })
      .then((d) => live && setVersion(d.appVersion))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, version]);

  return (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title="Settings" tall className="SettingsSheet">
        <LibraryGroup />
        <YouTubeGroup onShowLinks={() => setSub("links")} />
        <ProtonGroup />
        <AppearanceGroup queuePane={queuePane} />
        <ToolsGroup onViewLog={() => setSub("log")} />
        <AboutGroup version={version} />
        <DeveloperGroup />
      </Sheet>
      {open && sub === "log" && <LogSheet onClose={() => setSub(null)} />}
      {open && sub === "links" && <LinksWaitingSheet onClose={() => setSub(null)} />}
    </>
  );
}
