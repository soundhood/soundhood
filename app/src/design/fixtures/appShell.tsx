// The whole app shell as the fixture pages draw it: sidebar, a main screen, the queue in the right
// pane, the player bar, and the phone's mini player and tabs, all with invented data. Pages that
// photograph a shell-level component (Shell, Sidebar, RightPane, PlayerBar, BottomTabs, FullPlayer,
// Sheet, Toast, BatchReport) build on it; every viewport then shows the layout its width gets.
import { useState, type ReactNode } from "react";
import { BottomTabs, type Tab } from "../components/BottomTabs";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { MiniPlayer } from "../components/MiniPlayer";
import { PlayerBar } from "../components/PlayerBar";
import { CardGrid, PlaylistCard } from "../components/PlaylistCard";
import { Queue, type QueueSection } from "../components/Queue";
import { ScreenHeader } from "../components/ScreenHeader";
import { SearchField } from "../components/SearchField";
import { RightPane, Shell } from "../components/Shell";
import { Sidebar, type NavEntry } from "../components/Sidebar";
import { NOW, PLAYLISTS, TINT, TRACKS, grey, meta, noop, type FxTrack } from "./data";

export type View = "playlists" | "artists" | "folders" | "playing";

export const TABS: Tab<View>[] = [
  { id: "playlists", label: "Playlists", icon: "playlists" },
  { id: "artists", label: "Artists", icon: "artists" },
  { id: "folders", label: "Folders", icon: "folders" },
  { id: "playing", label: "Playing", icon: "playing" },
];

const NAV: NavEntry<View>[] = [
  { id: "playlists", label: "Playlists", icon: "playlists", count: PLAYLISTS.length },
  { id: "artists", label: "Artists", icon: "artists", count: 12 },
  { id: "folders", label: "Folders", icon: "folders", count: 4 },
  { id: "playing", label: "Playing", icon: "playing" },
];

export const getProgress = () => 0.42;
export const POSITION = Math.round(NOW.seconds * 0.42);

/** A cover as drawn: itself, or its greyscale stand-in under a blurred backdrop. */
type Paint = (cover: string) => string;
const asIs: Paint = (c) => c;

const item = (t: FxTrack, paint: Paint = asIs) => ({
  key: t.key,
  title: t.title,
  artist: t.artist,
  duration: t.duration,
  cover: paint(t.cover),
});

/** The queue with working reorder and remove, so the fixture doubles as a playground. */
export function useQueueFixture(paint: Paint = asIs) {
  const [sections, setSections] = useState<QueueSection[]>([
    { id: "queue", label: "Next in queue", items: [TRACKS[8], TRACKS[1]].map((t) => item(t, paint)) },
    { id: "source", label: "Next from Late Night Drive", items: TRACKS.slice(4, 12).map((t) => item(t, paint)) },
  ]);
  const edit = (id: string, f: (items: QueueSection["items"][number][]) => void) =>
    setSections((all) =>
      all.map((s) => {
        if (s.id !== id) return s;
        const items = [...s.items];
        f(items);
        return { ...s, items };
      }),
    );
  return {
    now: item(NOW, paint),
    sections,
    onMove: (id: string, from: number, to: number) =>
      edit(id, (items) => {
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
      }),
    onRemove: (id: string, index: number) => edit(id, (items) => void items.splice(index, 1)),
    onClear: () => setSections((all) => all.map((s) => ({ ...s, items: [] }))),
    onSaveAsPlaylist: noop,
  };
}

export function PlaylistsScreen({ paint = asIs }: { paint?: Paint }) {
  const [query, setQuery] = useState("");
  return (
    <>
      <ScreenHeader
        title="Playlists"
        meta={<span className="is-wide-only">{PLAYLISTS.length} playlists</span>}
        actions={
          <>
            <IconButton icon="plus" label="New playlist" className="is-narrow-only" />
            <Button small icon="plus" className="is-wide-only">
              New playlist
            </Button>
            <IconButton icon="settings" label="Settings" className="is-narrow-only" />
          </>
        }
        search={<SearchField value={query} onChange={setQuery} />}
      />
      <CardGrid label="Playlists">
        {PLAYLISTS.map((p) => (
          <PlaylistCard key={p.id} name={p.name} meta={meta(p)} covers={p.covers.map(paint)} playing={p.playing} />
        ))}
      </CardGrid>
    </>
  );
}

export interface AppShellProps {
  view?: View;
  main?: ReactNode;
  /** Show the queue in the right pane (desktop). */
  right?: boolean;
  overlays?: ReactNode;
  collapsed?: boolean;
  /** Fixture frame class: Fx-full (the viewport) or Fx-shell (640 px). */
  frame?: string;
  /** Greyscale covers, for pages with a blurred backdrop over the shell. */
  mono?: boolean;
}

export function AppShell({
  view = "playlists",
  main,
  right = true,
  overlays,
  collapsed: startCollapsed,
  frame = "Fx-full",
  mono,
}: AppShellProps) {
  const paint: Paint = mono ? grey : asIs;
  const [width, setWidth] = useState(240);
  const [collapsed, setCollapsed] = useState(!!startCollapsed);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<View>(view);
  const [playing, setPlaying] = useState(true);
  const queue = useQueueFixture(paint);
  const sidebarPlaylists = PLAYLISTS.map((p) => ({ id: p.id, name: p.name, covers: p.covers.map(paint), playing: p.playing }));

  return (
    <div className={frame}>
      <Shell
        tint={TINT}
        view={current === "playing" ? "playing" : undefined}
        sidebarWidth={width}
        sidebarCollapsed={collapsed}
        sidebar={
          <Sidebar
            nav={NAV}
            current={current}
            onNavigate={setCurrent}
            search={<SearchField value={query} onChange={setQuery} shortcut />}
            playlists={sidebarPlaylists}
            onOpenPlaylist={noop}
            onNewPlaylist={noop}
            onSettings={noop}
            width={width}
            onWidthChange={setWidth}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          />
        }
        main={main ?? <PlaylistsScreen paint={paint} />}
        right={
          right ? (
            <RightPane label="Queue">
              <Queue heading {...queue} />
            </RightPane>
          ) : undefined
        }
        bar={
          <PlayerBar
            title={NOW.title}
            artist={NOW.artist}
            cover={paint(NOW.cover)}
            playing={playing}
            onPlayPause={() => setPlaying(!playing)}
            shuffle
            repeat="off"
            onRepeat={noop}
            position={POSITION}
            duration={NOW.seconds}
            volume={70}
            onAddToPlaylist={noop}
            onQueue={noop}
            queueOpen={right}
            onToggleFull={() => setCurrent(current === "playing" ? "playlists" : "playing")}
            fullOpen={current === "playing"}
          />
        }
        bottom={
          <>
            <MiniPlayer
              title={NOW.title}
              artist={NOW.artist}
              cover={paint(NOW.cover)}
              playing={playing}
              getProgress={getProgress}
              onPlayPause={() => setPlaying(!playing)}
              onOpen={() => setCurrent("playing")}
            />
            <BottomTabs tabs={TABS} current={current} onChange={setCurrent} />
          </>
        }
        overlays={overlays}
      />
    </div>
  );
}
