// Cover art for rows and cards (lib/covers.ts does the reading and the caching).
//   useCover(path)        the picture of one track, once it has been read (null until then or if none)
//   useMosaics(lists)     per playlist, the first four different pictures of its songs, for a Mosaic
import { useEffect, useState } from "react";
import { knownCover, loadCover, type Cover } from "../lib/covers";

/** The cover of the track at `path`; null while it is read and when the file has none. */
export function useCover(path: string | null | undefined): Cover | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!path || knownCover(path) !== undefined) return;
    let live = true;
    void loadCover(path, () => live).then(() => {
      if (live) setTick((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return path ? (knownCover(path) ?? null) : null;
}

/** How many songs of a playlist are looked at for its mosaic. */
const LOOK_AT = 16;

/** The mosaic from what is already read, or undefined when a read is still needed. */
function mosaicFromCache(paths: readonly string[]): string[] | undefined {
  const urls: string[] = [];
  for (const p of paths.slice(0, LOOK_AT)) {
    const c = knownCover(p);
    if (c === undefined) return undefined;
    if (c && !urls.includes(c.url)) urls.push(c.url);
    if (urls.length === 4) break;
  }
  return urls;
}

/**
 * For each playlist (its songs' paths in order), the first four different covers, read four songs
 * at a time until four are found; fewer when the playlist has fewer (the Mosaic then shows one).
 * One hook for any number of playlists (the Playlists grid, the sidebar).
 */
export function useMosaics(lists: readonly (readonly string[])[]): string[][] {
  const keys = lists.map((paths) => paths.slice(0, LOOK_AT).join("\n"));
  const all = keys.join("\0");
  const [, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const todo = all ? all.split("\0").filter((k) => mosaicFromCache(k ? k.split("\n") : []) === undefined) : [];
    if (todo.length === 0) return;
    void (async () => {
      for (const key of todo) {
        const list = key ? key.split("\n") : [];
        const urls: string[] = [];
        for (let i = 0; i < list.length && urls.length < 4 && live; i += 4) {
          const batch = await Promise.all(list.slice(i, i + 4).map((p) => loadCover(p, () => live)));
          for (const c of batch) if (c && !urls.includes(c.url) && urls.length < 4) urls.push(c.url);
        }
        if (!live) return;
        setTick((n) => n + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [all]);

  // Partly read lists show what is known so far only once complete, so a mosaic never jumps
  // from one cover to four.
  return keys.map((k) => mosaicFromCache(k ? k.split("\n") : []) ?? []);
}
