// ---------- Proton Drive (phone: rclone inside the app; PC: the Proton Drive app mirrors the folder) ----------
// The phone's sync box (status, login, sync both ways) and its in-app yt-dlp tools (version,
// update, network check).
import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { SYNC_OFF_LINE, isTestLibrary } from "../testLibrary";
import { KEY_LAST_SYNC, storePromise } from "../lib/store";
import type { PlaylistFile, ProtonBusy, ProtonForm, ProtonStatus, Setter, Track } from "../lib/types";

export type Proton = ReturnType<typeof useProton>;

type ProtonArgs = {
  isMobile: boolean;
  mSettings: boolean;
  setStatus: Setter<string>;
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
  setStatus,
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
    if (!protonForm.username.trim() || !protonForm.password) { setStatus("Proton: username and password needed"); return; }
    setProtonBusy("login");
    setStatus("Connecting to Proton Drive…");
    setDlLogs((prev) => prev + "[proton] connecting…\n");
    try {
      const r = await invoke<{ connected: boolean; username: string; folders: string }>("plugin:soundhood-ytdl|proton_login", {
        args: { username: protonForm.username.trim(), password: protonForm.password, twofa: protonForm.twofa.trim() },
      });
      setProtonForm({ username: "", password: "", twofa: "" });
      setStatus(r.connected ? `Connected to Proton Drive as ${r.username}` : "Proton: login finished but no session saved");
      setDlLogs((prev) => prev + `[proton] top-level folders:\n${r.folders}\n`);
    } catch (e) {
      setStatus("Proton login failed (see the log)");
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    refreshProton();
  }
  async function protonLogout() {
    try { await invoke("plugin:soundhood-ytdl|proton_logout"); } catch { /* ignore */ }
    setStatus("Disconnected from Proton Drive");
    refreshProton();
  }
  async function protonSync(direction: "down" | "up" | "both" = "both") {
    const lib = folderRef.current;
    if (!lib) { setStatus("Pick the Music folder first"); return; }
    // The test library must never meet the real Proton Drive folder (the buttons are off too).
    if (isTestLibrary(lib, fixtureRoot)) { setStatus(SYNC_OFF_LINE); return; }
    setProtonBusy("sync");
    setStatus("Syncing with Proton Drive…");
    try {
      const r = await invoke<{ ok: boolean; log: string }>("plugin:soundhood-ytdl|proton_sync", { args: { libraryDir: lib, remoteDir: "Music", direction } });
      const now = Date.now();
      setLastSync(now);
      try { const store = await storePromise; await store.set(KEY_LAST_SYNC, now); await store.save(); } catch { /* ignore */ }
      setStatus(r.ok ? "Proton sync done, refreshing…" : "Proton sync finished with errors");
      // Whatever arrived: new tracks, playlists, the download queue.
      const found = await invoke<Track[]>("scan_music_folder", { dir: lib });
      setAllTracks(found);
      await loadPlaylists(lib);
      await loadQueueFromLibrary(lib);
      setStatus(`Synced · ${found.length} tracks`);
    } catch (e) {
      setStatus("Proton sync failed (see the log)");
      setDlLogs((prev) => prev + `[proton] ${String(e)}\n`);
    }
    setProtonBusy("");
    await refreshLastChange(lib);
  }
  async function netcheck() {
    setYtdlpBusy(true);
    setStatus("Checking the network from python…");
    setDlLogs((prev) => prev + "[netcheck] running…\n");
    try {
      const r = await invoke<{ output: string }>("plugin:soundhood-ytdl|netcheck");
      setDlLogs((prev) => prev + r.output + "\n");
      setStatus("Network check done (see the log)");
    } catch (e) {
      setDlLogs((prev) => prev + `[netcheck] failed: ${String(e)}\n`);
      setStatus("Network check failed");
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
    setStatus("Updating yt-dlp…");
    try {
      const r = await invoke<{ status: string; version: string }>("plugin:soundhood-ytdl|ytdlp_update");
      setStatus(`yt-dlp ${r.version} (${r.status === "ALREADY_UP_TO_DATE" ? "already current" : "updated"})`);
    } catch (e) {
      setStatus(`yt-dlp update failed: ${String(e).slice(0, 120)}`);
    }
    setYtdlpBusy(false);
  }

  return {
    proton,
    protonForm,
    setProtonForm,
    protonBusy,
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
