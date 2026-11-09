// Runs in the page before any app script (bundled by harness.mjs, registered with
// page.addInitScript). Swaps the Tauri IPC bridge for @tauri-apps/api/mocks and answers every
// command the UI sends at startup and in the suite's flows, from the fixture data the
// harness puts in window.__SOUNDHOOD_FIXTURE__ (see fixture.mjs pageData). Unknown commands fail
// loudly so a new command in the app cannot slip past the suite unmocked.
import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { silentWav } from "./wav.mjs";

const fx = window.__SOUNDHOOD_FIXTURE__;
const store = new Map(Object.entries(fx.store));

/** IPC bookkeeping the harness waits on: calls in flight, every command seen, unmocked ones. */
const ipc = { pending: 0, calls: [], unknown: [], lastAt: 0 };
window.__soundhoodIpc = ipc;

/**
 * Where "Use fixture root" generates the test library, as the host reports it: under the app's own
 * data folder, never the library the suite shows by default.
 */
const FIXTURE_ROOT =
  fx.platform === "android"
    ? "/data/user/0/com.mgmat.soundhood/files/fixture-library"
    : "C:/Users/user/AppData/Roaming/com.mgmat.soundhood/fixture-library";

/**
 * What a test can read and steer through window.__soundhoodMock, set from an init script (before
 * the app loads) or from page.evaluate:
 * - `store`: the settings store (a Map), e.g. delete "library_dir" to start without a library;
 * - `proton`: what proton_status answers; `protonSyncs`: every proton_sync call; `protonLoginError`:
 *   the reason the next proton_login is refused with;
 * - `downloads`: every ytdlp_download_audio call (desktop), `phoneDownload`: the next phone result;
 * - `downloadError`: a reason the next ytdlp_download_audio call is refused with, a plain string as
 *   the host's start errors arrive;
 * - `history`: the journal behind last_change / undo_last (core/CONTRACT.md "Host IPC (Phase 0)"),
 *   newest last; it starts empty, so the baselines have nothing to undo;
 * - `undoSkipped`: [{ path, reason }] makes the next undo_last leave the change as it is;
 * - `deleteRefused`: file names delete_track refuses ("file in use"); `writeTagsError`: the reason
 *   write_tags refuses with;
 * - `holdPhoneDownload`: the phone's download runs until `finishPhoneDownload()`; `cancels`: every
 *   cancel call; `pickFolder`: what the folder picker (plugin:dialog|open) answers, null = closed.
 * window.__soundhoodEmit(event, payload) sends a host event (ytdlp:stdout, ytdlp:done, ...).
 */
const mock = {
  store,
  fixtureRoot: FIXTURE_ROOT,
  proton: { bundled: true, connected: false, username: "" },
  protonSyncs: [],
  downloads: [],
  phoneDownload: { exitCode: 0, files: [], log: "" },
  downloadError: "",
  history: [],
  deleteRefused: [],
  holdPhoneDownload: false,
  cancels: [],
  pickFolder: null,
};
window.__soundhoodMock = mock;
window.__soundhoodEmit = (event, payload) => emit(event, payload);

// The library the mock serves: the fixture tracks and playlists, edited by write_tags / playlist_add /
// playlist_remove / playlist_create / playlist_delete / move_track / delete_track
// and put back by undo_last. Paths are kept relative to the library root.
const rootOf = (p) => (p.startsWith(`${FIXTURE_ROOT}/`) ? FIXTURE_ROOT : fx.root);
const relOf = (abs) => abs.slice(rootOf(abs).length + 1);
const fileName = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const tracks = fx.tracks.map((t) => ({ ...t, rel: relOf(t.path) }));
const playlists = structuredClone(fx.playlists);

/** Track[] as scan_music_folder returns it for the folder `dir`. */
function scanOf(dir) {
  const root = String(dir).replace(/[\\/]+$/, "");
  return tracks.map(({ rel, ...t }) => ({ ...t, path: `${root}/${rel}` }));
}

/** The fixture file behind an absolute path in either library (covers and audio length). */
const fixturePath = (abs) => `${fx.root}/${relOf(abs)}`;

let batchSeq = 0;
/**
 * Records one applied change the way the core journals it: `label` in the core's own words, the
 * report the host emits as core:batch, and how undo_last puts it back (its report labels are the
 * core's undo labels too).
 */
function journal(label, paths, undo) {
  const batch = `fixture-batch-${++batchSeq}`;
  const report = { batch, applied: [{ label, ...paths }], skipped: [], failed: [], aborted: false };
  mock.history.push({ summary: { batch, ts: 1767225600000 + batchSeq, label, count: 1 }, undo });
  // Like the host: every mutating command is followed by a core:batch event with its report.
  setTimeout(() => emit("core:batch", report), 0);
}

function writeTags({ path, title, artist }) {
  const rel = relOf(path);
  const t = tracks.find((x) => x.rel === rel);
  if (!t) throw new Error(`not in the library: ${rel}`);
  const before = { title: t.title, artist: t.artist };
  Object.assign(t, { title, artist });
  journal(`Edited tags of ${fileName(rel)}`, { path_before: rel, path_after: rel }, () => {
    Object.assign(t, before);
    return { label: `Restored tags of ${fileName(rel)}`, path_before: rel, path_after: rel };
  });
  const { rel: _rel, ...shown } = t;
  return { ...shown, path };
}

