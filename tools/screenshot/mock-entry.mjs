// Runs in the page before any app script (bundled by harness.mjs, registered with
// page.addInitScript). Swaps the Tauri IPC bridge for @tauri-apps/api/mocks and answers every
// command the current UI sends at startup and in the baseline flows, from the fixture data the
// harness puts in window.__SOUNDHOOD_FIXTURE__ (see fixture.mjs pageData). Unknown commands fail
// loudly so a new command in the app cannot slip past the suite unmocked.
import { mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { silentWav } from "./wav.mjs";

const fx = window.__SOUNDHOOD_FIXTURE__;
const store = new Map(Object.entries(fx.store));

/** IPC bookkeeping the harness waits on: calls in flight, every command seen, unmocked ones. */
const ipc = { pending: 0, calls: [], unknown: [], lastAt: 0 };
window.__soundhoodIpc = ipc;

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
