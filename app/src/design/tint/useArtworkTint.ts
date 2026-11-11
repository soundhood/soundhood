// useArtworkTint(url, key): the artwork tint for a cover, as a CSS colour for Shell's `tint`.
// Computed once per key (the cover's hash) in a module worker and kept in an in-memory cache;
// until it is ready, and on any error (no worker, no OffscreenCanvas, an unreadable cover), it is
// var(--bg-1). The colour change itself is animated by CSS (--tint is a registered property).
import { useEffect, useState } from "react";
import { TINT_FALLBACK } from "./tint";

const cache = new Map<string, string>();
const waiting = new Map<number, (tint: string) => void>();
let worker: Worker | null | undefined;
let seq = 0;

function tintWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") throw new Error("unsupported");
    const w = new Worker(new URL("./tintWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; tint: string | null }>) => {
      const done = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      done?.(e.data.tint ?? TINT_FALLBACK);
    };
    w.onerror = () => {
      for (const done of waiting.values()) done(TINT_FALLBACK);
      waiting.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** The tint for the cover at `url` (never rejects; TINT_FALLBACK on any failure). */
export function computeTint(url: string): Promise<string> {
  const w = tintWorker();
  if (!w) return Promise.resolve(TINT_FALLBACK);
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    w.postMessage({ id, url });
  });
}

/** The cached tint for `key`, if it was computed already. */
export function cachedTint(key: string): string | undefined {
  return cache.get(key);
}

export function useArtworkTint(url: string | null | undefined, key: string | null | undefined): string {
  const [result, setResult] = useState<{ key: string; tint: string } | null>(null);

  useEffect(() => {
    if (!url || !key || cache.has(key)) return;
    let live = true;
    void computeTint(url).then((tint) => {
      cache.set(key, tint);
      if (live) setResult({ key, tint });
    });
    return () => {
      live = false;
    };
  }, [url, key]);

  if (!url || !key) return TINT_FALLBACK;
  return cache.get(key) ?? (result?.key === key ? result.tint : TINT_FALLBACK);
}
