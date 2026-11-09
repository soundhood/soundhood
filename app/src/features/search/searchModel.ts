// Instant search over the library, no index: songs (title, artist, file name), artists, playlists and
// folders whose names hold every word typed, ignoring case and accents. Pure, no React.
import type { PlaylistFile, Track } from "../../lib/types";

export type SearchKind = "all" | "songs" | "artists" | "playlists" | "folders";

export interface SearchResults {
  songs: Track[];
  artists: { name: string; count: number }[];
  playlists: PlaylistFile[];
  folders: string[];
  total: number;
}

/** Lower case without accents ("Café" -> "cafe"). */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** The words typed, folded; an empty list for nothing but spaces. */
export function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

const hasAll = (text: string, ws: readonly string[]) => {
  const t = fold(text);
  return ws.every((w) => t.includes(w));
};

export function searchLibrary(
  query: string,
  lib: {
    tracks: readonly Track[];
    artists: readonly { name: string; count: number }[];
    playlistFiles: readonly PlaylistFile[];
    folders: readonly string[];
  },
): SearchResults {
  const ws = words(query);
  if (ws.length === 0) return { songs: [], artists: [], playlists: [], folders: [], total: 0 };
  const songs = lib.tracks.filter((t) => hasAll(`${t.title} ${t.artist} ${t.name}`, ws));
  const artists = lib.artists.filter((a) => hasAll(a.name, ws));
  const playlists = lib.playlistFiles.filter((p) => hasAll(p.name, ws));
  const folders = lib.folders.filter((f) => f !== "(all)" && f !== "(root)" && hasAll(f, ws));
  return { songs, artists, playlists, folders, total: songs.length + artists.length + playlists.length + folders.length };
}
