# soundhood-core: module contracts (Phase 0)

The lead owns this file, `src/api.rs`, `src/model.rs`, `src/error.rs`, `src/lib.rs`,
`src/index/schema.sql` and `Cargo.toml`. Implementers own the module internals listed below and
keep the signatures shown here. A needed signature change or a new dependency is an
**interface change request**: write it at the top of your report; do not change it silently.

Conventions for every module:

- Errors: `crate::Result<T>` / `crate::Error`. No `unwrap()` on I/O or user data outside tests.
- Paths: user-file positions are `RelPath` (forward slashes, characters exactly as on disk; never
  NFC-normalise an existing name: NTFS treats an NFD name and its NFC twin as two files). Compare with
  `RelPath::key()` / `model::path_key()` (NFC + lower-case). Absolute paths only at the edges
  (`Library::abs`).
- Every function that writes, renames, moves or deletes a **user file** (audio or
  `_Playlists/**/*.m3u8`) is `pub(crate)` and is called only from `ingest::tagwrite`.
  Reads are `pub`.
- No threads or runtimes are created by the core except `rayon` for parallel reads.
- Unit tests sit next to the code (`#[cfg(test)]`); cross-module tests go in `core/tests/`.
  Use `tempfile` for scratch libraries, never a real library path.
- Comment density matches the existing host code: a doc line on every pub item, short "why" comments
  where behaviour is subtle; no banner comments.

## model (lead): `src/model.rs`

`RelPath`, `DeviceId`, `Platform`, `Library { root, device, platform }`, `Track` (the UI's wire
shape, unchanged), `PlaylistFile { name, entries }`, `TagSet` (Option fields; `None` = untouched,
`Some("")` = clear).

## fs: `src/fs/` (zone: core-foundation)

```rust
pub const APP_DIR: &str = "_Soundhood";
pub const PLAYLISTS_DIR: &str = "_Playlists";
pub const TMP_PREFIX: &str = ".soundhood-tmp-";

pub fn is_audio_file(name: &str) -> bool;                 // same extension list as the old host
pub struct FileStamp { pub rel: RelPath, pub mtime: i64 /*unix s*/, pub size: u64 }
pub fn scan(root: &Path) -> Result<Vec<FileStamp>>;       // walk; skips _Soundhood/, _Playlists/, dot-dirs,
                                                          // TMP_PREFIX files; only audio files; sorted by rel
pub fn stamp(abs: &Path) -> Result<(i64, u64)>;
pub fn file_hash(abs: &Path) -> Result<String>;           // blake3 hex of the bytes
pub fn device_id(app_data_dir: &Path) -> Result<DeviceId>;// read or create <app data>/device-id (uuid v4),
                                                          // write-then-rename
pub(crate) fn tmp_path(dir: &Path, job: &str, ext: &str) -> PathBuf; // <dir>/.soundhood-tmp-<job>.<ext>
pub(crate) fn create_hidden(path: &Path) -> Result<File>; // FILE_ATTRIBUTE_HIDDEN on Windows
pub(crate) fn copy_to_tmp(src: &Path, job: &str) -> Result<PathBuf>; // same dir, hidden, fsync'd
pub(crate) fn fsync(path: &Path) -> Result<()>;
/// Atomic replace of `dest` by `tmp` (same volume). On Windows sharing violations / EACCES:
/// 3 retries, 250 ms apart, then Error::InUse.
pub(crate) fn atomic_replace(tmp: &Path, dest: &Path) -> Result<()>;
/// Rename within the root; refuses (Error::Exists) when the destination exists, case-insensitively.
pub(crate) fn rename_no_clobber(from: &Path, to: &Path) -> Result<()>;
/// Cross-volume landing: copy to <dest dir>/.soundhood-tmp-<job>, fsync, rename to dest, then remove src.
pub(crate) fn stage_move(src: &Path, dest: &Path, job: &str) -> Result<()>;
/// The two halves of stage_move, so ingest can journal / crash-test between them.
pub(crate) fn stage_copy(src: &Path, dest: &Path, job: &str) -> Result<PathBuf>; // returns the staged temp
pub(crate) fn stage_finish(staged: &Path, dest: &Path, src: &Path) -> Result<()>;
/// The Android bin, compiled and tested on every platform (to_bin selects it on Android).
pub(crate) fn to_app_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord>;
/// Delete to a bin. Desktop: OS recycle bin via `trash` (cfg not android). Android: move to
/// <root>/_Soundhood/.bin/<yyyy-mm>/<rel_path> (same volume). Returns where it went.
pub(crate) fn to_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord>;
pub(crate) fn restore_from_bin(lib: &Library, rec: &BinRecord) -> Result<()>; // Windows/Linux/Android;
                                                          // macOS -> Error::Refused("restore from the Trash")
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BinRecord { pub kind: BinKind /*os|app*/, pub original: RelPath, pub bin_rel: Option<RelPath>,
                       pub deleted_at: i64 /*unix seconds*/ }
// Read-only refusals: tags::write -> Error::Refused("read-only: …"), atomic_replace -> Error::Refused("read-only file: …").
// Ingest checks read-only up front (on Windows the temp copy is writable, so the refusal would otherwise come late).
// TagRead.bitrate is kbps. Restoring from the OS recycle bin lists the whole bin (trash crate): slow on a full bin.
pub fn list_tmp_files(root: &Path) -> Result<Vec<RelPath>>; // every TMP_PREFIX file under the root
pub(crate) fn remove_file(abs: &Path) -> Result<()>;      // only for the core's own temp files
```

