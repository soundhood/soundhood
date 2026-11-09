// Fixture pages: the shell and navigation.
import { useState } from "react";
import { BottomTabs } from "../../components/BottomTabs";
import { Chip, ChipRow } from "../../components/Chip";
import { IconButton } from "../../components/IconButton";
import { Queue } from "../../components/Queue";
import { ScreenHeader } from "../../components/ScreenHeader";
import { SearchField } from "../../components/SearchField";
import { RightPane } from "../../components/Shell";
import { AppShell, TABS, useQueueFixture, type View } from "../appShell";
import { TINT } from "../data";
import { Demo, Page, Surface } from "../frame";

function ShellPage() {
  return <AppShell />;
}

function ScreenHeaderPage() {
  const [query, setQuery] = useState("neon");
  const [chip, setChip] = useState("All");
  return (
    <Page title="ScreenHeader" note="h1 on the phone, display size on the desktop; the search field and chips show on the phone only.">
      <Demo label="A list screen">
        <ScreenHeader
          title="Playlists"
          meta="8 playlists"
          actions={
            <>
              <IconButton icon="plus" label="New playlist" />
              <IconButton icon="settings" label="Settings" />
            </>
          }
          search={<SearchField value="" onChange={() => {}} />}
        />
      </Demo>
      <Demo label="Searching">
        <ScreenHeader
          title="Search"
          meta="8 results for neon"
          actions={<IconButton icon="settings" label="Settings" />}
          search={<SearchField value={query} onChange={setQuery} />}
          chips={
            <ChipRow label="Show">
              {["All", "Songs", "Artists", "Playlists", "Folders"].map((c) => (
                <Chip key={c} pressed={c === chip} onClick={() => setChip(c)}>
                  {c}
                </Chip>
              ))}
            </ChipRow>
          }
        />
      </Demo>
      <Demo label="A long title">
        <ScreenHeader title="The Saltwater Radio Orchestra and Friends" meta="23 songs, 1 h 31 min" />
      </Demo>
    </Page>
  );
}

function BottomTabsPage() {
  const [current, setCurrent] = useState<View>("playlists");
  return (
    <Page title="BottomTabs" note="Four tabs; the active one aqua with a short bar on the top edge that slides to it. Keys 1 to 4 switch.">
      <Demo label="Playlists (try the keys 1 to 4)">
        <Surface flush>
          <BottomTabs tabs={TABS} current={current} onChange={setCurrent} />
        </Surface>
      </Demo>
      <Demo label="Folders">
        <Surface flush>
          <BottomTabs tabs={TABS} current="folders" onChange={() => {}} numberKeys={false} />
        </Surface>
      </Demo>
      <Demo label="Nothing playing: Playing disabled">
        <Surface flush>
          <BottomTabs
            tabs={TABS.map((t) => (t.id === "playing" ? { ...t, disabled: true } : t))}
            current="artists"
            onChange={() => {}}
            numberKeys={false}
          />
        </Surface>
      </Demo>
      <Demo label="Searching: no tab current">
        <Surface flush>
          <BottomTabs tabs={TABS} current={null} onChange={() => {}} numberKeys={false} />
        </Surface>
      </Demo>
    </Page>
  );
}

function SidebarPage() {
  return (
    <div className="Fx-stackshells">
      <AppShell frame="Fx-shell" right={false} />
      <AppShell frame="Fx-shell" right={false} collapsed />
    </div>
  );
}

function RightPanePage() {
  const queue = useQueueFixture();
  return (
    <Page title="RightPane" note="320 px on --bg-0 with the artwork tint across its top 40 %; it holds the queue. Desktop shells only." tint={TINT}>
      <div className="Fx-pane">
        <RightPane label="Queue">
          <Queue heading {...queue} />
        </RightPane>
      </div>
    </Page>
  );
}

export const SHELL_PAGES = {
  Shell: ShellPage,
  ScreenHeader: ScreenHeaderPage,
  BottomTabs: BottomTabsPage,
  Sidebar: SidebarPage,
  RightPane: RightPanePage,
};
