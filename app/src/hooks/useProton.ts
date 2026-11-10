// ---------- Proton Drive (phone: rclone inside the app; PC: the Proton Drive app mirrors the folder) ----------
// The phone's Proton Drive settings (status, login, sync both ways) and its in-app yt-dlp tools
// (version, update, network check). Results are toasts; a login or a sync that failed also leaves
// `error`, which Settings shows as an error row with Copy log and Retry.
import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { SYNC_OFF_LINE, isTestLibrary } from "../testLibrary";
import { KEY_LAST_SYNC, storePromise } from "../lib/store";
import type { PlaylistFile, ProtonBusy, ProtonForm, ProtonStatus, Setter, Track } from "../lib/types";
import type { Notices } from "./useNotices";

/** A Proton action that failed: what the error row says and how to try again. */
export type ProtonError = { title: string; detail: string; retry: () => void };

export type Proton = ReturnType<typeof useProton>;

type ProtonArgs = {
  isMobile: boolean;
  mSettings: boolean;
  notices: Notices;
  folderRef: MutableRefObject<string>;
  fixtureRoot: string;
  setDlLogs: Setter<string>;
  setAllTracks: Setter<Track[]>;
  loadPlaylists: (lib: string) => Promise<PlaylistFile[] | null>;
  loadQueueFromLibrary: (lib: string) => Promise<void>;
  refreshLastChange: (lib?: string) => Promise<void>;
};

