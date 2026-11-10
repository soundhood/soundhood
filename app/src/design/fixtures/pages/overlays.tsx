// Fixture pages: overlays and task surfaces.
import { useEffect, useState } from "react";
import { BatchReport, type BatchRow } from "../../components/BatchReport";
import { Button } from "../../components/Button";
import { Dropdown, MultiSelect } from "../../components/Dropdown";
import { OnboardingStep } from "../../components/OnboardingStep";
import { SelectModeBar } from "../../components/SelectModeBar";
import { SettingGroup, SettingRow, SwitchRow, ValueRow } from "../../components/Settings";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { TextField } from "../../components/TextField";
import { TidyRow } from "../../components/TidyRow";
import { ToastProvider, ToastViewport, useToast } from "../../components/Toast";
import { TrackRow } from "../../components/TrackRow";
import { AppShell } from "../appShell";
import { PLAYLISTS, TRACKS, noop, row } from "../data";
import { Demo, Page, Surface } from "../frame";

const FOLDERS = [
  { value: "downloads", label: "Downloads" },
  { value: "rips", label: "Rips" },
  { value: "vinyl", label: "Vinyl" },
  { value: "new", label: "New folder" },
];
const LISTS = PLAYLISTS.map((p) => ({ value: p.id, label: p.name }));

function WhereSheet() {
  const [folder, setFolder] = useState("downloads");
  const [lists, setLists] = useState<string[]>([LISTS[0].value]);
  return (
    <Sheet
      open
      onClose={noop}
      title="Where should this go?"
      footer={
        <>
          <Button variant="text">Cancel</Button>
          <Button>Queue</Button>
          <Button variant="primary" icon="download">
            Download
          </Button>
        </>
      }
    >
      <SettingRow label="Link" stacked>
        <TextField aria-label="Link" defaultValue="youtube.com/watch?v=Glass-Tides-Live" readOnly />
      </SettingRow>
      <SettingRow label="Folder" help="Where the file is saved">
        <Dropdown label="Folder" options={FOLDERS} value={folder} onChange={setFolder} />
      </SettingRow>
      <SettingRow label="Playlists" help="The song joins these">
        <MultiSelect label="Playlists" options={LISTS} values={lists} onChange={setLists} />
      </SettingRow>
    </Sheet>
  );
}

function SheetPage() {
  return <AppShell mono overlays={<WhereSheet />} />;
}

function ShowToasts() {
  const toast = useToast();
  useEffect(() => {
    const a = toast.show({ text: "Downloading 2 of 5: Glass Tides", progress: 0.4, persistent: true, action: { label: "Hide", onClick: noop } });
    const b = toast.show({ text: "Added Northbound to Late Night Drive", persistent: true, action: { label: "Undo", onClick: noop } });
    return () => {
      toast.dismiss(a);
      toast.dismiss(b);
    };
  }, [toast]);
  return <ToastViewport />;
}

function ToastPage() {
  return (
    <ToastProvider>
      <AppShell right={false} overlays={<ShowToasts />} />
    </ToastProvider>
  );
}

function SettingsPage() {
  const [right, setRight] = useState(true);
  const [lookups, setLookups] = useState(false);
  const [density, setDensity] = useState("comfortable");
  return (
    <Page title="Settings rows" note="Groups under overline headings; a row is a label, a help line and one control.">
      <Surface>
        <SettingGroup title="Library">
          <SettingRow label="Music folder" help="Music">
            <Button small>Change</Button>
          </SettingRow>
          <SettingRow label="Rescan library" help="Finds new and changed files. Writes nothing.">
            <Button small>Rescan</Button>
          </SettingRow>
          <SettingRow label="Undo last change" help="Edited the tags of Night Ferry, today 14:02">
            <Button small icon="undo">
              Undo
            </Button>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title="YouTube">
          <SettingRow label="Download a link" stacked>
            <div className="SettingRow-inline">
              <TextField placeholder="Paste a YouTube link" aria-label="Link" />
              <Button small icon="paste">
                Paste
              </Button>
            </div>
          </SettingRow>
          <ValueRow label="Links waiting" value="2" onClick={noop} />
        </SettingGroup>
        <SettingGroup title="Online lookups">
          <SwitchRow
            label="Look up covers and lyrics"
            help="Nothing is sent anywhere while this is off."
            checked={lookups}
            onChange={setLookups}
          />
        </SettingGroup>
        <SettingGroup title="Appearance">
          <SettingRow label="Density">
            <Dropdown
              label="Density"
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
              value={density}
              onChange={setDensity}
            />
          </SettingRow>
          <SwitchRow label="Show the queue beside the list" help="On wide windows" checked={right} onChange={setRight} />
        </SettingGroup>
        <SettingGroup title="About">
          <SettingRow label="Soundhood 0.3.0" help="Inter typeface, SIL Open Font License 1.1" />
        </SettingGroup>
      </Surface>
    </Page>
  );
}

const BATCH: BatchRow[] = [
  ...TRACKS.slice(0, 10).map((t, i) => ({
    key: t.key,
    before: `${t.artist.toLowerCase()} - ${t.title.toLowerCase()} (official audio).m4a`,
    after: `${t.artist} - ${t.title}.m4a`,
    status: (i === 6 ? "skipped" : i === 8 ? "failed" : "done") as BatchRow["status"],
    reason: i === 6 ? "Already named this way" : i === 8 ? "The file is open in another app" : undefined,
  })),
];