## tags: `src/tags/` (zone: core-foundation)

lofty **0.25.x**. Round-trip tests per container (m4a, mp3, flac, opus, ogg) against the fixture
audio in `core/fixtures/audio/`.

```rust
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct TagRead { pub title: String, pub artist: String, pub album: String, pub album_artist: String,
  pub genre: String, pub year: String, pub comment: String, pub duration_ms: u64, pub codec: String,
  pub bitrate: Option<u32>, pub sample_rate: Option<u32>, pub has_art: bool,
  pub art_hash: Option<String> /*blake3 hex of the chosen picture bytes*/ }
pub fn read(abs: &Path) -> Result<TagRead>;               // primary tag, else first tag; trims; never panics
pub fn read_lenient(abs: &Path) -> TagRead;               // old read_tags semantics: errors -> empty fields
pub fn cover_art(abs: &Path) -> Result<Option<Vec<u8>>>;  // front cover preferred, else first picture
/// Applies `changes` to the file at `path` (always a temp copy): WriteOptions remove_others(false),
/// respect_read_only(true); keeps ID3v2.3 only if the file already had it; creates the primary tag if
/// missing. `Some("")` removes the field.
pub(crate) fn write(path: &Path, changes: &TagSet) -> Result<()>;
/// Re-read `tmp` and check: duration within 1 s and codec equal to `before`; every field in
/// `changes` now has its intended value; every other field equals `before`.
pub(crate) fn verify(tmp: &Path, before: &TagRead, changes: &TagSet) -> Result<TagRead>;
pub fn tagset_of(r: &TagRead) -> TagSet;                  // full pre-image for the journal
```

## playlist: `src/playlist/` (zone: core-foundation)

