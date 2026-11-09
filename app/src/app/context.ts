// What every screen of the shell reads: the hooks App wires together, the navigation, and the
// shell's shared actions (the add-to-playlist, new-playlist and move-to-folder sheets). Screens take
// it with useApp() instead of a dozen props; App provides it once (README.md in this folder).
import { createContext, useContext } from "react";
import type { DevMode } from "../hooks/useDevMode";
import type { Dialogs } from "../hooks/useDialogs";
import type { Downloads } from "../hooks/useDownloads";
import type { Library } from "../hooks/useLibrary";
import type { Log } from "../hooks/useLog";
import type { Navigation } from "../hooks/useNavigation";
import type { Notices } from "../hooks/useNotices";
import type { PhoneLayout } from "../hooks/usePhoneLayout";
import type { Player } from "../hooks/usePlayer";
import type { Playlists } from "../hooks/usePlaylists";
import type { Prefs } from "../hooks/usePrefs";
import type { Proton } from "../hooks/useProton";
import type { Selection } from "../hooks/useSelection";
import type { TrackEdits } from "../hooks/useTrackEdits";
import type { Track } from "../lib/types";

/** The sheets the shell owns; any screen opens them. */
export type Picker =
  | { kind: "add"; tracks: Track[] }
  | { kind: "move"; tracks: Track[] }
  | { kind: "new"; tracks: Track[] };

export interface AppActions {
  /** "Add to playlist": the playlists sheet for these songs (with New playlist). */
  addToPlaylist: (tracks: Track[]) => void;
  /** "New playlist": asks for the name; with songs, adds them to it. */
  newPlaylist: (tracks?: Track[]) => void;
  /** "Move to folder": the folders sheet for these files. */
  moveToFolder: (tracks: Track[]) => void;
  /** Opens the settings sheet. */
  openSettings: () => void;
  /** Undoes the newest change in the journal (the Undo of a toast). */
  undoLast: () => void;
}

export interface AppContextValue {
  /** The host is a phone (Proton sync, the app's own bin). Never used to pick a layout. */
  isMobile: boolean;
  lib: Library;
  player: Player;
  sel: Selection;
  dialogs: Dialogs;
  playlists: Playlists;
  edits: TrackEdits;
  dl: Downloads;
  log: Log;
  proton: Proton;
  dev: DevMode;
  phone: PhoneLayout;
  nav: Navigation;
  actions: AppActions;
  /** Toasts and the log, where messages go (there is no status line). */
  notices: Notices;
  /** Text size, the downloader switch, the first-launch setup. */
  prefs: Prefs;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() needs the AppContext from App");
  return ctx;
}