function BatchReportPage() {
  return (
    <AppShell
      mono
      overlays={
        <BatchReport
          open
          title="Renamed 8 songs"
          rows={BATCH}
          reasons={["1 skipped: already named this way", "1 failed: the file is open in another app"]}
          onUndo={noop}
          onDone={noop}
        />
      }
    />
  );
}

function TidyRowPage() {
  const [ticks, setTicks] = useState([true, true, false, false]);
  const tick = (i: number) => (v: boolean) => setTicks(ticks.map((t, j) => (j === i ? v : t)));
  return (
    <Page title="TidyRow" note="A proposed change: before and after (changed parts in --fg-0), a confidence hint and the reason.">
      <Surface>
        <TidyRow
          checked={ticks[0]}
          onChange={tick(0)}
          before={[{ text: "Neon Harbor - Glass Tides" }, { text: " (Official Video)", changed: true }, { text: ".m4a" }]}
          after={[{ text: "Neon Harbor - Glass Tides.m4a" }]}
          confidence="high"
          reason="Video words removed from the name"
        />
        <TidyRow
          checked={ticks[1]}
          onChange={tick(1)}
          before={[{ text: "copper kites", changed: true }, { text: " - " }, { text: "night ferry", changed: true }, { text: ".mp3" }]}
          after={[{ text: "Copper Kites", changed: true }, { text: " - " }, { text: "Night Ferry", changed: true }, { text: ".mp3" }]}
          confidence="medium"
          reason="Title case, like the rest of the folder"
        />
        <TidyRow
          checked={ticks[2]}
          onChange={tick(2)}
          before={[{ text: "Track 07", changed: true }, { text: ".flac" }]}
          after={[{ text: "Velvet Static - Slow Static", changed: true }, { text: ".flac" }]}
          confidence="low"
          reason="Name taken from the tags; the tags may be wrong"
        />
        <TidyRow
          checked={ticks[3]}
          onChange={tick(3)}
          before={[{ text: "Harbour Lights" }, { text: " (1)", changed: true }, { text: ".m4a" }]}
          after={[{ text: "Harbour Lights.m4a" }]}
          confidence="high"
          reason="A copy of a song already in Rips"
        />
      </Surface>
    </Page>
  );
}

function SelectModeBarPage() {
  const songs = TRACKS.slice(0, 7);
  const [chosen, setChosen] = useState<string[]>([songs[1].key, songs[2].key, songs[4].key]);
  const actions = [
    { id: "play", label: "Play", icon: "play" as const, onClick: noop },
    { id: "queue", label: "Add to queue", icon: "queue" as const, onClick: noop },
    { id: "playlist", label: "Add to playlist", icon: "playlistAdd" as const, onClick: noop },
  ];
  const more = [
    { id: "move", label: "Move", icon: "folders" as const, onClick: noop },
    { id: "tags", label: "Edit tags", icon: "edit" as const, onClick: noop },
    { id: "delete", label: "Delete", icon: "trash" as const, danger: true, onClick: noop },
  ];
  return (
    <Page title="SelectModeBar" note="The count, Select all and the actions; the rarer ones in More. Below the desktop width: Leave, the two actions the screen picks (here the first two) and More, with Select all and the rest in it. Esc leaves Select mode.">
      <Demo label="Three chosen">
        <SelectModeBar
          count={chosen.length}
          total={songs.length}
          onSelectAll={() => setChosen(songs.map((s) => s.key))}
          onSelectNone={() => setChosen([])}
          onExit={() => setChosen([])}
          actions={actions}
          more={more}
        />
        <div role="listbox" aria-label="Songs" aria-multiselectable="true">
          {songs.map((s) => (
            <TrackRow
              key={s.key}
              {...row(s)}
              check
              selected={chosen.includes(s.key)}
              onClick={() => setChosen(chosen.includes(s.key) ? chosen.filter((k) => k !== s.key) : [...chosen, s.key])}
            />
          ))}
        </div>
      </Demo>
    </Page>
  );
}

function OnboardingPage() {
  const [lookups, setLookups] = useState(false);
  return (
    <>
      <div className="Fx-page Fx-full">
        <div className="Shell-scope Fx-fill">
          <OnboardingStep
            step={1}
            total={3}
            icon="mark"
            title="Where is your music?"
            lines={["Pick the folder that holds your songs.", "Soundhood reads it and changes nothing until you ask."]}
            onSkip={noop}
            onNext={noop}
          >
            <Button icon="folders">Choose folder</Button>
            <span className="Fx-note">Music: 2,400 songs found</span>
          </OnboardingStep>
        </div>
      </div>
      <div className="Fx-page Fx-full">
        <div className="Shell-scope Fx-fill">
          <OnboardingStep
            step={2}
            total={3}
            icon="globe"
            title="Online lookups"
            lines={["Finds missing covers and lyrics for your songs.", "Nothing is sent anywhere while this is off."]}
            onSkip={noop}
            onNext={noop}
          >
            <label className="Fx-switch">
              <span>Online lookups</span>
              <Switch checked={lookups} onChange={setLookups} aria-label="Online lookups" />
            </label>
          </OnboardingStep>
        </div>
      </div>
    </>
  );
}

export const OVERLAY_PAGES = {
  Sheet: SheetPage,
  Toast: ToastPage,
  Settings: SettingsPage,
  BatchReport: BatchReportPage,
  TidyRow: TidyRowPage,
  SelectModeBar: SelectModeBarPage,
  OnboardingStep: OnboardingPage,
};