Ported from the host **behaviour-identical** (format: `#EXTM3U\n` + one entry per line + `\n`, LF;
reader strips BOM, trims, skips blanks and `#` lines, turns `\` into `/`; membership compares
case-insensitively; names sanitised like `sanitize_folder_name`). Added: comparisons use NFC +
lower-case keys; entries are read and written byte-exact, so re-serialising an existing playlist is
byte-identical (including an NFD entry).

```rust
pub fn list(root: &Path) -> Result<Vec<PlaylistFile>>;    // sorted by lower-cased name; .m3u8 and .m3u
pub fn read(root: &Path, name: &str) -> Result<PlaylistFile>;
pub fn file_rel(name: &str) -> Result<RelPath>;           // "_Playlists/<clean>.m3u8"
pub fn sanitize_name(raw: &str) -> Result<String>;
/// Pure transforms (no I/O), used by tagwrite to compute the after-image:
pub fn with_added(entries: &[String], add: &[RelPath]) -> Vec<String>;   // no duplicates (case-insensitive)
pub fn with_removed(entries: &[String], remove: &[RelPath]) -> Vec<String>;
pub fn with_path_replaced(entries: &[String], from: &RelPath, to: Option<&RelPath>) -> Vec<String>;
pub fn render(entries: &[String]) -> String;
/// Which playlists mention `rel` (case-insensitive): for move/rename/delete consistency.
pub fn containing(root: &Path, rel: &RelPath) -> Result<Vec<PlaylistFile>>;
/// One playlist per first-level folder, filename order; never overwrites an existing playlist.
pub fn plan_from_folders(root: &Path, stamps: &[FileStamp]) -> Result<Vec<PlaylistFile>>;
/// The sole m3u8 writer: write-then-rename through a hidden temp in `_Playlists/`.
pub(crate) fn write(root: &Path, name: &str, entries: &[String], job: &str) -> Result<()>;
```

## ingest: `src/ingest/` (zone: core-writepath)

The one write path. Journal: `<root>/_Soundhood/journal/<device-id>/YYYY-MM.jsonl`, append-only,
one JSON object per line, fsync after each append. An operation writes a pre-image line
(`committed:false`) before touching the file and a commit line (same `id`, `committed:true`, hashes
after) once the file is in place. Readers fold lines by `id` (last line wins).

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct JournalEntry { pub id: String, pub ts: i64 /*unix ms*/, pub device: DeviceId,
  pub kind: Kind, pub path_before: Option<RelPath>, pub path_after: Option<RelPath>,
  pub tags_before: Option<TagSet>, pub tags_after: Option<TagSet>,
  pub file_hash_before: Option<String>, pub file_hash_after: Option<String>,
  pub playlists_touched: Vec<PlaylistChange>, pub bin: Option<BinRecord>,
  pub source: String /*"user" | "undo:<batch>" | "cleanup" | ...*/, pub batch: String,
  pub label: String /*plain words for the UI*/, pub committed: bool }
#[serde(rename_all = "snake_case")]
pub enum Kind { Tags, Rename, Move, Delete, Playlist, PlaylistCreate, PlaylistDelete, Ingest, Cleanup }
pub struct PlaylistChange { pub name: String, pub before: Option<Vec<String>>, pub after: Option<Vec<String>>,
  pub before_hash: Option<String>, pub after_hash: Option<String> } // None = file absent

pub mod journal {
  pub fn append(lib: &Library, e: &JournalEntry) -> Result<()>;
  pub fn read_device(root: &Path, device: &DeviceId) -> Result<Vec<JournalEntry>>; // folded, oldest first
  pub fn read_all(root: &Path) -> Result<Vec<JournalEntry>>;                       // every device
}

pub enum Op {
  WriteTags { rel: RelPath, changes: TagSet },
  Move { rel: RelPath, to_folder: String },   // keeps file name; Error::Exists if taken
  Rename { rel: RelPath, to: RelPath },
  Delete { rel: RelPath },                    // to the bin; playlists updated in the same batch
  PlaylistAdd { name: String, rels: Vec<RelPath> },
  PlaylistRemove { name: String, rels: Vec<RelPath> },
  PlaylistCreate { name: String },
  PlaylistDelete { name: String },            // the .m3u8 goes to the bin
  PlaylistsFromFolders,
}
#[derive(Serialize, Clone, Debug)]
pub struct BatchReport { pub batch: String, pub applied: Vec<Applied>, pub skipped: Vec<Skipped>,
  pub failed: Vec<Failed>, pub aborted: bool }
pub struct Applied { pub label: String, pub path_before: Option<String>, pub path_after: Option<String> }
pub struct Skipped { pub path: String, pub reason: String } // "file in use", "read-only", "playing now", ...
pub struct Failed  { pub path: String, pub error: String }

pub mod tagwrite {
  /// Applies ops in order as one batch. Tier-1 mechanics for audio files (journal pre-image ->
  /// hidden temp copy -> tag write -> verify -> fsync -> atomic replace with retries -> commit line);
  /// m3u8 consistency rewrites happen inside the same batch. 3 consecutive verify failures abort.
  /// Read-only and in-use files are skipped, not failed, and never abort the batch.
  pub fn apply(lib: &Library, ops: Vec<Op>, opts: &ApplyOptions) -> BatchReport;
  pub struct ApplyOptions { pub source: String, pub protected: Vec<RelPath> /*playing now: skipped*/ }
  /// Startup: first decides this device's last open journal entry once (finished on record with source
  /// "recovery" when the disk shows exactly the app's result, see LIBRARY_FORMAT "Fold rule"; else closed
  /// "not applied: interrupted …"), then removes orphaned core-minted .soundhood-tmp-* files, journaling
  /// each removal as Kind::Cleanup. Returns what was removed.
  pub fn cleanup_orphans(lib: &Library) -> Result<Vec<RelPath>>;
}

pub mod undo {
  /// The most recent batch on THIS device that is not an undo and was not undone yet.
  pub fn last_change(lib: &Library) -> Result<Option<ChangeSummary>>;
  /// Replays a batch in reverse. Refuses (reported per entry, not applied) any entry whose current
  /// file hash / playlist hash no longer matches the journaled after-state. Writes its own batch with
  /// source "undo:<batch>".
  pub fn undo_batch(lib: &Library, batch: &str) -> Result<BatchReport>;
}
#[derive(Serialize, Clone, Debug)]
pub struct ChangeSummary { pub batch: String, pub ts: i64, pub label: String, pub count: usize }
```

Fault injection (feature `fault-injection`, tests only): `ingest::fault::point(name)` calls
`std::process::abort()` when env `SOUNDHOOD_CRASH_AT` equals `name`. Points: `after_preimage`, `after_tmp_write`, `after_verify`, `after_ready` (tag edit: ready line written,
not yet renamed), `after_stage_copy`, `after_link` (unix no-replace rename), `after_replace`. Hooks (`fault::once_at`):
`before_replace` (right before the last check) and `before_rename` (playlists: after that check).
The kill tests re-run the test binary as a child with that env set, then assert the original is intact and `cleanup_orphans` leaves
no temp behind.

## index: `src/index/` (zone: core-index)

rusqlite (bundled). `schema.sql` is migration 1 (lead-owned); later migrations are numbered files.

```rust
pub struct Index { /* rusqlite::Connection behind a Mutex */ }
impl Index {
  /// Opens/creates <app data>/library-<roothash>.sqlite; pragmas WAL / NORMAL / foreign_keys;
  /// runs migrations; asserts `ENABLE_FTS5` is in pragma_compile_options.
  pub fn open(app_data_dir: &Path, root: &Path) -> Result<Index>;
  pub fn db_path(app_data_dir: &Path, root: &Path) -> PathBuf;
  /// Incremental: scan, re-read tags only where mtime+size changed, delete vanished rows, reconcile
  /// playlist_items (track_id NULL = missing), fill art_hash. Never writes into the library.
  pub fn refresh(&self, lib: &Library) -> Result<RefreshReport>;
  /// Drop every row and run refresh from scratch ("Rebuild index").
  pub fn rebuild(&self, lib: &Library) -> Result<RefreshReport>;
  /// The UI's Track list, with the old artist fallback (filename side that names a known artist).
  pub fn tracks(&self, lib: &Library) -> Result<Vec<Track>>;
  pub fn track(&self, lib: &Library, rel: &RelPath) -> Result<Option<Track>>;
  pub fn fts5_available(&self) -> Result<bool>;
}
pub struct RefreshReport { pub total: usize, pub read: usize, pub removed: usize, pub millis: u128 }
/// Removes the legacy JSON tag cache <cache dir>/library-<fnv64 hex of root>.json, if present.
pub fn remove_legacy_json_cache(cache_dir: &Path, root: &Path) -> Result<bool>;
```

"Analyse library" (audio hash, fingerprint, loudness) is a separate job and is NOT part of refresh.

## manifest: `src/manifest.rs` (zone: tools)

```rust
#[derive(Serialize, Deserialize)] pub struct Manifest { pub root_name: String, pub files: Vec<ManifestEntry> }
#[derive(Serialize, Deserialize)] pub struct ManifestEntry { pub rel: RelPath, pub size: u64, pub blake3: String }
pub fn build(root: &Path) -> Result<Manifest>;   // audio files + _Playlists/**; excludes _Soundhood/
pub fn diff(a: &Manifest, b: &Manifest) -> Vec<String>; // "changed: x", "added: y", "removed: z"
```

## ytdlp: `src/ytdlp/` (zone: tools)

Pure functions. `args.rs` ports the current desktop argument list exactly (tests pin it);
`pins.rs` holds the minimum yt-dlp version, the bootstrap build hash and the deno release hashes;
`errors.rs` starts the classifier (bot wall, 429, missing JS runtime, archive skip) from stderr
fixtures.

## sidecars: `src/sidecars.rs` (zone: tools; feature `sidecars`, desktop only)

Fetch a yt-dlp / deno release asset over TLS (`ureq`), fetch the release's `SHA2-256SUMS` /
`.sha256sum`, verify (`sha2`), refuse on mismatch or below the pinned minimum, extract (zip for deno),
write next to the destination with write-then-rename. Logs both hashes.

## fixtures: `src/fixtures.rs` (zone: tools)

Generates the fixture library from template audio embedded with `include_bytes!`
(`core/fixtures/audio/*`): N tracks with tags, aqua/purple/greyscale covers, 5 playlists, a few
messy names. Used by tests, by `soundhood-tools fixture-lib <dir>`, and by the app's
"Use fixture root" developer switch.

### As built in wave 1 (tools zone)

- `ytdlp::args::build(&DownloadArgs) -> Result<Vec<String>>`: the pre-rebuild desktop argv byte-for-byte;
  refuses a link starting with `-`. `ytdlp::pins`: `MIN_YTDLP_VERSION`, bootstrap yt-dlp per triple, deno 2.9.8
  per triple (SHA-256), `compare_versions`, `ytdlp_version_allowed`. `ytdlp::errors::{classify, classify_output,
  corpus}` → `Classified { kind, error }`.
- `sidecars::{fetch(&Asset, &Path, Option<&str>) -> Result<FetchReport>, host_triple(), exe_name()}`; `Asset::
  {ytdlp_bootstrap, ytdlp_release, deno_pinned, installed_as}`. Refuses plain HTTP except loopback, checksum before
  asset, pin must equal the published hash, downgrade refused before any request.
- `manifest::{build, diff, read, write}`. `fixtures::{FixtureSpec, FixtureReport, generate, export_json,
  self_test_lines, self_test_lines_in, MARKER, JSON_ROOT}`. `Core::self_test(scratch_dir)` wraps
  `self_test_lines_in`.
- lofty 0.25 writes ID3v2 frames from a generic `Tag` in HashMap order (bytes differ run to run): `file_hash_after`
  is not reproducible across identical writes; the fixture generator sorts frames to stay deterministic.

## sync: `src/sync/` (Phase 2 stub)

`SyncProvider` trait only, per the build brief §4.6.

## api: `src/api.rs` (lead)

The facade the hosts call. See the file.

## Host IPC (Phase 0): lead-owned, binding for the host and the UI

Unchanged names and shapes (the UI keeps calling them exactly as today):
`scan_music_folder {dir}` → `Track[]` · `list_playlists {libraryDir}` → `PlaylistFile[]` ·
`playlists_from_folders {libraryDir}` → `PlaylistFile[]` ·
`playlist_add | playlist_remove | playlist_create {args:{libraryDir, name, paths?}}` → `PlaylistFile` ·
`playlist_delete {args:{libraryDir, name}}` → void · `move_track {args:{path, libraryDir, targetFolder}}` → `Track` ·
`delete_track {args:{path, libraryDir}}` → void · `write_tags {args:{path, libraryDir, title, artist}}` → `Track` ·
`read_file_bytes {path}` → raw bytes · `cover_art {path}` → raw bytes · `queue_read {libraryDir}` → string ·
`queue_write {libraryDir, json}` → void · `platform` → string ·
`ytdlp_download_audio {args:{url, libraryDir, targetFolder, playlist}}` + events `ytdlp:stdout|stderr|files|done`.

Behaviour behind the same shapes:
- every mutating command goes through `soundhood_core::api::Core` (journal + verify + bin); a single-op command
  whose op was skipped or failed returns `Err("<reason>")` (e.g. "file in use", "read-only file",
  "already exists in <folder>"); the text is `core::Error::reason()`, never the Display text with its prefix.
- `delete_track` on Android goes to `<root>/_Soundhood/.bin/<yyyy-mm>/<rel>` (undoable), no longer a hard delete.
- after a mutating command that changed something (an op applied, part of it failed, or the batch stopped) the
  host emits `core:batch` with the `BatchReport`; `undo_last` always emits its report. A single op that was
  already in effect (same tag values, already a member, not a member, playlist exists) returns Ok
  (`playlist_create`: the existing playlist) and emits nothing: nothing was journaled.
- the UI keeps the root returned by `dev_fixture_root` under the settings key `fixture_root` and treats the
  library as the test library while `library_dir` equals it; `real_library_dir` never holds it.
- channel links are refused by `ytdlp::args::is_channel_link` (core), called by the desktop host before it creates
  the target folder and by the plugin's `check_download`, with `args::CHANNEL_REFUSED` as the one sentence; the UI's
  `isChannelLink` is a port held to the same vectors (`tools/screenshot/channel-links.json`). Kotlin has no copy.

Removed: `fix_tags_from_filenames`.

New:
- `last_change {libraryDir}` → `{batch, ts, label, count} | null`
- `undo_last {libraryDir}` → `BatchReport {batch, applied:[{label, path_before, path_after}], skipped:[{path, reason}], failed:[{path, error}], aborted}`
- `rebuild_index {libraryDir}` → `{total, read, removed, millis}`
- `dev_fixture_root {enable}` → `{root}` (enable: generate under `<app data>/fixture-library` if absent and return its path; disable: `""`)
- `self_test` → `{passed, failed, lines: string[]}`
- `diagnostics {libraryDir?}` → `{appVersion, platform, os, deviceId, indexPath, orphansRemoved: string[], sidecars: string}`
  (the user's home directory replaced by `~` in every path)