export function useProton({
  isMobile,
  mSettings,
  notices,
  folderRef,
  fixtureRoot,
  setDlLogs,
  setAllTracks,
  loadPlaylists,
  loadQueueFromLibrary,
  refreshLastChange,
}: ProtonArgs) {
  const [ytdlpBusy, setYtdlpBusy] = useState<boolean>(false);
  const [proton, setProton] = useState<ProtonStatus | null>(null);
  const [protonForm, setProtonForm] = useState<ProtonForm>({ username: "", password: "", twofa: "" });
  const [protonBusy, setProtonBusy] = useState<ProtonBusy>("");
  const [lastSync, setLastSync] = useState<number>(0);
  const [error, setError] = useState<ProtonError | null>(null);
  const notify = notices.notify;
  async function refreshProton() {
    if (!isMobile) return;
    try { setProton(await invoke<ProtonStatus>("plugin:soundhood-ytdl|proton_status")); } catch { setProton({ bundled: false, connected: false, username: "" }); }
  }
  useEffect(() => { if (isMobile && mSettings) refreshProton(); }, [isMobile, mSettings]);
  useEffect(() => {
    if (!isMobile) return;
    let un: (() => void) | undefined;
    let active = true;
    addPluginListener<{ kind: string; line: string }>("soundhood-ytdl", "sync", (e) => {
      if (e.line) setDlLogs((prev) => (prev.length > 20000 ? prev.slice(-12000) : prev) + e.line + "\n");
    }).then((l) => { if (active) un = () => l.unregister(); else l.unregister(); }).catch(() => {});
    return () => { active = false; if (un) un(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  async function protonLogin() {
    if (!protonForm.username.trim() || !protonForm.password) { notify({ text: "Proton: email and password needed" }); return; }
    setProtonBusy("login");
    setError(null);
    setDlLogs((prev) => prev + "[proton] connecting…\n");
    try {
      const r = await invoke<{ connected: boolean; username: string; folders: string }>("plugin:soundhood-ytdl|proton_login", {
        args: { username: protonForm.username.trim(), password: protonForm.password, twofa: protonForm.twofa.trim() },
      });
      setProtonForm({ username: "", password: "", twofa: "" });
      if (r.connected) notify({ text: `Connected to Proton Drive as ${r.username}` });
      else setError({ title: "Not connected", detail: "The login finished but no session was saved. Try again.", retry: protonLogin });
      setDlLogs((prev) => prev + `[proton] top-level folders:\n${r.folders}\n`);
    } catch (e) {
      setError({ title: "Proton login failed", detail: firstLine(e), retry: protonLogin });
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    refreshProton();
  }
  async function protonLogout() {
    try { await invoke("plugin:soundhood-ytdl|proton_logout"); } catch { /* ignore */ }
    notify({ text: "Disconnected from Proton Drive" });
    refreshProton();
  }
  async function protonSync(direction: "down" | "up" | "both" = "both") {
    const lib = folderRef.current;
    if (!lib) { notify({ text: "Choose your Music folder first (Settings, Library)" }); return; }
    // The test library must never meet the real Proton Drive folder (the buttons are off too).
    if (isTestLibrary(lib, fixtureRoot)) { notify({ text: SYNC_OFF_LINE }); return; }
    setProtonBusy("sync");
    setError(null);
    const retry = () => void protonSync(direction);
    try {
      const r = await invoke<{ ok: boolean; log: string }>("plugin:soundhood-ytdl|proton_sync", { args: { libraryDir: lib, remoteDir: "Music", direction } });
      const now = Date.now();
      setLastSync(now);
      try { const store = await storePromise; await store.set(KEY_LAST_SYNC, now); await store.save(); } catch { /* ignore */ }
      // Whatever arrived: new tracks, playlists, the download queue.
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      await loadPlaylists(lib);
      await loadQueueFromLibrary(lib);
      if (r.ok) notify({ text: `Synced: ${found.length} tracks` });
      else setError({ title: "Proton sync finished with errors", detail: "Some files did not copy. Copy the log to see which.", retry });
    } catch (e) {
      setError({ title: "Proton sync failed", detail: firstLine(e), retry });
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    await refreshLastChange(lib);
  }
  async function netcheck() {
    setYtdlpBusy(true);
    setDlLogs((prev) => prev + "[netcheck] running…\n");
    try {
      const r = await invoke<{ output: string }>("plugin:soundhood-ytdl|netcheck");
      setDlLogs((prev) => prev + r.output + "\n");
      notify({ text: "Network check done: the result is in the log" });
    } catch (e) {
      setDlLogs((prev) => prev + `[netcheck] failed: ${String(e)}\n`);
      notify({ text: "Network check failed: the reason is in the log" });
    }
    setYtdlpBusy(false);
  }
  const [ytdlpVersion, setYtdlpVersion] = useState<string>("");
  useEffect(() => {
    if (!isMobile || !mSettings) return;
    invoke<{ version: string }>("plugin:soundhood-ytdl|ytdlp_version").then((r) => setYtdlpVersion(r.version)).catch((e) => setYtdlpVersion(`unavailable: ${String(e).slice(0, 80)}`));
  }, [isMobile, mSettings, ytdlpBusy]);
  async function updateYtdlp() {
    setYtdlpBusy(true);
    try {
      const r = await invoke<{ status: string; version: string }>("plugin:soundhood-ytdl|ytdlp_update");
      notify({ text: `yt-dlp ${r.version} (${r.status === "ALREADY_UP_TO_DATE" ? "already current" : "updated"})` });
    } catch (e) {
      notify({ text: `yt-dlp update failed: ${String(e).slice(0, 120)}` });
      setDlLogs((prev) => prev + `[error] yt-dlp update failed: ${String(e)}\n`);
    }
    setYtdlpBusy(false);
  }

  return {
    proton,
    protonForm,
    setProtonForm,
    protonBusy,
    error,
    dismissError: () => setError(null),
    lastSync,
    setLastSync,
    ytdlpBusy,
    ytdlpVersion,
    protonLogin,
    protonLogout,
    protonSync,
    netcheck,
    updateYtdlp,
  };
}

/** The first line of an error, cut to 120 characters, for an error row. */
function firstLine(e: unknown): string {
  return String(e).split("\n")[0].slice(0, 120);
}
