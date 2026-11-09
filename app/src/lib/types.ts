// Shapes the UI shares between its hooks and views.

/** One audio file as the host's scan returns it. */
export type Track = {
  path: string;
  name: string;
  playlist: string;
  title: string;
  artist: string;
  duration_secs: number;
};

/** A playlist file (.m3u8 in _Playlists): its name and its entries, relative to the Music root. */
export type PlaylistFile = { name: string; entries: string[] };

/** A link waiting to be downloaded, with the folder and playlists it was given. */
export type QueuedLink = { url: string; added: number; target?: string; playlists?: string[] };

/** What the phone's in-app yt-dlp answers when a download ends. */
export type PhoneDownloadResult = { exitCode: number; files: string[]; log: string };

/** The "Where should this go?" choices for a link that just arrived. */
export type QueueDraft = { url: string; target: string; playlists: string[] };

/** The tag editor's fields for one track. */
export type TagDraft = { track: Track; title: string; artist: string };

/** The phone's Proton Drive session as the plugin reports it. */
export type ProtonStatus = { bundled: boolean; connected: boolean; username: string };

/** The phone's Proton Drive login fields. */
export type ProtonForm = { username: string; password: string; twofa: string };

/** What the player held when it let go of a file that is about to be rewritten or moved. */
export type HeldPlayback = { pos: number; wasPlaying: boolean; viaBytes: boolean };

/** The phone layout's screens: browse = Playlists/Artists/Folders, tracks = the song list, player = now playing. */
export type PhoneScreen = "browse" | "tracks" | "player";

/** The left panel's tabs: playlist files, artists (from tags), folders (storage). */
export type SideTab = "playlists" | "artists" | "folders";

/** Which developer tool is running ("" = none). */
export type DevBusy = "" | "fixture" | "selftest" | "rebuild";

/** Which Proton Drive action is running ("" = none). */
export type ProtonBusy = "" | "login" | "sync";
