# Library format

What Soundhood keeps on disk, byte by byte where it matters. The **library root** is the folder the
user picks; everything in it belongs to the user. The app reads all of it and changes user files only
through the one write path ([ARCHITECTURE](ARCHITECTURE.md#the-one-write-path)). Parts marked
*planned* are the agreed design for a later phase, not code yet.

Related: [FOLDER_RULES](FOLDER_RULES.md) (what the app does and never does with folders),
[TESTING](TESTING.md), [DECISIONS](DECISIONS.md). The Rust contracts that implement these formats are
in [core/CONTRACT.md](../core/CONTRACT.md).

## Root layout

```
<library root>/
  <any folders>/<audio files>      storage only; the app never restructures them
  <folder>/<basename>.lrc          lyrics sidecar next to its track            (planned, Phase 5)
  _Playlists/<name>.m3u8           playlists = membership
  _Playlists/_smart/<name>.m3u8    saved smart playlists, materialised          (planned, Phase 4)
  _Soundhood/                      app bookkeeping: small text files, one file per device
```

| Layer | Lives in | Written by |
|---|---|---|
| Identity (who a track is) | tags inside each audio file | the one write path |
| Membership (which playlists) | `_Playlists/*.m3u8` | the one write path; the app is the sole writer of `_Playlists` |
| Location | folders | the user |
| Bookkeeping | `_Soundhood/**` | the app, one file per device |
| Index | app data, outside the root | the app; a rebuildable cache |

**User files** are the audio files and `_Playlists/**/*.m3u8`. Nothing changes them except the one
write path, and every such change is journaled.

**Audio files** are recognised by extension, case-insensitively: `mp3 m4a aac wav flac ogg opus wma aiff alac`.
The scan skips `_Soundhood/`, `_Playlists/`, folders whose name starts with a dot, and the app's own
temp files.

**Paths** inside the library are written root-relative: forward slashes, no leading slash, no `.` or
`..` segments, Unicode NFC. They compare case-insensitively, because Windows treats names that differ
only in case as the same file (Proton Drive's web view does not): `Chill/Song - Artist.m4a` and
`chill/song - artist.M4A` name the same track.

## Playlists

One file per playlist: `_Playlists/<name>.m3u8`. The bytes the app writes:

- UTF-8 without BOM, LF line endings on every platform.
- First line `#EXTM3U`, then one entry per line, and a line feed after the last entry. No `#EXTINF` or
  other directives. An empty playlist is exactly `#EXTM3U` plus one line feed (8 bytes).
- Each entry is the track's path relative to the **library root** (not to the playlist file's folder).

```
#EXTM3U
Chill/Song - Artist.m4a
Downloads/Another Song - Someone, Someone Else.m4a
```

Reading is lenient so playlists touched by other tools still load: a BOM is stripped, CRLF is
accepted, every line is trimmed, blank lines and lines starting with `#` are skipped, `\` becomes `/`,
and NFC is applied. Legacy `.m3u` files are read too; the app only ever writes `.m3u8`.

The file name is the playlist name, cleaned: surrounding spaces and dots removed; a name that is empty
or contains `/ \ : * ? " < > |` is refused.

How the app writes them:

- Only through the sole-writer path: a hidden temp file in `_Playlists/`, renamed over the playlist
  (write-then-rename), journaled ([write tiers](ARCHITECTURE.md#the-one-write-path)).
- A line whose file is gone is kept and shown as missing; it is never dropped.
- Exactly two **automatic** rewrites exist: (1) when the app moves, renames or deletes a track, every
  playlist that names it is updated inside the same journaled batch; (2) sync's union-merge of a Proton
  Drive conflict twin `name (1).m3u8` into `name.m3u8` (planned, Phase 6). Every other playlist write
  comes from a user gesture.
- **Make playlists from folders** is a one-time import: one playlist per first-level folder, tracks in
  file-name order. It never overwrites an existing playlist.
- **A playlist another program wrote is never written.** The app writes only its own format, so a
  playlist that is not in it (`#EXTINF` or other directives, comments, a BOM, CRLF, backslashes) is
  read but left exactly as it is: a move, rename, delete or undo that would have to rewrite it is
  refused whole, with nothing half-done, and the report names the playlist.

## App bookkeeping

Everything under `_Soundhood/`. Every file here belongs to exactly one device and is append-only or union-merged when read, so two
devices never write the same file and Proton Drive never produces a conflict copy of it. The
**device id** is a random UUID kept in the app's data folder (`device-id`), created on first start;
a reinstall creates a new one.

| Path | Content | Since |
|---|---|---|
| `journal/<device-id>/YYYY-MM.jsonl` | the change journal ([below](#the-journal)) | Phase 0 |
| `.bin/<yyyy-mm>/<rel path>` | the Android bin ([below](#bins)) | Phase 0 |
| `snapshots/<date>.json` | library manifests ([below](#manifests-snapshots)) | Phase 0 |
| `download-queue.json` | the 0.1.0 shared download queue; read once, merged, left untouched | 0.1.0 |
| `download-queue.<device-id>.json` | links waiting to be downloaded by whichever device is online | planned |
| `lyrics-queue.<device-id>.json` | "Align on PC" requests made on the phone | planned, Phase 5 |
| `plays/<device-id>.jsonl` | play history | planned, Phase 4 |
| `smart/<name>.json` | rules of a saved smart playlist | planned, Phase 4 |
| `rules/junk.txt` | "Words to strip": literal strings, one per line | planned, Phase 2 |
| `device-<device-id>.json` | last played track and position | planned, Phase 3 |
| `conflicts/<device-id>/<rel path>` | remote copies captured by sync, never auto-resolved | planned, Phase 6 |

`.bin/`, `conflicts/` and `snapshots/` never take part in sync.

The download queue keeps its 0.1.0 shape (2-space indented JSON, UTF-8):

```json
{
  "version": 1,
  "links": [
    { "url": "https://youtu.be/<video id>", "added": 1761555600000, "target": "Downloads", "playlists": ["Gym", "Chill"] }
  ]
}
```

`added` is a Unix time in milliseconds, `target` the folder the download lands in, `playlists` the
playlists it joins. Lists are union-merged by exact URL when read, newest first.

## The journal

`_Soundhood/journal/<device-id>/YYYY-MM.jsonl`: JSON Lines, UTF-8, append-only, flushed to disk
(fsync) after every line. One object per line:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | entry id; a pre-image line and its commit line share it |
| `ts` | integer | Unix time, milliseconds |
| `device` | string | device id |
| `kind` | string | `tags`, `rename`, `move`, `delete`, `playlist`, `playlist_create`, `playlist_delete`, `ingest`, `cleanup` |
| `path_before`, `path_after` | string or null | root-relative paths |
| `tags_before`, `tags_after` | object or null | `title`, `artist`, `album`, `album_artist`, `genre`, `year`, `comment`; a missing key means untouched, `""` means cleared |
| `file_hash_before`, `file_hash_after` | string or null | BLAKE3 of the file bytes, hex |
| `playlists_touched` | array | `{name, before, after, before_hash, after_hash}`; `before`/`after` are entry lists, `null` = file absent |
| `bin` | object or null | where a delete went: `{kind: "os" or "app", original, bin_rel, deleted_at}` |
| `source` | string | `user`, `undo:<batch>`, `cleanup`, `recovery`, ... |
| `batch` | string | groups the entries of one user action |
| `label` | string | plain words for the UI, e.g. "Edited tags of Song - Artist.m4a" |
| `committed` | bool | `false` = pre-image (or a "not applied" closing line), `true` = done |
| `note` | string, optional | what the record needs beyond the fields above: why a change was given up (`not applied: ...`), that startup recovery finished it, that a decode check was skipped. Never an absolute path |

**Write order.** Before a user file is touched the app appends a pre-image line (`committed:false`).
A tag edit appends one more open line right before its checked copy replaces the file: same `id`,
`committed:false`, `file_hash_after` = the checked copy's BLAKE3, `note: "ready: the checked copy goes
in place next"` (startup recovery finishes a tag edit only when the file holds exactly that hash);
once the file is in place it appends a commit line with the same `id`, `committed:true` and the after
hashes. A change the app gives up on after the pre-image but before it changes anything (for example
the file changed since it was read, or the rewritten copy did not check out) gets a **closing line**
instead: same `id`, still `committed:false`,
with a `note` that starts with `not applied: `.

**Fold rule.** Readers group lines by `id`; the last line for an id wins. An entry whose last line is
a commit line happened; any other entry did not (a closing line says so explicitly; a bare pre-image
is a write a crash interrupted). At the next start the app decides this device's last entry once, if it
is still open (a pre-image, or a tag edit's `ready` line). It is finished only when the disk shows
exactly what the app's change would have left: for a tag edit, the file's BLAKE3 equals the `ready`
line's `file_hash_after`; for a move or rename, the same bytes are under the new name only (or, on
unix, both names are one file after a crash inside the no-replace rename); for a delete, the same
bytes are in the bin. Then the app writes the journaled playlist lines where those playlists are
unchanged and appends a commit line with `source: "recovery"` (an undo keeps its `undo:<batch>`) and
the note `finished after an interrupted run`, so "Undo last change" can reach it. Otherwise it appends
a closing line (`not applied: interrupted before the change` or `... and the change is not on disk`),
and the entry is never looked at again. It also removes any temp file the crash left behind
([temp files](#temp-files)).

Illustrative pair (hashes and ids shortened):

```
{"id":"e-7f3a","ts":1761573600000,"device":"9b2c-...","kind":"tags","path_before":"Chill/Song - Artist.m4a","path_after":"Chill/Song - Artist.m4a","tags_before":{"title":"Song","artist":"Artist"},"tags_after":{"artist":"Artist feat. Guest"},"file_hash_before":"5d41...","file_hash_after":null,"playlists_touched":[],"bin":null,"source":"user","batch":"b-12c4","label":"Edited tags of Song - Artist.m4a","committed":false}
{"id":"e-7f3a","ts":1761573600412,"device":"9b2c-...","kind":"tags","path_before":"Chill/Song - Artist.m4a","path_after":"Chill/Song - Artist.m4a","tags_before":{"title":"Song","artist":"Artist"},"tags_after":{"artist":"Artist feat. Guest"},"file_hash_before":"5d41...","file_hash_after":"a9e0...","playlists_touched":[],"bin":null,"source":"user","batch":"b-12c4","label":"Edited tags of Song - Artist.m4a","committed":true}
```

**Undo.** "Undo last change" takes the most recent batch on this device that is not itself an undo and
has not been undone, and replays it in reverse as a new batch with `source: "undo:<batch>"`. Any entry
whose file or playlist no longer matches the journaled after-state is refused, and the report says
which and why; nothing is forced. The journal travels with sync, and later it is also the sync
planner's record of renames and deletes ([sync plan](#sync-plan-planned-phase-6)).

## Bins

Nothing is deleted outright; every delete is journaled with the `bin` field.

- **Windows, Linux, macOS:** the system recycle bin. Undo restores from it on Windows and Linux; on
  macOS the app asks you to put the file back from the Trash yourself.
- **Android** (shared storage has no recycle bin): `<root>/_Soundhood/.bin/<yyyy-mm>/<rel path>`, where
  `yyyy-mm` is the month of the delete and `<rel path>` the file's original root-relative path. A move
  on the same volume (atomic rename), so it is instant and safe. Emptied only by an explicit action
  (Settings, Tools, Bin, planned for Phase 2) or after 30 days with a report. Never synced.

## Temp files

- Name: `.soundhood-tmp-<job>` (plus the original extension where the format needs it), in the **same
  folder** as the file it will replace, so the final rename is atomic. Hidden on Windows. Never
  `<file>.tmp` next to the real name: the Proton Drive client picks such files up mid-write.
- Tag write: copy the original to the temp file, write the tags on the copy, re-read and verify it,
  fsync, then rename it over the original. When another program holds the file (the Proton Drive
  client, a player), the rename is retried 3 times, 250 ms apart, then the file is reported as
  "skipped: file in use" and left untouched.
- Landing from another volume (downloads come from the app's data folder): copy to
  `<destination folder>/.soundhood-tmp-<job>`, fsync, rename to the final name, then remove the source.
- Downloads in flight live in `incoming/<job-id>/` in the app's data folder, outside the root, so a
  partial file is never synced.
- **Orphan cleanup:** on every start the app removes the temp files it made itself, and only those:
  names of the exact shape the core mints, `.soundhood-tmp-<id>[-<p|r|c><n>][.<ext>]` with `<id>` the
  32 lower-case hex digits of a journal entry id, anywhere under the root (not inside dot-folders),
  whether or not that entry committed (a temp that outlived its rename is stale either way). Each
  removal is journaled (`kind: cleanup`). A file that merely starts with `.soundhood-tmp-`
  (`.soundhood-tmp-My Song.m4a`) is not one of the app's and is left alone. It removes nothing else.

## The index is a cache

`<app data>/library-<root hash>.sqlite`: SQLite with full-text search (FTS5), per device, outside the
root, never synced, never the source of truth. Delete it and choose **Rebuild index**: the same
library comes back from the files alone. Change detection uses each file's modification time and
size; a rebuild never writes into the library.

Two jobs, never mixed: **Rebuild index** (tags, file stamps, playlist reconciliation, artwork hash)
and **Analyse library** (audio hash, fingerprint, loudness; planned, Phase 2; resumable, per device).
The 0.1.0 JSON tag cache in the app's cache folder is deleted after the first successful index build.

## Manifests (snapshots)

A manifest lists every user file with its size and BLAKE3 hash. It is how "nothing changed" is proven.

```json
{
  "root_name": "Music",
  "files": [
    { "rel": "Chill/Song - Artist.m4a", "size": 4123456, "blake3": "<64 hex digits>" }
  ]
}
```

- Scope: audio files and `_Playlists/**`. `_Soundhood/` is excluded (the journal and queues change in
  every session).
- Produced by `soundhood-tools manifest <root> <out.json>`; PowerShell wrappers save snapshots to
  `_Soundhood/snapshots/<date>.json` and compare two of them, printing `Identical` or the changed
  paths ([OWNER_GUIDE](OWNER_GUIDE.md#take-a-library-snapshot-and-compare-two)).

## File names

Existing names are kept exactly as they are. New downloads are named `<Title> - <Artist>.<ext>`; the
artist-side form (how featured artists are written) is read off the library's own conforming files and
recorded in [DECISIONS](DECISIONS.md). Renaming an existing file needs the user's confirmation (Tidy,
planned, Phase 2). Characters Windows or Proton Drive reject are replaced, a name that is taken gets
` (2)`, ` (3)`, and no file is ever overwritten or renamed to make room.

## Sync plan (planned, Phase 6)

On the PC the Proton Drive app mirrors the library root and Soundhood never talks to Proton itself. On
the phone the app runs rclone's `protondrive` backend. In 0.1.0 the phone runs `rclone copy` down and
then up with `--size-only`. That is not "never overwrite": `rclone copy` replaces any destination whose
size or checksum differs, and since it never deletes, a rename on one device becomes a duplicate on
the other. Phase 6 replaces it with the plan below. **Do not simplify it back to one `rclone copy`.**

Ground rules:

- rclone 1.75.2 or newer (1.75.0 wrote files the Proton apps could not decrypt), identifying itself
  honestly as `external-drive-soundhood@<version>`.
- Cached session tokens are reused; no login per run (Proton answers repeated logins with 429).
- `--tpslimit 4 --checkers 2 --transfers 2 --protondrive-replace-existing-draft=true`; nothing is
  ever deleted on either side; long intervals between runs.
- Explicit file lists (`--files-from --no-traverse`): listing a large Proton tree takes minutes and
  triggers throttling.
- Proton stores no modification times, so `--update` is unavailable; it does expose SHA1.

**Two sets, two comparison modes.** The *text set* is `_Playlists/**`, `_Soundhood/**` (without
`.bin/`, `conflicts/`, `snapshots/`), `**/*.lrc` and `**/*.json`, compared with `--checksum` (a
reordered playlist keeps its byte count). The *audio set* is the audio files, with `--size-only` as
rclone's transfer check.

**rclone never overwrites an existing file, in either direction.** Base passes run with
`--ignore-existing` and copy only what is missing on one side; changes are propagated explicitly by
the core:

1. **Round 1, text down.** `_Playlists/**`, `_Soundhood/**` and the `.lrc` list come down with
   `--ignore-existing`. The core then union-merges the per-device files (queues, smart rules). For a
   text file present on both sides whose remote SHA1 differs from the local hash: playlist twins and
   `name (1).m3u8` conflict copies are union-merged into the canonical playlist (merged file written
   and verified first, the twin to the bin, journaled, listed in the sync report); any other text
   file's remote copy goes to `_Soundhood/conflicts/<device-id>/<rel path>` and is listed, never
   resolved automatically.
2. **Tombstones.** Before anything goes up, the core reads every device's journal (just synced in
   round 1) and (a) leaves out every `path_before` of committed rename, move and delete entries, so a
   renamed file is never uploaded again under its old name, and (b) proposes in Tidy to move those
   stale copies to the bin on the device that still has them (journaled, undoable). On the PC this
   reads "N files the phone renamed or removed - move the old copies to the recycle bin?".
3. **Round 2, plan and audio.** The file set is recomputed from the freshly merged playlists (the
   selected playlists and their `.lrc` sidecars); audio comes down with `--ignore-existing`, then audio
   and text go up with `--ignore-existing`.
4. **Explicit up pass.** Files this device changed since its last successful sync (its journal entries
   plus playlist, `.lrc`, queue and smart-rule writes recorded in the index's sync state) go up from a
   file list **without** `--ignore-existing` (size check for audio, checksum for text). A remote file
   whose SHA1 differs from the local pre-change hash (the other device changed it too) is first
   captured to `conflicts/` and listed; it is never overwritten blind.

Missing remote files are reported, not treated as a failed run. Audio twins are reported, never
resolved automatically. Per-device files under `_Soundhood/` cannot conflict by construction.

**Selective sync by playlist** is the default: the chosen playlists, `_Playlists`, `_Soundhood` and
the `.lrc` sidecars of selected tracks. A full-library sync is a separate, explicit action with a
warning. Sync runs in an Android foreground service with a progress notification and Cancel, waits
for Wi-Fi and charging by default, warns when a VPN is on (Proton's challenge pages cannot be shown
through rclone, so the run would just look stuck), and resumes from its saved position after the
system's background-time limit. Sync stays optional: the app works fully with it off.
