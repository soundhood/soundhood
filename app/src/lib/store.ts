import { Store } from "@tauri-apps/plugin-store";

// One settings store, one key per setting. (An earlier edit had two store
// instances writing two different keys to the same file; Import broke on it.)
// Loaded while this module is imported, before the first render, as it always was: the file name is
// permanent, and the screenshot harness installs its IPC mock before any app script evaluates.
export const storePromise = Store.load("music-hood.json");
export const KEY_LIBRARY_DIR = "library_dir";
export const KEY_DOWNLOAD_TARGET = "download_target";
export const DEFAULT_DOWNLOAD_TARGET = "Downloads";
export const NEW_FOLDER_SENTINEL = "__new__";

export const KEY_VOLUME = "volume";
export const KEY_SORT = "sort";
export const KEY_DOWNLOAD_PLAYLISTS = "download_playlists";
// Links shared into the app (phone share sheet) waiting to be downloaded: the phone has no downloader yet.
export const KEY_SHARE_QUEUE = "share_queue";
export const KEY_LAST_SYNC = "last_sync";
// Hidden developer section: 7 taps on the status pill (phone) or Ctrl+Alt+Shift+D (desktop).
export const KEY_DEV_MODE = "dev_mode";
// The real library while the "Test library" switch points the app at the generated fixture library; never
// the fixture library itself.
export const KEY_REAL_LIBRARY_DIR = "real_library_dir";
// Where the host generated the fixture library ("test library"): the switch is on while the shown
// library is this folder.
export const KEY_FIXTURE_ROOT = "fixture_root";
