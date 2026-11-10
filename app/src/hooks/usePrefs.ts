// The settings Phase 1 adds, and the first-launch setup that asks for three of them. Each is one
// key in the settings store (lib/store.ts holds the older keys). useStartup reads them once, with
// everything else, and decides whether the setup shows (the migration rule, in decideOnboarding).
//
// - Text size: 100, 115 or 130 %, the root element's --text-scale (DECISIONS: type tokens multiply
//   by it).
// - Downloader: the download UI shows only while it is on. Off on a new install until the setup
//   (or Settings) turns it on; an existing install keeps downloading exactly as before.
// - Online lookups and "Keep download helper updated": asked by the setup and stored; nothing uses
//   them yet (lookups arrive in Phase 4 and 5, the helper manager in Phase 2), so Settings shows
//   no row for them until then.
import { useLayoutEffect, useState } from "react";
import { storePromise } from "../lib/store";

export const KEY_TEXT_SCALE = "text_scale";
export const KEY_DOWNLOADER = "downloader_enabled";
export const KEY_LOOKUPS = "online_lookups";
export const KEY_HELPER_UPDATES = "helper_auto_update";
export const KEY_ONBOARDED = "onboarding_done";

export const TEXT_SCALES = [1, 1.15, 1.3] as const;

/** What startup says (a toast; the reason goes to the log) when the settings store cannot be read. */
export const SETTINGS_UNREADABLE = "Settings could not be read: the downloader stays off (see the log)";

/** The setup's steps, in order. */
export type OnboardStep = "library" | "lookups" | "helper";

export type Prefs = ReturnType<typeof usePrefs>;

/**
 * Store keys an install before Phase 1 may have written. Any one of them means the app ran here
 * before: an existing install, which the setup must not disturb.
 */
export const EARLIER_KEYS = [
  "library_dir",
  "download_target",
  "download_playlists",
  "share_queue",
  "last_sync",
  "volume",
  "sort",
  "dev_mode",
  "fixture_root",
  "real_library_dir",
  "sidebar_width",
  "sidebar_collapsed",
] as const;

/**
 * The migration rule. A new install sees all three steps. An existing install keeps working exactly
 * as before: the downloader stays on and its step is not shown, the Library step shows only when no
 * folder is set, and Online lookups is not asked (it stays off; DESIGN.md: the setup is skipped by
 * the upgrade rule). Once finished or skipped the setup never shows again.
 */
export function decideOnboarding(a: { done: boolean; existing: boolean; hasFolder: boolean }): OnboardStep[] {
  if (a.done) return [];
  if (a.existing) return a.hasFolder ? [] : ["library"];
  return ["library", "lookups", "helper"];
}

async function save(values: Record<string, unknown>) {
  try {
    const store = await storePromise;
    for (const [key, value] of Object.entries(values)) await store.set(key, value);
    await store.save();
  } catch {
    /* non-fatal: the choice still applies for this session */
  }
}

export function usePrefs() {
  const [textScale, setTextScaleState] = useState<number>(1);
  // On until startup has read the store: an existing install (the common case) never sees the
  // download UI blink out and back.
  const [downloader, setDownloaderState] = useState<boolean>(true);
  // Startup has read the store: until then `downloader` is that default, and nothing downloads on it
  // (useDownloads: the Download item and the sheet do not open, a shared link waits).
  const [loaded, setLoaded] = useState<boolean>(false);
  // The store could not be read at startup: every setting is its default, but the downloader is off
  // (never on by default), and Settings says why.
  const [unreadable, setUnreadable] = useState<boolean>(false);
  const [lookups, setLookupsState] = useState<boolean>(false);
  const [helperUpdates, setHelperUpdatesState] = useState<boolean>(false);
  // The setup's remaining steps; null or empty: not shown.
  const [onboarding, setOnboarding] = useState<OnboardStep[] | null>(null);

  // The text size is a variable on the root element, where the type tokens resolve.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (textScale === 1) root.style.removeProperty("--text-scale");
    else root.style.setProperty("--text-scale", String(textScale));
  }, [textScale]);

  return {
    textScale,
    downloader,
    loaded,
    unreadable,
    lookups,
    helperUpdates,
    onboarding,
    /** Startup: the stored values, without writing them back. */
    load(v: { textScale?: number; downloader?: boolean; lookups?: boolean; helperUpdates?: boolean }) {
      if (v.textScale !== undefined && (TEXT_SCALES as readonly number[]).includes(v.textScale)) setTextScaleState(v.textScale);
      if (v.downloader !== undefined) setDownloaderState(v.downloader);
      if (v.lookups !== undefined) setLookupsState(v.lookups);
      if (v.helperUpdates !== undefined) setHelperUpdatesState(v.helperUpdates);
      setLoaded(true);
    },
    /** Startup could not read the store: the defaults stand, with the downloader off. */
    loadUnreadable() {
      setDownloaderState(false);
      setUnreadable(true);
      setLoaded(true);
    },
    setOnboarding,
    setTextScale(v: number) {
      setTextScaleState(v);
      void save({ [KEY_TEXT_SCALE]: v });
    },
    setDownloader(v: boolean) {
      setDownloaderState(v);
      void save({ [KEY_DOWNLOADER]: v });
    },
    setLookups(v: boolean) {
      setLookupsState(v);
      void save({ [KEY_LOOKUPS]: v });
    },
    setHelperUpdates(v: boolean) {
      setHelperUpdatesState(v);
      void save({ [KEY_HELPER_UPDATES]: v });
    },
    /** The setup is over (finished or skipped): it never shows again. */
    finishOnboarding() {
      setOnboarding(null);
      void save({ [KEY_DOWNLOADER]: downloader, [KEY_LOOKUPS]: lookups, [KEY_HELPER_UPDATES]: helperUpdates, [KEY_ONBOARDED]: true });
    },
  };
}