function playlistAdd({ name, paths }) {
  const pl = playlists.find((p) => p.name === name);
  if (!pl) throw new Error(`no playlist ${name}`);
  const before = [...pl.entries];
  const added = paths.map(relOf).filter((rel) => !pl.entries.some((e) => e.toLowerCase() === rel.toLowerCase()));
  pl.entries.push(...added);
  const n = added.length;
  journal(`Added ${n} track${n === 1 ? "" : "s"} to ${name}`, { path_before: null, path_after: null }, () => {
    pl.entries = before;
    return { label: `Restored playlist ${name}`, path_before: null, path_after: null };
  });
  return structuredClone(pl);
}

function playlistRemove({ name, paths }) {
  const pl = playlists.find((p) => p.name === name);
  if (!pl) throw new Error(`no playlist ${name}`);
  const before = [...pl.entries];
  const gone = new Set(paths.map((p) => relOf(p).toLowerCase()));
  pl.entries = pl.entries.filter((e) => !gone.has(e.toLowerCase()));
  const n = before.length - pl.entries.length;
  journal(`Removed ${n} track${n === 1 ? "" : "s"} from ${name}`, { path_before: null, path_after: null }, () => {
    pl.entries = before;
    return { label: `Restored playlist ${name}`, path_before: null, path_after: null };
  });
  return structuredClone(pl);
}

function playlistCreate({ name }) {
  if (playlists.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`a playlist ${name} exists`);
  const pl = { name, entries: [] };
  playlists.push(pl);
  playlists.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  journal(`Created playlist ${name}`, { path_before: null, path_after: null }, () => {
    playlists.splice(playlists.indexOf(pl), 1);
    return { label: `Removed playlist ${name}`, path_before: null, path_after: null };
  });
  return structuredClone(pl);
}

/** The first-level folder a library path sits in, as scan_music_folder names it ("(root)" at the top). */
const folderOfRel = (rel) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)");

/** Every playlist entry naming `from` now names `to` (null: the entry goes); returns how to put them back. */
function repointEntries(from, to) {
  const before = playlists.map((p) => [...p.entries]);
  for (const p of playlists) {
    p.entries = p.entries.flatMap((e) => (e.toLowerCase() === from.toLowerCase() ? (to ? [to] : []) : [e]));
  }
  return () => playlists.forEach((p, i) => (p.entries = before[i]));
}

function moveTrack({ path, targetFolder }) {
  const rel = relOf(path);
  const t = tracks.find((x) => x.rel === rel);
  if (!t) throw new Error(`not in the library: ${rel}`);
  const to = `${targetFolder}/${fileName(rel)}`;
  if (tracks.some((x) => x.rel.toLowerCase() === to.toLowerCase())) throw `${fileName(rel)} already exists in ${targetFolder}`;
  const putBack = repointEntries(rel, to);
  Object.assign(t, { rel: to, playlist: targetFolder });
  journal(`Moved ${fileName(rel)} to ${targetFolder}`, { path_before: rel, path_after: to }, () => {
    putBack();
    Object.assign(t, { rel, playlist: folderOfRel(rel) });
    return { label: `Moved ${fileName(rel)} back to ${folderOfRel(rel)}`, path_before: to, path_after: rel };
  });
  const { rel: _rel, ...shown } = t;
  return { ...shown, path: `${rootOf(path)}/${to}` };
}

function deleteTrack({ path }) {
  const rel = relOf(path);
  const at = tracks.findIndex((x) => x.rel === rel);
  if (at < 0) throw new Error(`not in the library: ${rel}`);
  if (mock.deleteRefused.includes(fileName(rel))) throw "file in use";
  const [t] = tracks.splice(at, 1);
  const putBack = repointEntries(rel, null);
  journal(`Moved ${fileName(rel)} to the bin`, { path_before: rel, path_after: null }, () => {
    tracks.splice(at, 0, t);
    putBack();
    return { label: `Restored ${fileName(rel)} from the bin`, path_before: null, path_after: rel };
  });
  return null;
}

function playlistDelete({ name }) {
  const at = playlists.findIndex((p) => p.name === name);
  if (at < 0) throw new Error(`no playlist ${name}`);
  const [pl] = playlists.splice(at, 1);
  journal(`Deleted playlist ${name}`, { path_before: null, path_after: null }, () => {
    playlists.splice(at, 0, pl);
    return { label: `Restored playlist ${name}`, path_before: null, path_after: null };
  });
  return null;
}

function undoLast() {
  const batch = `fixture-undo-${++batchSeq}`;
  // A test can make the undo leave entries as they are (changed since, file in use): nothing is put back.
  const skipped = mock.undoSkipped ?? [];
  const last = skipped.length ? null : mock.history.pop();
  const report = { batch, applied: last ? [last.undo()] : [], skipped: structuredClone(skipped), failed: [], aborted: false };
  setTimeout(() => emit("core:batch", report), 0);
  return report;
}

