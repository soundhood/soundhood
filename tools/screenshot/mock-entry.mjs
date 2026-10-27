// Runs in the page before any app script (bundled by harness.mjs, registered with
// page.addInitScript). Swaps the Tauri IPC bridge for @tauri-apps/api/mocks and answers every
// command the current UI sends at startup and in the baseline flows, from the fixture data the
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
 * The journal state behind the Phase 0 commands (core/CONTRACT.md "Host IPC (Phase 0)"). The
 * baselines start with nothing to undo; a test can set `lastChange` (and the report `undo_last`
 * returns) through window.__soundhoodMock, and emit host events with window.__soundhoodEmit.
 */
const journal = { lastChange: null, undoReport: null };
window.__soundhoodMock = journal;
window.__soundhoodEmit = (event, payload) => emit(event, payload);

/** What `undo_last` reports: the test's report, or the last change undone in full. */
function undoReport() {
  const label = journal.lastChange?.label;
  return (
    journal.undoReport ?? {
      batch: "fixture-undo",
      applied: label ? [{ label: `Undo: ${label}`, path_before: null, path_after: null }] : [],
      skipped: [],
      failed: [],
      aborted: false,
    }
  );
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
      return structuredClone(fx.tracks);
    case "list_playlists":
      return structuredClone(fx.playlists);
    case "queue_read":
      return "";
    case "cover_art": {
      const key = fx.coverOf[args.path];
      return arrayBuffer(key ? covers[key] : new Uint8Array(0)); // empty = no cover
    }
    case "read_file_bytes":
      return arrayBuffer(silentWav(fx.durationOf[args.path] ?? 1));
    case "plugin:soundhood-ytdl|register_listener":
    case "plugin:soundhood-ytdl|remove_listener":
      return null;
    case "plugin:soundhood-ytdl|proton_status":
      return { bundled: true, connected: false, username: "" };
    case "plugin:soundhood-ytdl|ytdlp_version":
      return { version: fx.ytdlpVersion };
    case "last_change":
      return journal.lastChange;
    case "undo_last": {
      const report = undoReport();
      journal.lastChange = null;
      journal.undoReport = null;
      // Like the host: every mutating command is followed by a core:batch event with its report.
      setTimeout(() => emit("core:batch", report), 0);
      return report;
    }
    case "rebuild_index":
      return { total: fx.tracks.length, read: fx.tracks.length, removed: 0, millis: 1500 };
    case "dev_fixture_root":
      // The suite already serves the fixture library, so the "fixture root" is the same folder.
      return { root: args.enable ? fx.root : "" };
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
