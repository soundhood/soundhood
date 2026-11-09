// The sidebar (desktop; the rail on a tablet): the wordmark, the search field, Playlists, Artists,
// Folders and Playing with their counts, the playlists (the playing one marked), Settings, and the
// collapse button and the resizable edge, both remembered (useShellPrefs).
import { SearchField, Sidebar, type NavEntry } from "../design";
import { useMosaics } from "../hooks/useCovers";
import type { ShellPrefs } from "../hooks/useShellPrefs";
import type { TopTab } from "../hooks/useNavigation";
import { detailTitle } from "../features/library/TrackListScreen";
import { useApp } from "./context";

type NavId = TopTab | "playing";

export function AppSidebar({ prefs }: { prefs: ShellPrefs }) {
  const { lib, nav, player, actions } = useApp();
  const lists = lib.playlistFiles.map((p) => (lib.tracksOfPlaylist.get(p.name) ?? []).map((t) => t.path));
  const covers = useMosaics(lists);
  const folderCount = lib.folders.filter((f) => f !== "(all)").length;

  const entries: NavEntry<NavId>[] = [
    { id: "playlists", label: "Playlists", icon: "playlists", count: lib.playlistFiles.length },
    { id: "artists", label: "Artists", icon: "artists", count: lib.artists.length },
    { id: "folders", label: "Folders", icon: "folders", count: folderCount },
    { id: "playing", label: "Playing", icon: "playing", disabled: !player.currentPath },
  ];
  // A playlist open from the sidebar is marked there, not under Playlists.
  const openPlaylist = nav.screen === "detail" && nav.detail?.kind === "playlist" ? nav.detail.name : null;
  const current: NavId | null = nav.playing ? "playing" : openPlaylist || nav.screen === "search" ? null : nav.tab;
  const playingFrom = player.currentPath && nav.source?.kind === "playlist" ? nav.source.name : null;
  const placeholder = nav.screen === "detail" && nav.detail ? `Search in ${detailTitle(nav.detail)}` : "Search your library";

  return (
    <Sidebar<NavId>
      nav={entries}
      current={current}
      onNavigate={nav.goTo}
      search={<SearchField value={nav.query} onChange={nav.setQuery} placeholder={placeholder} shortcut />}
      playlists={lib.playlistFiles.map((p, i) => ({
        id: p.name,
        name: p.name,
        covers: covers[i],
        playing: p.name === playingFrom,
        paused: !player.isPlaying,
      }))}
      currentPlaylist={openPlaylist}
      onOpenPlaylist={(name) => nav.openDetail({ kind: "playlist", name })}
      onNewPlaylist={lib.folder ? () => actions.newPlaylist() : undefined}
      onSettings={actions.openSettings}
      width={prefs.sidebarWidth}
      onWidthChange={prefs.setSidebarWidth}
      collapsed={prefs.sidebarCollapsed}
      onCollapsedChange={prefs.setSidebarCollapsed}
    />
  );
}
