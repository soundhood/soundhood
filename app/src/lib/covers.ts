// Cover art for lists: the picture embedded in a track's file, fetched from the host (`cover_art`)
// only for rows that are on screen, a few at a time, and kept as blob URLs. Identical pictures (the
// songs of one album) share one URL, so a playlist's mosaic can tell its covers apart by URL alone.
// The player keeps its own cover of the playing song (usePlayer); this cache is for rows, cards and
// the artwork tint's key.
import { invoke } from "@tauri-apps/api/core";

export type Cover = { url: string; hash: string };

/** How many cover reads run at once. */
const PARALLEL = 4;
/** How many pictures stay in memory; the oldest unused ones are let go first. */
const KEEP = 600;

/** path -> the cover (null: the file has none or it could not be read). */
const byPath = new Map<string, Cover | null>();
/** content hash -> blob URL, so identical pictures share one URL. */
const byHash = new Map<string, string>();
/** Reads not finished yet, with who still wants each one. */
const inFlight = new Map<string, { promise: Promise<Cover | null>; wants: Set<() => boolean> }>();
const waiting: { start: () => void; wanted: () => boolean }[] = [];
let running = 0;

function mimeOf(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/** FNV-1a over the bytes, with the length: enough to tell album covers apart. */
function hashOf(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${b.length}`;
}

function remember(path: string, cover: Cover | null) {
  byPath.delete(path);
  byPath.set(path, cover);
  if (byPath.size <= KEEP) return;
  // Let go of the oldest entries; a URL is revoked only when no remembered path still uses it.
  const drop = [...byPath.keys()].slice(0, byPath.size - KEEP);
  for (const p of drop) byPath.delete(p);
  const used = new Set([...byPath.values()].map((c) => c?.hash));
  for (const [hash, url] of byHash) {
    if (!used.has(hash)) {
      URL.revokeObjectURL(url);
      byHash.delete(hash);
    }
  }
}

async function read(path: string): Promise<Cover | null> {
  try {
    const buf = await invoke<ArrayBuffer>("cover_art", { path });
    if (!buf || buf.byteLength < 16) return null;
    const bytes = new Uint8Array(buf);
    const hash = hashOf(bytes);
    let url = byHash.get(hash);
    if (!url) {
      url = URL.createObjectURL(new Blob([buf], { type: mimeOf(bytes) }));
      byHash.set(hash, url);
    }
    return { url, hash };
  } catch {
    return null;
  }
}

function pump() {
  while (running < PARALLEL && waiting.length) {
    const next = waiting.shift()!;
    if (!next.wanted()) continue;
    running++;
    next.start();
  }
}

/** The cover already known for `path`: a Cover, null (none), or undefined (not read yet). */
export function knownCover(path: string): Cover | null | undefined {
  return byPath.get(path);
}

/**
 * Reads the cover of `path` (once; later calls share the answer). `wanted` is asked just before the
 * read starts, so a row that scrolled away before its turn costs nothing.
 */
export function loadCover(path: string, wanted: () => boolean = () => true): Promise<Cover | null> {
  if (byPath.has(path)) return Promise.resolve(byPath.get(path) ?? null);
  const pending = inFlight.get(path);
  if (pending) {
    pending.wants.add(wanted);
    return pending.promise;
  }
  const wants = new Set([wanted]);
  const promise = new Promise<Cover | null>((resolve) => {
    waiting.push({
      wanted: () => {
        if ([...wants].some((w) => w())) return true;
        inFlight.delete(path);
        resolve(null);
        return false;
      },
      start: () => {
        void read(path).then((cover) => {
          running--;
          inFlight.delete(path);
          remember(path, cover);
          resolve(cover);
          pump();
        });
      },
    });
  });
  inFlight.set(path, { promise, wants });
  pump();
  return promise;
}

/** Forgets every cover (a rescan or another library: the files may have changed). */
export function forgetCovers() {
  byPath.clear();
  for (const url of byHash.values()) URL.revokeObjectURL(url);
  byHash.clear();
}
