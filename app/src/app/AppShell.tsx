// The app's one component tree for every size: the design system's Shell with its slots filled
// (README.md in this folder). Which slots show is the Shell's container query on its own width,
// never the platform. The main area scrolls; each screen gets its scroll position back when the
// user returns to it.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BottomTabs, RightPane, Shell, useArtworkTint, type Tab } from "../design";
import { NowBar, NowMini } from "../features/player/PlayerSurfaces";
import { QueueUiProvider, useQueueUi } from "../features/queue/QueueUi";
import { QueueOverlays, QueuePane } from "../features/queue/QueueView";
import { useCover } from "../hooks/useCovers";
import type { TopTab } from "../hooks/useNavigation";
import { useShellPrefs } from "../hooks/useShellPrefs";
import { AppSidebar } from "./AppSidebar";
import { useApp, type Picker } from "./context";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { MainArea } from "./MainArea";
import { Overlays } from "./Overlays";

type TabId = TopTab | "playing";

/** Finds the Shell's scrolling main element once it exists, then renders the screens. */
function MainSlot() {
  // The element, kept in a ref (the lists scroll with it); `ready` renders the screens once it is known.
  const scroller = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const { nav } = useApp();
  const key = nav.screen === "detail" && nav.detail ? `detail:${nav.detail.kind}:${nav.detail.name}` : nav.screen;
  const positions = useRef(new Map<string, number>());
  const shownKey = useRef(key);
  const probe = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    scroller.current = el.closest<HTMLElement>(".Shell-main");
    setReady(!!scroller.current);
  }, []);

  // Each screen's scroll position is noted as it scrolls (when the next screen is drawn the old
  // position may already be cut short by a shorter page); coming back restores it, and a screen
  // seen for the first time starts at the top.
  useLayoutEffect(() => {
    const main = scroller.current;
    if (!ready || !main) return;
    const note = () => positions.current.set(shownKey.current, main.scrollTop);
    main.addEventListener("scroll", note, { passive: true });
    return () => main.removeEventListener("scroll", note);
  }, [ready]);
  useLayoutEffect(() => {
    const main = scroller.current;
    if (!main || shownKey.current === key) return;
    shownKey.current = key;
    main.scrollTop = positions.current.get(key) ?? 0;
  }, [key]);

  return (
    <div className="App-main" ref={probe}>
      {ready && <MainArea scroller={scroller} />}
    </div>
  );
}

type AppShellProps = { picker: Picker | null; closePicker: () => void; rightPane?: ReactNode };

/** The queue's open or closed state (QueueUi) is shared by the player surfaces, the pane and the keys. */
export function AppShell(props: AppShellProps) {
  return (
    <QueueUiProvider>
      <ShellView {...props} />
    </QueueUiProvider>
  );
}

function ShellView({ picker, closePicker, rightPane }: AppShellProps) {
  const { player, nav } = useApp();
  const queue = useQueueUi();
  // The queue in the right pane where the shell has room for it and the user opened it.
  const right = rightPane ?? (queue.paneFits && queue.paneOpen ? <QueuePane /> : null);
  const prefs = useShellPrefs();
  const cover = useCover(player.currentPath);
  const tint = useArtworkTint(cover?.url, cover?.hash);

  const tabs: Tab<TabId>[] = [
    { id: "playlists", label: "Playlists", icon: "playlists" },
    { id: "artists", label: "Artists", icon: "artists" },
    { id: "folders", label: "Folders", icon: "folders" },
    { id: "playing", label: "Playing", icon: "playing", disabled: !player.currentPath },
  ];
  const currentTab: TabId | null = nav.playing ? "playing" : nav.screen === "search" ? null : nav.tab;

  return (
    <Shell
      className="App"
      tint={tint}
      view={nav.playing ? "playing" : undefined}
      sidebarWidth={prefs.sidebarWidth}
      sidebarCollapsed={prefs.sidebarCollapsed}
      sidebar={<AppSidebar prefs={prefs} />}
      main={<MainSlot />}
      right={right ? <RightPane label="Queue">{right}</RightPane> : undefined}
      bar={<NowBar />}
      bottom={
        <>
          <NowMini />
          <BottomTabs tabs={tabs} current={currentTab} onChange={nav.goTo} />
        </>
      }
      overlays={
        <>
          <Overlays picker={picker} closePicker={closePicker} />
          <QueueOverlays />
          {/* Last, so the components that own a key handle it first. */}
          <KeyboardShortcuts />
        </>
      }
    />
  );
}
