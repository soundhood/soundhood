// Where downloads land and which playlists they join: a first-level folder under the Music root (a
// playlist), and the playlists a finished download is added to. Both are remembered between
// downloads (the settings store; startup reads them back) and offered in "Where should this go?".
import { useEffect, useMemo, useRef, useState } from "react";
import { checkFolderName, folderNameRefusal } from "../folderName";
import { DEFAULT_DOWNLOAD_TARGET, KEY_DOWNLOAD_PLAYLISTS, KEY_DOWNLOAD_TARGET, storePromise } from "../lib/store";
import type { Track } from "../lib/types";
import type { Notices } from "./useNotices";

export function useDownloadTarget({ allTracks, notify }: { allTracks: Track[]; notify: Notices["notify"] }) {
  const [dlTarget, setDlTarget] = useState<string>(DEFAULT_DOWNLOAD_TARGET);
  const [dlPlaylists, setDlPlaylists] = useState<string[]>([]);
  // The playlists as chosen last, for a draft opened later than the render that saw them.
  const dlPlaylistsRef = useRef<string[]>([]);
  useEffect(() => {
    dlPlaylistsRef.current = dlPlaylists;
  }, [dlPlaylists]);

  async function chooseDlPlaylists(next: string[]) {
    setDlPlaylists(next);
    try {
      const store = await storePromise;
      await store.set(KEY_DOWNLOAD_PLAYLISTS, next);
      await store.save();
    } catch {
      /* non-fatal */
    }
  }

  // Folders offered as download targets: every existing playlist folder + the default.
  const targetOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_DOWNLOAD_TARGET]);
    for (const t of allTracks) {
      if (t.playlist && t.playlist !== "(root)") set.add(t.playlist);
    }
    if (dlTarget) set.add(dlTarget);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allTracks, dlTarget]);

  async function chooseTarget(name: string) {
    if (!name.trim()) return;
    const check = checkFolderName(name);
    if (!check.ok) {
      notify({ text: folderNameRefusal(name, check.reason) });
      return;
    }
    const clean = check.name;
    setDlTarget(clean);
    try {
      const store = await storePromise;
      await store.set(KEY_DOWNLOAD_TARGET, clean);
      await store.save();
    } catch {
      /* non-fatal: the choice still applies for this session */
    }
  }

  return { dlTarget, setDlTarget, dlPlaylists, setDlPlaylists, dlPlaylistsRef, targetOptions, chooseDlPlaylists, chooseTarget };
}
