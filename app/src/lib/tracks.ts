// Pure helpers over tracks: playlist keys, artist names, display names, sort orders.
import type { Track } from "./types";

export const UNTAGGED = "(untagged)";
export const NEW_PLAYLIST_SENTINEL = "__newpl__";

// Absolute path → the key used inside playlist files: relative to the Music root, forward slashes.
export function relKey(root: string, abs: string): string {
  const r = root.replace(/[\\/]+$/, "");
  let rel = abs.startsWith(r) ? abs.slice(r.length) : abs;
  rel = rel.replace(/^[\\/]+/, "");
  return rel.replace(/\\/g, "/");
}

// "Schrotthagen, Giovanni Berg" / "A feat. B" → the individual names. Mirrors the Rust side:
// no splitting on "&" or "x", so "Earth, Wind & Fire" survives as "Earth" + "Wind & Fire" at worst.
// A track with no artist at all lands in the "(untagged)" bucket so it stays reachable.
export function splitArtists(artist: string): string[] {
  if (!artist) return [UNTAGGED];
  return artist
    .split(/\s*(?:,|\/|;|\bfeat\.?\s|\bft\.?\s)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Track-list sort orders. "natural" = playlist order inside a playlist, filename order elsewhere.
export const SORT_MODES = ["Natural order", "Title A→Z", "Title Z→A", "Artist A→Z", "Longest first", "Shortest first"] as const;
export type SortMode = (typeof SORT_MODES)[number];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortTracks(list: Track[], mode: SortMode): Track[] {
  if (mode === "Natural order") return list;
  const title = (t: Track) => t.title || displayName(t.name);
  const artist = (t: Track) => t.artist || "￿"; // untagged last
  const out = [...list];
  switch (mode) {
    case "Title A→Z": out.sort((a, b) => collator.compare(title(a), title(b))); break;
    case "Title Z→A": out.sort((a, b) => collator.compare(title(b), title(a))); break;
    case "Artist A→Z": out.sort((a, b) => collator.compare(artist(a), artist(b)) || collator.compare(title(a), title(b))); break;
    case "Longest first": out.sort((a, b) => b.duration_secs - a.duration_secs); break;
    case "Shortest first": out.sort((a, b) => a.duration_secs - b.duration_secs); break;
  }
  return out;
}

// Filename without extension: what the user should read as the title.
export function displayName(fileName: string) {
  return fileName.replace(/\.[^./\\]+$/, "");
}

// "Song - Artist" from a filename, the library convention.
export function titleArtistFromName(name: string): { title: string; artist: string } {
  const stem = displayName(name);
  const i = stem.lastIndexOf(" - ");
  if (i > 0 && i < stem.length - 3) {
    return { title: stem.slice(0, i).trim(), artist: stem.slice(i + 3).trim() };
  }
  return { title: stem.trim(), artist: "" };
}