const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const covers = Object.fromEntries(Object.entries(fx.covers).map(([k, b64]) => [k, fromBase64(b64)]));
// The host returns raw bytes; the app needs a real ArrayBuffer of exactly that length.
const arrayBuffer = (bytes) => bytes.slice().buffer;

function answer(cmd, args) {
  switch (cmd) {
    case "platform":
      return fx.platform;
    case "plugin:store|load":
      return 1; // the resource id of the one settings store
    case "plugin:store|get":
      return store.has(args.key) ? [store.get(args.key), true] : [null, false];
    case "plugin:store|set":
      store.set(args.key, args.value);
      return null;
    case "plugin:store|save":
      return null;
    case "scan_music_folder":
      return scanOf(args.dir);
    case "list_playlists":
      return structuredClone(playlists);
    case "queue_read":
      return "";
    case "queue_write":
      return null;
    case "cover_art": {
      const key = fx.coverOf[fixturePath(args.path)];
      return arrayBuffer(key ? covers[key] : new Uint8Array(0)); // empty = no cover
    }
    case "read_file_bytes":
      return arrayBuffer(silentWav(fx.durationOf[fixturePath(args.path)] ?? 1));
    case "write_tags":
      if (mock.writeTagsError) throw mock.writeTagsError;
      return writeTags(args.args);
    case "playlist_add":
      return playlistAdd(args.args);
    case "playlist_remove":
      return playlistRemove(args.args);
    case "playlist_create":
      return playlistCreate(args.args);
    case "playlist_delete":
      return playlistDelete(args.args);
    case "move_track":
      return moveTrack(args.args);
    case "delete_track":
      return deleteTrack(args.args);
    case "ytdlp_download_audio":
      // The download runs in the host; the test sends its output and end with __soundhoodEmit.
      mock.downloads.push(structuredClone(args.args));
      if (mock.downloadError) {
        const reason = mock.downloadError;
        mock.downloadError = "";
        throw reason;
      }
      return null;
    case "plugin:soundhood-ytdl|download":
      mock.downloads.push(structuredClone(args.args));
      // Held: the download runs until the test calls __soundhoodMock.finishPhoneDownload().
      if (mock.holdPhoneDownload) {
        return new Promise((resolve) => {
          mock.finishPhoneDownload = () => resolve(structuredClone(mock.phoneDownload));
        });
      }
      return structuredClone(mock.phoneDownload);
    case "plugin:soundhood-ytdl|cancel":
      mock.cancels.push(structuredClone(args.args));
      return null;
    case "plugin:dialog|open":
      return mock.pickFolder;
    case "plugin:soundhood-ytdl|register_listener":
    case "plugin:soundhood-ytdl|remove_listener":
      return null;
    case "plugin:soundhood-ytdl|proton_status":
      return structuredClone(mock.proton);
    case "plugin:soundhood-ytdl|proton_login":
      if (mock.protonLoginError) throw mock.protonLoginError;
      mock.proton = { bundled: true, connected: true, username: args.args.username };
      return { connected: true, username: args.args.username, folders: "Music" };
    case "plugin:soundhood-ytdl|proton_sync":
      mock.protonSyncs.push(structuredClone(args.args));
      return { ok: true, log: "" };
    case "plugin:soundhood-ytdl|ytdlp_version":
      return { version: fx.ytdlpVersion };
    case "last_change":
      return mock.history.at(-1)?.summary ?? null;
    case "undo_last":
      return undoLast();
    case "rebuild_index":
      return { total: fx.tracks.length, read: fx.tracks.length, removed: 0, millis: 1500 };
    case "dev_fixture_root":
      return { root: args.enable ? FIXTURE_ROOT : "" };
    case "self_test":
      return { passed: 2, failed: 0, lines: ["PASS fixture library builds", "PASS tags round-trip"] };
    case "diagnostics":
      return {
        appVersion: "0.1.0",
        platform: fx.platform,
        os: fx.platform === "android" ? "Android 15" : "Windows 11",
        deviceId: "00000000-0000-4000-8000-000000000000",
        indexPath: "~/fixture/library-index.sqlite",
        orphansRemoved: [],
        sidecars: "yt-dlp 2026.10.01, deno 2.9.8",
      };
    default:
      ipc.unknown.push(cmd);
      throw new Error(`fixture: no mock for ${cmd}`);
  }
}

// shouldMockEvents: plugin:event|listen/unlisten/emit are answered by the mock itself.
mockIPC(
  (cmd, args) => {
    ipc.pending++;
    ipc.calls.push(cmd);
    ipc.lastAt = performance.now();
    try {
      return answer(cmd, args ?? {});
    } finally {
      ipc.pending--;
      ipc.lastAt = performance.now();
    }
  },
  { shouldMockEvents: true },
);
// Tauri serves files as http://asset.localhost/<path> on Windows and Android alike.
mockConvertFileSrc("windows");

// The screenshots need the app's playing state, not sound: play() resolves without playing.
HTMLMediaElement.prototype.play = function play() {
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause() {};
