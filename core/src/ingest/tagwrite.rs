//! The one write path. Every change to a user file goes through here, in this order: journal
//! pre-image (`committed: false`, fsynced) -> the change (a verified hidden temp renamed over the
//! original, a no-clobber rename, a move to the bin, or the sole m3u8 writer) -> the m3u8
//! consistency rewrites of the same batch -> journal commit line with the after hashes. A tag edit
//! writes one more open line between its checked temp and the rename: the temp's hash ([`READY`]).
//!
//! Read-only files, files another process holds and the track playing now are skipped, never
//! failed, and never count toward the abort rule: 3 consecutive failed checks of a rewritten temp
//! stop the batch. Nothing is ever overwritten to make room, and nothing is deleted except to a bin.
//!
//! A file is hashed when a change is planned and checked again right before the rename that
//! replaces, moves or bins it; a playlist likewise right before its new version is renamed over
//! it. A newer version a sync client put there meanwhile is left alone ("changed since"), never
//! overwritten. A file modified in the last 10 s is not touched at all unless this device's own
//! write path put those bytes there. When a change is given up after its pre-image, one more line
//! with the same id says so (`NOT_APPLIED`); a pre-image left open by a crash is finished or left
//! by startup recovery (`recover`), which [`cleanup_orphans`] runs first.

use super::{
  companions, decode, fault, folder_label, journal, message, recover, report_text, scrub, scrubbed, tracks,
  validate_folder_name, validate_segment, Applied, BatchReport, Failed, JournalEntry, Kind, Op, PlaylistChange,
  Skipped,
};
use crate::error::{Error, Result};
use crate::fs::{self, BinRecord};
use crate::model::{Library, Platform, PlaylistFile, RelPath, TagSet};
use crate::playlist::{self, Expect};
use crate::tags::{self, TagRead};
use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// How a batch is applied.
#[derive(Clone, Debug)]
pub struct ApplyOptions {
  /// Recorded on every entry: `"user"`, `"undo:<batch>"`, ...
  pub source: String,
  /// The track playing now and the next queued: skipped with "playing now", never written.
  pub protected: Vec<RelPath>,
}

impl Default for ApplyOptions {
  fn default() -> Self {
    ApplyOptions {
      source: "user".to_string(),
      protected: Vec::new(),
    }
  }
}

/// Consecutive failed checks that stop a batch (the 349 rule: a writer that damages files must not
/// get to damage many).
const ABORT_AFTER: u32 = 3;

pub(crate) const FILE_IN_USE: &str = "file in use";
pub(crate) const READ_ONLY: &str = "read-only file";
pub(crate) const PLAYING_NOW: &str = "playing now";
/// The file is no longer what was read when the change was planned (a sync client put a newer
/// version there meanwhile): it is left as it is.
pub(crate) const CHANGED_SINCE: &str = "changed since, not changed";
/// The same for an undo: the file is no longer as the change being undone left it.
pub(crate) const CHANGED_SINCE_UNDO: &str = "changed since, not undone";
/// The file changed a few seconds ago and may still be arriving from the other device.
pub(crate) const JUST_CHANGED: &str = "changed a few seconds ago, not changed; try again in a moment";
const NOT_ATTEMPTED: &str = "not attempted: the batch stopped";
const UNREADABLE_TAGS: &str = "its tags could not be read, so nothing was changed";
const NOT_CHECKED_OUT: &str = "not changed: the rewritten copy did not check out";
/// Start of the note on the line that closes a pre-image the write path gave up on before
/// changing anything, or that startup recovery found not done; recovery never looks at such an
/// entry again.
pub(crate) const NOT_APPLIED: &str = "not applied: ";
/// The note on a tag edit's second open line, written once its checked copy is ready and before
/// the file can be replaced; that line's `file_hash_after` is the checked copy's hash.
pub(crate) const READY: &str = "ready: the checked copy goes in place next";
/// How long a file must have been left alone before the write path acts on it (brief: never act
/// on a file whose size changed in the last 10 s; the Proton client rewrites files mid-sync).
const SETTLE: Duration = Duration::from_secs(10);

/// The "changed since" reason for a change or for an undo.
pub(crate) fn changed_since(undoing: bool) -> &'static str {
  if undoing {
    CHANGED_SINCE_UNDO
  } else {
    CHANGED_SINCE
  }
}

/// Applies ops in order as one batch. Tier-1 mechanics for audio files (journal pre-image ->
/// hidden temp copy -> tag write -> verify -> fsync -> atomic replace with retries -> commit line);
/// m3u8 consistency rewrites happen inside the same batch. 3 consecutive verify failures abort.
/// Read-only and in-use files are skipped, not failed, and never abort the batch.
pub fn apply(lib: &Library, ops: Vec<Op>, opts: &ApplyOptions) -> BatchReport {
  apply_detailed(lib, ops, opts).0
}

/// What one op came to, for callers that need the error behind a report row (the api facade turns
/// a single op's skip or failure into its `Err`).
#[derive(Debug)]
pub(crate) enum OpResult {
  /// Changed something; for an audio op, where its file is now (`None` after a delete).
  Done(Option<RelPath>),
  /// Nothing needed doing (already a member, same value, already exists).
  NoChange,
  Skipped(Error),
  Failed(Error),
}

/// [`apply`], plus one [`OpResult`] per op in order.
pub(crate) fn apply_detailed(lib: &Library, ops: Vec<Op>, opts: &ApplyOptions) -> (BatchReport, Vec<OpResult>) {
  let mut b = Batch::new(lib, &opts.source, &opts.protected);
  let mut results = Vec::with_capacity(ops.len());
  for op in ops {
    if b.stopped {
      results.push(b.not_attempted(op_path(&op)));
      continue;
    }
    let outcome = run(&mut b, op);
    results.push(b.record(outcome));
  }
  (b.report, results)
}

/// Lands a file from outside the library (a download in the app's data folder) at `dest`: journal
/// pre-image (`Kind::Ingest`) -> copy to a hidden temp next to `dest` -> hash check -> fsync ->
/// no-clobber rename -> remove the source -> commit line. Never overwrites: a taken name fails.
pub fn land(lib: &Library, staged: &Path, dest: &RelPath, opts: &ApplyOptions) -> BatchReport {
  let mut b = Batch::new(lib, &opts.source, &opts.protected);
  let outcome = land_one(&mut b, staged, dest);
  b.record(outcome);
  b.report
}

/// Startup: remove orphaned .soundhood-tmp-* files whose journal entry never committed (or that no
/// entry names), journaling each removal as Kind::Cleanup. Returns what was removed.
///
/// First, the change a crash interrupted is decided (see `recover`): finished on record when it
/// happened on disk, so "Undo last change" can reach it, closed as not applied when it did not,
/// so no later start takes a change made some other way for it. Then the temps: a temp whose
/// entry did commit is a leftover after its rename and goes too, so every temp the core made is
/// removed; the journal line records which case it was. Only names of the exact shape the core
/// gives its temps count
/// (`fs::temp_entry_id`): a user's own file that merely starts with the prefix is left alone. A
/// temp that cannot be removed now (another program holds it) is left for the next start.
pub fn cleanup_orphans(lib: &Library) -> Result<Vec<RelPath>> {
  recover::recover(lib);
  let temps: Vec<RelPath> = fs::list_tmp_files(&lib.root)?
    .into_iter()
    .filter(|rel| fs::temp_entry_id(rel.file_name()).is_some())
    .collect();
  if temps.is_empty() {
    return Ok(Vec::new());
  }
  let entries = journal::read_all(&lib.root)?;
  let committed: HashSet<&str> = entries.iter().filter(|e| e.committed).map(|e| e.id.as_str()).collect();
  let known: HashSet<&str> = entries.iter().map(|e| e.id.as_str()).collect();
  let b = Batch::new(lib, "cleanup", &[]);
  let mut removed = Vec::new();
  for rel in temps {
    let state = match fs::temp_entry_id(rel.file_name()) {
      Some(id) if committed.contains(id) => "its write had committed",
      Some(id) if known.contains(id) => "its write never committed",
      _ => "no journal entry names it",
    };
    if fs::remove_file(&lib.abs(&rel)).is_err() {
      continue;
    }
    let mut e = b.entry(
      Kind::Cleanup,
      format!("Removed the leftover temp file {}", rel.file_name()),
    );
    e.path_before = Some(rel.clone());
    e.committed = true;
    e.note = Some(format!("orphaned temp: {state}"));
    journal::append(lib, &e)?;
    removed.push(rel);
  }
  Ok(removed)
}

/// What one op came to inside the batch, before it is written into the report.
pub(crate) enum Outcome {
  Done {
    rows: Vec<Applied>,
    path_after: Option<RelPath>,
    /// Side parts that did not work out (a companion lyrics file, one playlist of several).
    extra_failed: Vec<Failed>,
  },
  NoChange {
    path: String,
    reason: String,
  },
  Skipped {
    path: String,
    reason: String,
  },
  Failed {
    path: String,
    err: Error,
    /// A failed check of a rewritten file: counts toward the abort rule.
    counts: bool,
  },
  /// The journal could not be written: nothing more may be attempted in this batch.
  Stop {
    path: String,
    err: Error,
  },
}

impl Outcome {
  fn failed(path: &str, err: Error) -> Outcome {
    Outcome::Failed {
      path: path.to_string(),
      err,
      counts: false,
    }
  }

  fn skipped(path: &str, reason: &str) -> Outcome {
    Outcome::Skipped {
      path: path.to_string(),
      reason: reason.to_string(),
    }
  }

  fn no_change(path: &str, reason: &str) -> Outcome {
    Outcome::NoChange {
      path: path.to_string(),
      reason: reason.to_string(),
    }
  }

  fn done(row: Applied, path_after: Option<RelPath>, extra_failed: Vec<Failed>) -> Outcome {
    Outcome::Done {
      rows: vec![row],
      path_after,
      extra_failed,
    }
  }

  /// The report path and the words a skip or failure would show.
  fn path_and_reason(&self) -> (&str, String) {
    match self {
      Outcome::Skipped { path, reason } | Outcome::NoChange { path, reason } => (path, reason.clone()),
      Outcome::Failed { path, err, .. } | Outcome::Stop { path, err } => (path, message(err)),
      Outcome::Done { .. } => ("", String::new()),
    }
  }
}

/// One batch in progress: its id, the report so far and the abort counter.
pub(crate) struct Batch<'a> {
  pub lib: &'a Library,
  pub id: String,
  source: String,
  protected: HashSet<String>,
  pub report: BatchReport,
  failures_in_row: u32,
  pub stopped: bool,
}

impl<'a> Batch<'a> {
  pub fn new(lib: &'a Library, source: &str, protected: &[RelPath]) -> Batch<'a> {
    let id = new_id();
    Batch {
      lib,
      report: BatchReport {
        batch: id.clone(),
        ..BatchReport::default()
      },
      id,
      source: source.to_string(),
      protected: protected.iter().map(RelPath::key).collect(),
      failures_in_row: 0,
      stopped: false,
    }
  }

  /// A fresh pre-image entry of this batch (`committed: false`).
  pub fn entry(&self, kind: Kind, label: String) -> JournalEntry {
    JournalEntry {
      id: new_id(),
      ts: now_ms(),
      device: self.lib.device.clone(),
      kind,
      path_before: None,
      path_after: None,
      tags_before: None,
      tags_after: None,
      file_hash_before: None,
      file_hash_after: None,
      playlists_touched: Vec::new(),
      bin: None,
      source: self.source.clone(),
      batch: self.id.clone(),
      label,
      committed: false,
      note: None,
    }
  }

  /// This batch undoes another one.
  pub fn undoing(&self) -> bool {
    self.source.starts_with("undo:")
  }

  /// Writes an outcome into the report and keeps the abort counter. Every reason and error is
  /// scrubbed of absolute paths on the way in (see `ingest::scrub`), whatever produced it.
  pub fn record(&mut self, outcome: Outcome) -> OpResult {
    let root = self.lib.root.clone();
    match outcome {
      Outcome::Done {
        rows,
        path_after,
        extra_failed,
      } => {
        self.report.applied.extend(rows);
        self.report.failed.extend(extra_failed.into_iter().map(|f| Failed {
          error: scrub(&f.error, &root, &f.path),
          path: f.path,
        }));
        self.failures_in_row = 0;
        OpResult::Done(path_after)
      }
      Outcome::NoChange { path, reason } => {
        self.report.skipped.push(Skipped { path, reason });
        OpResult::NoChange
      }
      Outcome::Skipped { path, reason } => {
        let reason = scrub(&reason, &root, &path);
        let err = if reason == FILE_IN_USE {
          Error::InUse(path.clone())
        } else {
          Error::Refused(reason.clone())
        };
        self.report.skipped.push(Skipped { path, reason });
        OpResult::Skipped(err)
      }
      Outcome::Failed { path, err, counts } => {
        self.report.failed.push(Failed {
          error: report_text(&err, &root, &path),
          path: path.clone(),
        });
        if counts {
          self.failures_in_row += 1;
          if self.failures_in_row >= ABORT_AFTER {
            self.report.aborted = true;
            self.stopped = true;
          }
        }
        OpResult::Failed(scrubbed(err, &root, &path))
      }
      Outcome::Stop { path, err } => {
        self.report.failed.push(Failed {
          error: report_text(&err, &root, &path),
          path: path.clone(),
        });
        self.report.aborted = true;
        self.stopped = true;
        OpResult::Failed(scrubbed(err, &root, &path))
      }
    }
  }

  /// Reports an op the batch never got to after it stopped.
  pub fn not_attempted(&mut self, path: String) -> OpResult {
    self.report.skipped.push(Skipped {
      path,
      reason: NOT_ATTEMPTED.to_string(),
    });
    OpResult::Skipped(Error::Refused(NOT_ATTEMPTED.to_string()))
  }

  fn is_protected(&self, rel: &RelPath) -> bool {
    self.protected.contains(&rel.key())
  }
}

fn new_id() -> String {
  uuid::Uuid::new_v4().simple().to_string()
}

pub(crate) fn now_ms() -> i64 {
  let now = time::OffsetDateTime::now_utc();
  now.unix_timestamp() * 1000 + i64::from(now.millisecond())
}

/// The commit line: same id, `committed: true`, a fresh time. A failure here means the change is
/// on disk but not on record, so the batch must stop.
pub(crate) fn commit(lib: &Library, e: &mut JournalEntry, path: &str) -> std::result::Result<(), Outcome> {
  e.committed = true;
  e.ts = now_ms();
  journal::append(lib, e).map_err(|err| Outcome::Stop {
    path: path.to_string(),
    err: Error::Other(format!(
      "{path} was changed, but the journal could not record it: {}",
      message(&err)
    )),
  })
}

/// The pre-image line; a failure means nothing was touched and the batch must stop.
pub(crate) fn preimage(lib: &Library, e: &JournalEntry, path: &str) -> std::result::Result<(), Outcome> {
  journal::append(lib, e).map_err(|err| Outcome::Stop {
    path: path.to_string(),
    err: Error::Other(format!(
      "nothing changed: the journal could not be written ({})",
      message(&err)
    )),
  })?;
  fault::point("after_preimage");
  Ok(())
}

/// The tag edit's second open line, right before the file can be replaced: the pre-image again,
/// with `file_hash_after` holding the checked copy's hash and the note [`READY`]. A failure means
/// nothing was touched and the batch must stop (the pre-image without it means "never happened").
fn ready_line(lib: &Library, e: &JournalEntry, path: &str) -> std::result::Result<(), Outcome> {
  journal::append(lib, e).map_err(|err| Outcome::Stop {
    path: path.to_string(),
    err: Error::Other(format!(
      "nothing changed: the journal could not be written ({})",
      message(&err)
    )),
  })?;
  fault::point("after_ready");
  Ok(())
}

/// Closes a pre-image the write path gave up on before changing anything: one more line for the
/// same id, still `committed: false`, whose note starts with [`NOT_APPLIED`] and says why
/// (`detail`, else the reason the report shows). The technical detail behind a plain report row is
/// kept here instead of being shown. Startup recovery never looks at such an entry. Best effort: a
/// journal that cannot take the line leaves an open pre-image, which also means "never happened".
pub(crate) fn give_up(lib: &Library, e: &mut JournalEntry, outcome: Outcome, detail: Option<&str>) -> Outcome {
  let (path, reason) = outcome.path_and_reason();
  let why = detail.map(str::to_string).unwrap_or(reason);
  e.ts = now_ms();
  e.note = Some(format!("{NOT_APPLIED}{}", scrub(&why, &lib.root, path)));
  let _ = journal::append(lib, e);
  outcome
}

/// The report path of an op: the file for audio ops, the playlist name for playlist ops.
fn op_path(op: &Op) -> String {
  match op {
    Op::WriteTags { rel, .. } | Op::Move { rel, .. } | Op::Rename { rel, .. } | Op::Delete { rel } => rel.to_string(),
    Op::PlaylistAdd { name, .. }
    | Op::PlaylistRemove { name, .. }
    | Op::PlaylistCreate { name }
    | Op::PlaylistDelete { name } => name.clone(),
    Op::PlaylistsFromFolders => fs::PLAYLISTS_DIR.to_string(),
  }
}

fn run(b: &mut Batch, op: Op) -> Outcome {
  match op {
    Op::WriteTags { rel, changes } => {
      if let Some(o) = audio_guard(b, &rel).or_else(|| settle_guard(b.lib, &rel)) {
        return o;
      }
      let label = format!("Edited tags of {}", rel.file_name());
      write_tags(b, &rel, &changes, label, None)
    }
    Op::Move { rel, to_folder } => {
      if let Some(o) = audio_guard(b, &rel).or_else(|| settle_guard(b.lib, &rel)) {
        return o;
      }
      let path = rel.to_string();
      let folder = match validate_folder_name(&to_folder) {
        Ok(f) => f,
        Err(e) => return Outcome::failed(&path, e),
      };
      let to = match RelPath::new(&format!("{folder}/{}", rel.file_name())).and_then(|to| as_on_disk(b.lib, &to)) {
        Ok(to) => to,
        Err(e) => return Outcome::failed(&path, e),
      };
      let folder = folder_label(&to);
      if to.key() == rel.key() && same_folder(b.lib, &to, &rel) {
        // The old host's answer to a move into the folder the file is already in, however that
        // folder's name was typed. A twin folder that exists beside it is another folder.
        let msg = format!("{} already exists in {folder}", rel.file_name());
        return Outcome::failed(&path, Error::Exists(msg));
      }
      let label = format!("Moved {} to {folder}", rel.file_name());
      relocate(b, &rel, &to, Kind::Move, label, None, &[], true)
    }
    Op::Rename { rel, to } => {
      if let Some(o) = audio_guard(b, &rel).or_else(|| settle_guard(b.lib, &rel)) {
        return o;
      }
      let path = rel.to_string();
      if let Err(e) = validate_target(&to) {
        return Outcome::failed(&path, e);
      }
      let to = match as_on_disk(b.lib, &to).and_then(|to| in_own_folder(b.lib, &rel, to)) {
        Ok(to) => to,
        Err(e) => return Outcome::failed(&path, e),
      };
      if to == rel {
        return Outcome::no_change(&path, "same name");
      }
      let label = format!("Renamed {} to {}", rel.file_name(), to.file_name());
      relocate(b, &rel, &to, Kind::Rename, label, None, &[], true)
    }
    Op::Delete { rel } => {
      if let Some(o) = audio_guard(b, &rel).or_else(|| settle_guard(b.lib, &rel)) {
        return o;
      }
      let label = format!("Deleted {} (in the bin)", rel.file_name());
      delete(b, &rel, label, None, &[], true)
    }
    Op::PlaylistAdd { name, rels } => playlist_add(b, &name, &rels),
    Op::PlaylistRemove { name, rels } => playlist_remove(b, &name, &rels),
    Op::PlaylistCreate { name } => playlist_create(b, &name),
    Op::PlaylistDelete { name } => playlist_delete(b, &name),
    Op::PlaylistsFromFolders => playlists_from_folders(b),
  }
}

/// Refusals shared by every audio op: the track playing now, the app's own files, non-audio paths.
fn audio_guard(b: &Batch, rel: &RelPath) -> Option<Outcome> {
  let path = rel.as_str();
  if b.is_protected(rel) {
    return Some(Outcome::skipped(path, PLAYING_NOW));
  }
  if rel.is_app_owned() || !fs::is_audio_file(rel.file_name()) {
    return Some(Outcome::failed(
      path,
      Error::InvalidPath(format!("{path} is not a track in the library")),
    ));
  }
  None
}

/// The brief's rule for a file a sync client may still be writing: one modified less than
/// [`SETTLE`] ago is left alone ("try again in a moment"), unless its bytes are ones this device's
/// write path itself left there (an edit right after an edit, a move right after a download).
/// A modification time in the future says nothing about that, so it does not hold the file back.
fn settle_guard(lib: &Library, rel: &RelPath) -> Option<Outcome> {
  let abs = lib.abs(rel);
  let modified = std::fs::metadata(&abs).and_then(|m| m.modified()).ok()?;
  let age = SystemTime::now().duration_since(modified).ok()?;
  if age >= SETTLE {
    return None;
  }
  let hash = fs::file_hash(&abs).ok()?;
  if own_bytes(lib, rel, &hash) {
    return None;
  }
  Some(Outcome::skipped(rel.as_str(), JUST_CHANGED))
}

/// True when one of this device's committed changes left exactly `hash` at `rel`.
fn own_bytes(lib: &Library, rel: &RelPath, hash: &str) -> bool {
  let Ok(entries) = journal::read_device(&lib.root, &lib.device) else {
    return false;
  };
  let key = rel.key();
  entries.iter().any(|e| {
    e.committed && e.file_hash_after.as_deref() == Some(hash) && e.path_after.as_ref().is_some_and(|p| p.key() == key)
  })
}

/// A rename/landing target: every segment a valid name, not inside the app's folders, still an
/// audio file (anything else would vanish from the index).
fn validate_target(to: &RelPath) -> Result<()> {
  for seg in to.as_str().split('/') {
    validate_segment(seg, "Name")?;
  }
  if to.is_app_owned() {
    return Err(Error::InvalidPath(format!("{to} is inside the app's own folder")));
  }
  if !fs::is_audio_file(to.file_name()) {
    return Err(Error::InvalidPath(format!(
      "{} is not an audio file name",
      to.file_name()
    )));
  }
  Ok(())
}

/// `None` when `abs` is a regular, writable file; otherwise the outcome that refuses it. For an
/// undo (`undoing`), a file that is gone is one that changed since: skipped, not failed.
fn check_file(abs: &Path, path: &str, undoing: bool) -> Option<Outcome> {
  match std::fs::metadata(abs) {
    Ok(m) if m.is_file() => m.permissions().readonly().then(|| Outcome::skipped(path, READ_ONLY)),
    Ok(_) => Some(Outcome::failed(
      path,
      Error::InvalidPath(format!("{path} is not a file")),
    )),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound && undoing => Some(Outcome::skipped(path, CHANGED_SINCE_UNDO)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Outcome::failed(
      path,
      Error::NotFound(format!("{path} is not there any more")),
    )),
    Err(e) => Some(skip_or_fail(path, e.into())),
  }
}

/// What the write path saw of a file when it planned a change: size and modification time (the
/// cheap check) and the blake3 of its bytes (the real one).
pub(crate) struct Seen {
  len: u64,
  modified: Option<SystemTime>,
  pub hash: String,
}

impl Seen {
  /// The stamp is taken before hashing, so a change during the hash shows up as a changed stamp.
  pub(crate) fn of(abs: &Path) -> Result<Seen> {
    let meta = std::fs::metadata(abs)?;
    let hash = fs::file_hash(abs)?;
    Ok(Seen {
      len: meta.len(),
      modified: meta.modified().ok(),
      hash,
    })
  }

  /// The file at `abs` is still the one seen: size and modification time first; when they match,
  /// the bytes are hashed again (a same-size rewrite within the clock's resolution changes them).
  fn unchanged(&self, abs: &Path) -> Result<bool> {
    let meta = match std::fs::metadata(abs) {
      Ok(m) => m,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
      Err(e) => return Err(e.into()),
    };
    if meta.len() != self.len || meta.modified().ok() != self.modified {
      return Ok(false);
    }
    Ok(fs::file_hash(abs)? == self.hash)
  }
}

/// `None` while the file at `abs` is still the one `seen` describes; otherwise the skip to report.
/// Called right before the rename that replaces, moves or bins it: a sync client may have renamed
/// a newer version over it since it was hashed, and that version must not be overwritten (the
/// journal's pre-image names only the old one). What remains is the instant between this check
/// and the rename itself.
fn still_as_seen(abs: &Path, seen: &Seen, path: &str, undoing: bool) -> Option<Outcome> {
  fault::hook("before_replace", abs);
  match seen.unchanged(abs) {
    Ok(true) => None,
    Ok(false) => Some(Outcome::skipped(path, changed_since(undoing))),
    Err(err) => Some(skip_or_fail(path, err)),
  }
}

/// A taken destination: a failure for a user's request, a skip for an undo (nothing is forced).
fn taken_outcome(path: &str, dest: &RelPath, undoing: bool) -> Outcome {
  let msg = format!("{} already exists in {}", dest.file_name(), folder_label(dest));
  if undoing {
    Outcome::skipped(path, &format!("not undone: {msg}"))
  } else {
    Outcome::failed(path, Error::Exists(msg))
  }
}

/// `rel` with its folders spelled as they are on disk ([`fs::folders_as_on_disk`]): a destination
/// the user asked for goes into the folder that is there, never a second one beside it whose name
/// differs only in case or Unicode form.
fn as_on_disk(lib: &Library, rel: &RelPath) -> Result<RelPath> {
  fs::folders_as_on_disk(&lib.root, rel.as_str()).and_then(|s| RelPath::new(&s))
}

/// True when `a` and `b` sit in the same folder on disk, however their paths spell it: each folder
/// as [`as_on_disk`] finds it. An exact spelling is its own folder, so two folders side by side
/// whose names differ only in case or Unicode form are two folders.
fn same_folder(lib: &Library, a: &RelPath, b: &RelPath) -> bool {
  let folder = |r: &RelPath| as_on_disk(lib, r).map(|r| r.parent()).unwrap_or_else(|_| r.parent());
  folder(a) == folder(b)
}

/// A rename's destination `to` inside `rel`'s own folder, spelled as `rel` spells that folder, so
/// the rename happens in place even when the two spellings differ; any other `to` as it is.
fn in_own_folder(lib: &Library, rel: &RelPath, to: RelPath) -> Result<RelPath> {
  let key = |r: Option<RelPath>| r.map(|p| p.key());
  if key(to.parent()) != key(rel.parent()) || !same_folder(lib, &to, rel) {
    return Ok(to);
  }
  match rel.parent() {
    Some(folder) => folder.join(to.file_name()),
    None => RelPath::new(to.file_name()),
  }
}

/// The refusal for a destination with a case twin on a case-sensitive disk ([`fs::case_twin`]),
/// given before anything is journaled; `None` when it has none. The name itself taken reads as
/// [`taken_outcome`], the answer Windows gives; a folder on the way names what is there.
fn twin_outcome(lib: &Library, path: &str, dest: &RelPath, undoing: bool) -> Option<Outcome> {
  let msg = match fs::case_twin(&lib.root, dest.as_str()) {
    Ok(None) => return None,
    Ok(Some(fs::Twin::Name)) => return Some(taken_outcome(path, dest, undoing)),
    Ok(Some(fs::Twin::Folder(folder))) => format!("a folder named {folder} already exists"),
    Ok(Some(fs::Twin::NotAFolder(file))) => format!("{file} is a file, not a folder"),
    Err(e) => return Some(skip_or_fail(path, e)),
  };
  Some(if undoing {
    Outcome::skipped(path, &format!("not undone: {msg}"))
  } else {
    Outcome::failed(path, Error::Exists(msg))
  })
}

/// An error from opening or renaming a file another program holds becomes a skip, never a failure.
/// That includes a read the OS refuses because a program holds the file exclusively (a sharing or
/// lock violation, EBUSY): reading tags or hashing the original comes first and hits it first.
fn skip_or_fail(path: &str, err: Error) -> Outcome {
  match err {
    Error::InUse(_) => Outcome::skipped(path, FILE_IN_USE),
    Error::Io(e) if fs::is_locked(&e) => Outcome::skipped(path, FILE_IN_USE),
    Error::Refused(m) if m.starts_with("read-only") => Outcome::skipped(path, READ_ONLY),
    err => Outcome::failed(path, err),
  }
}

/// Only the fields of `changes` that differ from what the file holds now (compared trimmed, as
/// they are written).
fn effective(changes: &TagSet, before: &TagRead) -> TagSet {
  let pick = |c: &Option<String>, was: &str| c.as_ref().filter(|v| v.trim() != was).cloned();
  TagSet {
    title: pick(&changes.title, &before.title),
    artist: pick(&changes.artist, &before.artist),
    album: pick(&changes.album, &before.album),
    album_artist: pick(&changes.album_artist, &before.album_artist),
    genre: pick(&changes.genre, &before.genre),
    year: pick(&changes.year, &before.year),
    comment: pick(&changes.comment, &before.comment),
  }
}

/// Tier 1 tag write. `expect_hash` (undo) refuses the write unless the file still has those bytes.
pub(crate) fn write_tags(
  b: &mut Batch,
  rel: &RelPath,
  changes: &TagSet,
  label: String,
  expect_hash: Option<&str>,
) -> Outcome {
  let path = rel.as_str();
  let lib = b.lib;
  let abs = lib.abs(rel);
  let undoing = expect_hash.is_some();
  if let Some(o) = check_file(&abs, path, undoing) {
    return o;
  }
  let seen = match Seen::of(&abs) {
    Ok(s) => s,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != seen.hash) {
    return Outcome::skipped(path, CHANGED_SINCE_UNDO);
  }
  let before = match tags::read(&abs) {
    Ok(t) => t,
    Err(Error::Tag(_)) => return Outcome::failed(path, Error::Tag(UNREADABLE_TAGS.into())),
    Err(e) => return skip_or_fail(path, e),
  };
  let changes = effective(changes, &before);
  if changes.is_empty() {
    return Outcome::no_change(path, "no change");
  }
  let mut e = b.entry(Kind::Tags, label.clone());
  e.path_before = Some(rel.clone());
  e.path_after = Some(rel.clone());
  e.tags_before = Some(tags::tagset_of(&before));
  e.tags_after = Some(changes.clone());
  e.file_hash_before = Some(seen.hash.clone());
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  let tmp = match fs::copy_to_tmp(&abs, &e.id) {
    Ok(tmp) => tmp,
    Err(err) => return give_up(lib, &mut e, skip_or_fail(path, err), None),
  };
  // From here every way out removes the temp; the original is untouched until the rename.
  let checked = (|| -> Result<Option<String>> {
    tags::write(&tmp, &changes)?;
    fault::point("after_tmp_write");
    tags::verify(&tmp, &before, &changes)?;
    let note = decode::check(&tmp, &abs, before.duration_ms)?;
    fault::point("after_verify");
    fs::fsync(&tmp)?;
    Ok(note)
  })();
  let note = match checked {
    Ok(note) => note,
    // tags::write refuses before writing anything (an unsupported format, a field with several
    // values, an item it could not keep byte-for-byte): nothing went wrong with the file, so it is
    // a skip, not a failed check. The first line is the plain reason, the rest goes to the journal.
    Err(Error::Refused(m)) => {
      let _ = fs::remove_file(&tmp);
      let (reason, detail) = m.split_once('\n').unwrap_or((m.as_str(), m.as_str()));
      return give_up(lib, &mut e, Outcome::skipped(path, reason), Some(detail));
    }
    Err(err) => {
      let _ = fs::remove_file(&tmp);
      let failed = Outcome::Failed {
        path: path.to_string(),
        err: Error::Verify(NOT_CHECKED_OUT.into()),
        counts: true,
      };
      return give_up(lib, &mut e, failed, Some(&message(&err)));
    }
  };
  // The checked copy's hash goes on record before anything can replace the file: a second line
  // for the same id, still open. Startup recovery finishes a tag edit only when the file holds
  // exactly these bytes, so it never takes a change made some other way for this one. Written
  // before the last check, so the instant between that check and the rename does not grow.
  let ready = match fs::file_hash(&tmp) {
    Ok(h) => h,
    Err(err) => {
      let _ = fs::remove_file(&tmp);
      return give_up(lib, &mut e, skip_or_fail(path, err), None);
    }
  };
  e.file_hash_after = Some(ready);
  e.note = Some(READY.to_string());
  if let Err(o) = ready_line(lib, &e, path) {
    let _ = fs::remove_file(&tmp);
    return o;
  }
  if let Some(o) = still_as_seen(&abs, &seen, path, undoing) {
    let _ = fs::remove_file(&tmp);
    return give_up(lib, &mut e, o, None);
  }
  if let Err(err) = fs::atomic_replace(&tmp, &abs) {
    let _ = fs::remove_file(&tmp);
    return give_up(lib, &mut e, skip_or_fail(path, err), None);
  }
  fault::point("after_replace");
  // `file_hash_after` stays the checked copy's hash: the bytes this edit put in place (a version
  // that lands right after the rename is not ours, and undo must not take it for ours).
  e.note = note.map(|n| scrub(&n, &lib.root, path));
  if let Err(o) = commit(lib, &mut e, path) {
    return o;
  }
  Outcome::done(
    Applied {
      label,
      path_before: Some(rel.to_string()),
      path_after: Some(rel.to_string()),
    },
    Some(rel.clone()),
    Vec::new(),
  )
}

/// Tier 1 move or rename of `from` to `to` (no-clobber), with every playlist naming it rewritten in
/// the same batch and, when `with_companions`, its lyrics files following it. `restore` holds the
/// journaled playlist changes of the batch being undone (see [`playlist_changes`]).
#[allow(clippy::too_many_arguments)]
pub(crate) fn relocate(
  b: &mut Batch,
  from: &RelPath,
  to: &RelPath,
  kind: Kind,
  label: String,
  expect_hash: Option<&str>,
  restore: &[PlaylistChange],
  with_companions: bool,
) -> Outcome {
  let path = from.as_str();
  let lib = b.lib;
  let undoing = expect_hash.is_some();
  let (src, dst) = (lib.abs(from), lib.abs(to));
  if let Some(o) = check_file(&src, path, undoing) {
    return o;
  }
  let seen = match Seen::of(&src) {
    Ok(s) => s,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != seen.hash) {
    return Outcome::skipped(path, CHANGED_SINCE_UNDO);
  }
  // A case or normalisation change of the file's own name in its own folder is a rename, not a
  // collision.
  let taken = |dest: &RelPath, own: &RelPath| -> Option<Outcome> {
    // Only where the destination's folder is there as spelled: an undo back into a twin folder
    // that has since gone is the twin check's case below, a skip that names what is there.
    let folder_there = lib.abs(dest).parent().is_some_and(Path::is_dir);
    if dest.key() == own.key() && same_folder(lib, dest, own) && folder_there {
      // Still taken when a third entry already has that name in another case or form.
      return match fs::name_free(&lib.abs(own), &lib.abs(dest)) {
        Ok(()) => None,
        Err(Error::Exists(_)) => Some(taken_outcome(path, dest, undoing)),
        Err(e) => Some(skip_or_fail(path, e)),
      };
    }
    if lib.abs(dest).symlink_metadata().is_ok() {
      return Some(taken_outcome(path, dest, undoing));
    }
    twin_outcome(lib, path, dest, undoing)
  };
  if let Some(o) = taken(to, from) {
    return o;
  }
  let mut follow = Vec::new();
  if with_companions {
    let comps = match companions::of(&lib.root, from) {
      Ok(c) => c,
      Err(e) => return Outcome::failed(path, e),
    };
    for c in comps {
      let c_to = match c.follow(to) {
        Ok(t) => t,
        Err(e) => return Outcome::failed(path, e),
      };
      if let Some(o) = taken(&c_to, &c.rel) {
        return o;
      }
      follow.push((c.rel, c_to));
    }
  }
  let changes = match playlist_changes(&lib.root, from, Some(to), restore) {
    Ok(c) => c,
    Err(e) => return Outcome::failed(path, refused_by_playlist(e, not_done(kind, undoing))),
  };
  let mut e = b.entry(kind, label.clone());
  e.path_before = Some(from.clone());
  e.path_after = Some(to.clone());
  e.file_hash_before = Some(seen.hash.clone());
  e.playlists_touched = changes;
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  if let Some(o) = still_as_seen(&src, &seen, path, undoing) {
    return give_up(lib, &mut e, o, None);
  }
  match fs::rename_no_clobber(&src, &dst) {
    Ok(()) => {}
    // Taken meanwhile, or by a name only the folder listing folds to the same (case-sensitive disks).
    Err(Error::Exists(_)) => return give_up(lib, &mut e, taken_outcome(path, to, undoing), None),
    Err(err) => return give_up(lib, &mut e, skip_or_fail(path, err), None),
  }
  fault::point("after_replace");
  if let Err((err, written)) = rewrite_playlists(lib, &e.id, &mut e.playlists_touched) {
    // Put everything back so the library stays consistent (both steps run either way).
    let undone = restore_playlists(lib, &e.id, &e.playlists_touched[..written]).and(fs::rename_no_clobber(&dst, &src));
    return match undone {
      Ok(()) if playlist::is_changed(&err) => {
        let reason = format!("{}, so nothing was {}", message(&err), not_done(kind, undoing));
        give_up(lib, &mut e, Outcome::skipped(path, &reason), None)
      }
      Ok(()) => {
        let msg = format!("a playlist could not be updated ({}); nothing was moved", message(&err));
        give_up(lib, &mut e, Outcome::failed(path, Error::Other(msg)), None)
      }
      // Half done: the entry stays open, so the next start can finish the move on record.
      Err(back) => Outcome::failed(
        path,
        Error::Other(format!(
          "a playlist could not be updated ({}), and moving the file back failed ({}): it is now at {to}",
          message(&err),
          message(&back)
        )),
      ),
    };
  }
  e.file_hash_after = Some(seen.hash.clone());
  if let Err(o) = commit(lib, &mut e, path) {
    return o;
  }
  let mut extra_failed = Vec::new();
  for (c_from, c_to) in follow {
    let c_label = if kind == Kind::Move {
      format!("Moved {} to {}", c_from.file_name(), folder_label(&c_to))
    } else {
      format!("Renamed {} to {}", c_from.file_name(), c_to.file_name())
    };
    match relocate(b, &c_from, &c_to, kind, c_label, None, &[], false) {
      Outcome::Done { .. } | Outcome::NoChange { .. } => {}
      Outcome::Stop { path, err } => return Outcome::Stop { path, err },
      other => extra_failed.push(side_failure(other, "lyrics file not moved")),
    }
  }
  Outcome::done(
    Applied {
      label,
      path_before: Some(from.to_string()),
      path_after: Some(to.to_string()),
    },
    Some(to.clone()),
    extra_failed,
  )
}

/// Tier 1 delete to the bin, with every playlist naming the file updated in the same batch and,
/// when `with_companions`, its lyrics files binned too.
pub(crate) fn delete(
  b: &mut Batch,
  rel: &RelPath,
  label: String,
  expect_hash: Option<&str>,
  restore: &[PlaylistChange],
  with_companions: bool,
) -> Outcome {
  let path = rel.as_str();
  let lib = b.lib;
  let abs = lib.abs(rel);
  let undoing = expect_hash.is_some();
  if let Some(o) = check_file(&abs, path, undoing) {
    return o;
  }
  let seen = match Seen::of(&abs) {
    Ok(s) => s,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != seen.hash) {
    return Outcome::skipped(path, CHANGED_SINCE_UNDO);
  }
  let comps = if with_companions {
    match companions::of(&lib.root, rel) {
      Ok(c) => c,
      Err(e) => return Outcome::failed(path, e),
    }
  } else {
    Vec::new()
  };
  let changes = match playlist_changes(&lib.root, rel, None, restore) {
    Ok(c) => c,
    Err(e) => return Outcome::failed(path, refused_by_playlist(e, not_done(Kind::Delete, undoing))),
  };
  let mut e = b.entry(Kind::Delete, label.clone());
  e.path_before = Some(rel.clone());
  e.file_hash_before = Some(seen.hash.clone());
  e.playlists_touched = changes;
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  if let Some(o) = still_as_seen(&abs, &seen, path, undoing) {
    return give_up(lib, &mut e, o, None);
  }
  let rec = match to_bin(lib, rel) {
    Ok(rec) => rec,
    Err(err) => return give_up(lib, &mut e, skip_or_fail(path, err), None),
  };
  fault::point("after_replace");
  if let Err((err, written)) = rewrite_playlists(lib, &e.id, &mut e.playlists_touched) {
    let undone = restore_playlists(lib, &e.id, &e.playlists_touched[..written]).and(fs::restore_from_bin(lib, &rec));
    return match undone {
      Ok(()) if playlist::is_changed(&err) => {
        let reason = format!("{}, so nothing was {}", message(&err), not_done(Kind::Delete, undoing));
        give_up(lib, &mut e, Outcome::skipped(path, &reason), None)
      }
      Ok(()) => {
        let msg = format!(
          "a playlist could not be updated ({}); nothing was deleted",
          message(&err)
        );
        give_up(lib, &mut e, Outcome::failed(path, Error::Other(msg)), None)
      }
      Err(back) => Outcome::failed(
        path,
        Error::Other(format!(
          "a playlist could not be updated ({}), and the file could not be brought back from the bin ({})",
          message(&err),
          message(&back)
        )),
      ),
    };
  }
  e.bin = Some(rec);
  if let Err(o) = commit(lib, &mut e, path) {
    return o;
  }
  let mut extra_failed = Vec::new();
  for c in comps {
    let c_label = format!("Deleted {} (in the bin)", c.rel.file_name());
    match delete(b, &c.rel, c_label, None, &[], false) {
      Outcome::Done { .. } | Outcome::NoChange { .. } => {}
      Outcome::Stop { path, err } => return Outcome::Stop { path, err },
      other => extra_failed.push(side_failure(other, "lyrics file not deleted")),
    }
  }
  Outcome::done(
    Applied {
      label,
      path_before: Some(rel.to_string()),
      path_after: None,
    },
    None,
    extra_failed,
  )
}

/// A side part's skip or failure as one report row of the op it belongs to.
pub(crate) fn side_failure(o: Outcome, what: &str) -> Failed {
  match o {
    Outcome::Skipped { path, reason } | Outcome::NoChange { path, reason } => Failed {
      path,
      error: format!("{what}: {reason}"),
    },
    Outcome::Failed { path, err, .. } | Outcome::Stop { path, err } => Failed {
      path,
      error: format!("{what}: {}", message(&err)),
    },
    Outcome::Done { .. } => Failed {
      path: String::new(),
      error: what.to_string(),
    },
  }
}

/// The bin for this library: the app bin on Android, the OS recycle bin elsewhere. Chosen by the
/// library's platform (not only the build target) so desktop tests can use the app bin.
pub(crate) fn to_bin(lib: &Library, rel: &RelPath) -> Result<BinRecord> {
  if lib.platform == Platform::Android {
    fs::to_app_bin(lib, rel)
  } else {
    fs::to_bin(lib, rel)
  }
}

/// Lines of every playlist naming `from` after a move to `to` (or a delete, `to = None`): the
/// path swapped in place (positions kept) or dropped. `restore` holds the journaled changes of a
/// batch being undone: a playlist still byte-for-byte as that batch left it gets its journaled
/// `before` back instead, so an undo restores the exact original lines.
///
/// Any playlist that cannot be read, that the app cannot write back under its own name (a legacy
/// `.m3u`, a name that does not survive sanitising), or that another program wrote in its own
/// format (the app would drop that program's lines) refuses the whole op: the file is not moved
/// rather than leaving that playlist stale.
pub(crate) fn playlist_changes(
  root: &Path,
  from: &RelPath,
  to: Option<&RelPath>,
  restore: &[PlaylistChange],
) -> Result<Vec<PlaylistChange>> {
  if !fs::is_audio_file(from.file_name()) {
    return Ok(Vec::new()); // playlists only list tracks
  }
  let found = playlist::containing(root, from).map_err(|e| {
    Error::Refused(format!(
      "the playlists could not be read, so nothing was changed: {}",
      message(&e)
    ))
  })?;
  let mut out = Vec::new();
  for pl in found {
    let before_hash = writable_playlist(root, &pl)?;
    let journaled = restore
      .iter()
      .find(|r| r.name == pl.name && r.after_hash.as_deref() == Some(before_hash.as_str()))
      .and_then(|r| r.before.clone());
    let after = journaled.unwrap_or_else(|| playlist::with_path_replaced(&pl.entries, from, to));
    out.push(PlaylistChange {
      name: pl.name,
      before: Some(pl.entries),
      after: Some(after),
      before_hash: Some(before_hash),
      after_hash: None,
    });
  }
  Ok(out)
}

/// The blake3 of the `.m3u8` the sole writer would write for `pl`, read once with its lines.
/// Refuses when that is not the file `pl` was read from (a legacy `.m3u`, or a file name that
/// sanitising would change), or when another program wrote it (`playlist::foreign`).
fn writable_playlist(root: &Path, pl: &PlaylistFile) -> Result<String> {
  let refuse = || cannot_update(&pl.name);
  let abs = playlist::file_rel(&pl.name).map_err(|_| refuse())?.to_abs(root);
  if abs.with_extension("m3u").exists() || !abs.is_file() {
    return Err(refuse());
  }
  match playlist::read_exact(root, &pl.name) {
    Ok(x) if !x.ours => Err(playlist::not_ours(&x)),
    Ok(x) if x.file.entries == pl.entries => Ok(x.hash),
    _ => Err(refuse()),
  }
}

/// The past participle for what an op did not do when a playlist stopped it: "moved", "renamed",
/// "deleted", or "undone" for an undo.
fn not_done(kind: Kind, undoing: bool) -> &'static str {
  match kind {
    _ if undoing => "undone",
    Kind::Rename => "renamed",
    Kind::Delete => "deleted",
    _ => "moved",
  }
}

/// `e` for a move, rename or delete refused by a playlist the app leaves as it is: the same words
/// with ", so nothing was <done>" added, as for a playlist that changed since it was read.
fn refused_by_playlist(e: Error, done: &str) -> Error {
  if playlist::is_left_as_is(&e) {
    Error::Refused(format!("{}, so nothing was {done}", message(&e)))
  } else {
    e
  }
}

/// blake3 hex of the bytes the sole writer produces for `entries`.
pub(crate) fn content_hash(entries: &[String]) -> String {
  blake3::hash(playlist::render(entries).as_bytes()).to_hex().to_string()
}

/// What a playlist must still be before its new version replaces it: the journaled hash, or
/// absent when there was none.
pub(crate) fn expect_of(hash: Option<&str>) -> Expect<'_> {
  match hash {
    Some(h) => Expect::Hash(h),
    None => Expect::Absent,
  }
}

/// Writes each change's `after` (or bins the playlist when `after` is `None`), filling `after_hash`.
/// Each is renamed into place only while the playlist is still as it was read (`before_hash`).
/// On failure returns the error and how many were written before it.
fn rewrite_playlists(
  lib: &Library,
  entry_id: &str,
  changes: &mut [PlaylistChange],
) -> std::result::Result<(), (Error, usize)> {
  for (i, pc) in changes.iter_mut().enumerate() {
    let after = pc.after.clone().unwrap_or_default();
    let expect = expect_of(pc.before_hash.as_deref());
    playlist::write_expecting(&lib.root, &pc.name, &after, &format!("{entry_id}-p{i}"), Some(expect))
      .map_err(|e| (e, i))?;
    pc.after_hash = Some(content_hash(&after));
  }
  Ok(())
}

/// Writes each change's `before` back (the rollback of a half-done op), each only while it is
/// still what this op just wrote.
fn restore_playlists(lib: &Library, entry_id: &str, changes: &[PlaylistChange]) -> Result<()> {
  for (i, pc) in changes.iter().enumerate() {
    let before = pc.before.clone().unwrap_or_default();
    let expect = expect_of(pc.after_hash.as_deref());
    playlist::write_expecting(&lib.root, &pc.name, &before, &format!("{entry_id}-r{i}"), Some(expect))?;
  }
  Ok(())
}

/// A playlist as the write path sees it.
pub(crate) enum PlaylistState {
  Absent,
  /// Only a legacy `.m3u` of that name exists; the app never writes it.
  Legacy,
  /// A `.m3u8` another program wrote in its own format (comments, `#EXTINF`, a BOM, CRLF): the
  /// app never writes it, since every write would drop what that program put there.
  Foreign,
  /// A `.m3u8` that does not read as a playlist at all (0 bytes, not UTF-8, NUL bytes): the app
  /// leaves it alone too ([`playlist::unreadable`]).
  Unreadable,
  /// The `.m3u8`, its lines and the blake3 of its bytes.
  Present(PlaylistFile, String),
}

/// The current state of playlist `name`. A playlist that cannot be read at all (locked, a folder
/// of that name) is an error, never `Absent`.
/// What the name names is decided from the folder listing ([`playlist::files_named`]) where the
/// app's own path would answer for another file: a legacy playlist of exactly this name and no
/// `.m3u8` of it is the legacy one, even where a disk that folds case would open an `.m3u8` of
/// another spelling through that path; on a case-sensitive disk a legacy `.M3U`, or a `.M3U8` (an
/// extension the app never writes, so another program's file), is refused, never taken for absent.
pub(crate) fn playlist_state(root: &Path, name: &str) -> Result<PlaylistState> {
  let abs = playlist::file_rel(name)?.to_abs(root);
  let named = playlist::files_named(root, name);
  if named.legacy && !named.m3u8 && !named.other_case_m3u8 {
    return Ok(PlaylistState::Legacy);
  }
  match playlist::read_exact(root, name) {
    Ok(x) if x.ours => Ok(PlaylistState::Present(x.file, x.hash)),
    Ok(x) if !x.readable => Ok(PlaylistState::Unreadable),
    Ok(_) => Ok(PlaylistState::Foreign),
    Err(Error::NotFound(_)) if abs.with_extension("m3u").exists() => Ok(PlaylistState::Legacy),
    Err(Error::NotFound(_)) if named.other_case_m3u8 => Ok(PlaylistState::Foreign),
    Err(Error::NotFound(_)) => Ok(PlaylistState::Absent),
    Err(e) => Err(e),
  }
}

fn legacy_refusal(name: &str) -> Error {
  Error::Refused(format!(
    "playlist {name} is a legacy .m3u file; the app only writes .m3u8"
  ))
}

/// Tier 2: one journaled playlist write. `pc.after = None` sends the playlist to the bin. Either
/// way the playlist must still be what `pc.before_hash` says (absent when `None`) at the moment
/// it is replaced or binned; otherwise it is left as it is ("changed since").
pub(crate) fn write_playlist(b: &mut Batch, kind: Kind, label: String, pc: PlaylistChange) -> Outcome {
  let path = pc.name.clone();
  let lib = b.lib;
  let undoing = b.undoing();
  let rel = match playlist::file_rel(&pc.name) {
    Ok(r) => r,
    Err(e) => return Outcome::failed(&path, e),
  };
  let mut e = b.entry(kind, label.clone());
  e.path_before = pc.before.is_some().then(|| rel.clone());
  e.path_after = pc.after.is_some().then(|| rel.clone());
  e.playlists_touched = vec![pc];
  if let Err(o) = preimage(lib, &e, &path) {
    return o;
  }
  let job = e.id.clone();
  let pc = &mut e.playlists_touched[0];
  let done = match pc.after.clone() {
    Some(after) => {
      let expect = expect_of(pc.before_hash.as_deref());
      playlist::write_expecting(&lib.root, &pc.name, &after, &job, Some(expect)).map(|()| {
        pc.after_hash = Some(content_hash(&after));
        None
      })
    }
    None => {
      fault::hook("before_replace", &lib.abs(&rel));
      let still = match &pc.before_hash {
        Some(h) => fs::file_hash(&lib.abs(&rel)).map(|now| now == *h),
        None => Ok(true),
      };
      match still {
        Ok(true) => to_bin(lib, &rel).map(Some),
        Ok(false) => Err(playlist::changed(&pc.name)),
        Err(err) => Err(err),
      }
    }
  };
  match done {
    Ok(Some(rec)) => e.bin = Some(rec),
    Ok(None) => {}
    Err(err) => {
      let o = if playlist::is_changed(&err) {
        Outcome::skipped(&path, changed_since(undoing))
      } else {
        skip_or_fail(&path, err)
      };
      return give_up(lib, &mut e, o, None);
    }
  }
  fault::point("after_replace");
  if let Err(o) = commit(lib, &mut e, &path) {
    return o;
  }
  Outcome::done(
    Applied {
      label,
      path_before: e.path_before.as_ref().map(|r| r.to_string()),
      path_after: e.path_after.as_ref().map(|r| r.to_string()),
    },
    None,
    Vec::new(),
  )
}

/// The name the UI gave, cleaned, then as it is spelled on disk ([`playlist::on_disk_name`]): every
/// playlist op reads and writes the one file the name means, whatever the case it was typed in.
/// A playlist whose own file name cleaning changes (`Mix..m3u8`, listed as "Mix.") is refused, the
/// way [`writable_playlist`] refuses it: its cleaned name means another file, which may be another
/// playlist in another case, and the app never writes the unclean name.
fn playlist_name(b: &Batch, name: &str) -> Result<String> {
  let clean = playlist::sanitize_name(name)?;
  if clean != name && playlist::has_file_named(&b.lib.root, name) {
    return Err(cannot_update(name));
  }
  playlist::on_disk_name(&b.lib.root, &clean)
}

/// The refusal for a playlist file the sole writer does not write: a legacy `.m3u`, or a file name
/// that cleaning would change.
fn cannot_update(name: &str) -> Error {
  Error::Refused(format!(
    "playlist {name} cannot be updated by the app (only .m3u8 files with a clean name are), so nothing was changed"
  ))
}

/// Adds tracks (in order, no duplicates), creating the playlist when it does not exist yet.
fn playlist_add(b: &mut Batch, name: &str, rels: &[RelPath]) -> Outcome {
  let clean = match playlist_name(b, name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (before, before_hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (Some(pl.entries), Some(h)),
    Ok(PlaylistState::Absent) => (None, None),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
    Ok(PlaylistState::Foreign) => return Outcome::failed(&clean, playlist::foreign(&clean)),
    Ok(PlaylistState::Unreadable) => return Outcome::failed(&clean, playlist::unreadable(&clean)),
    Err(e) => return Outcome::failed(&clean, e),
  };
  let current = before.clone().unwrap_or_default();
  let after = playlist::with_added(&current, rels);
  let added = after.len() - current.len();
  if before.is_some() && added == 0 {
    return Outcome::no_change(&clean, "already in the playlist");
  }
  let label = format!("Added {} to {clean}", tracks(added));
  let pc = PlaylistChange {
    name: clean,
    before,
    after: Some(after),
    before_hash,
    after_hash: None,
  };
  write_playlist(b, Kind::Playlist, label, pc)
}

fn playlist_remove(b: &mut Batch, name: &str, rels: &[RelPath]) -> Outcome {
  let clean = match playlist_name(b, name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (current, hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (pl.entries, h),
    Ok(PlaylistState::Absent) => return Outcome::failed(&clean, Error::NotFound(format!("No playlist named {clean}"))),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
    Ok(PlaylistState::Foreign) => return Outcome::failed(&clean, playlist::foreign(&clean)),
    Ok(PlaylistState::Unreadable) => return Outcome::failed(&clean, playlist::unreadable(&clean)),
    Err(e) => return Outcome::failed(&clean, e),
  };
  let after = playlist::with_removed(&current, rels);
  let removed = current.len() - after.len();
  if removed == 0 {
    return Outcome::no_change(&clean, "not in the playlist");
  }
  let label = format!("Removed {} from {clean}", tracks(removed));
  let pc = PlaylistChange {
    name: clean,
    before: Some(current),
    after: Some(after),
    before_hash: Some(hash),
    after_hash: None,
  };
  write_playlist(b, Kind::Playlist, label, pc)
}

fn playlist_create(b: &mut Batch, name: &str) -> Outcome {
  let clean = match playlist_name(b, name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Absent) => {}
    Ok(PlaylistState::Unreadable) => return Outcome::failed(&clean, playlist::unreadable(&clean)),
    Ok(_) => return Outcome::no_change(&clean, "playlist already exists"),
    Err(e) => return Outcome::failed(&clean, e),
  }
  let label = format!("Created playlist {clean}");
  let pc = PlaylistChange {
    name: clean,
    before: None,
    after: Some(Vec::new()),
    before_hash: None,
    after_hash: None,
  };
  write_playlist(b, Kind::PlaylistCreate, label, pc)
}

/// To the bin. A playlist another program wrote is refused too: undo would bring back only its
/// track lines, in the app's format.
fn playlist_delete(b: &mut Batch, name: &str) -> Outcome {
  let clean = match playlist_name(b, name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (current, hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (pl.entries, h),
    Ok(PlaylistState::Absent) => return Outcome::failed(&clean, Error::NotFound(format!("No playlist named {clean}"))),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
    Ok(PlaylistState::Foreign) => return Outcome::failed(&clean, playlist::foreign(&clean)),
    Ok(PlaylistState::Unreadable) => return Outcome::failed(&clean, playlist::unreadable(&clean)),
    Err(e) => return Outcome::failed(&clean, e),
  };
  let label = format!("Deleted playlist {clean}");
  let pc = PlaylistChange {
    name: clean,
    before: Some(current),
    after: None,
    before_hash: Some(hash),
    after_hash: None,
  };
  write_playlist(b, Kind::PlaylistDelete, label, pc)
}

/// The one-time import: one playlist per first-level folder that has none yet, each its own
/// `PlaylistCreate` entry. A playlist that appears meanwhile is left alone (never overwritten).
fn playlists_from_folders(b: &mut Batch) -> Outcome {
  let root = b.lib.root.clone();
  let path = fs::PLAYLISTS_DIR;
  let plan = match fs::scan(&root).and_then(|stamps| playlist::plan_from_folders(&root, &stamps)) {
    Ok(plan) => plan,
    Err(e) => return Outcome::failed(path, e),
  };
  if plan.is_empty() {
    return Outcome::no_change(path, "every folder already has a playlist");
  }
  let mut rows = Vec::new();
  let mut extra_failed = Vec::new();
  for pl in plan {
    match playlist_state(&root, &pl.name) {
      Ok(PlaylistState::Absent) => {}
      Ok(_) => continue,
      Err(e) => {
        extra_failed.push(Failed {
          error: report_text(&e, &root, &pl.name),
          path: pl.name,
        });
        continue;
      }
    }
    let label = format!("Created playlist {}", pl.name);
    let pc = PlaylistChange {
      name: pl.name,
      before: None,
      after: Some(pl.entries),
      before_hash: None,
      after_hash: None,
    };
    match write_playlist(b, Kind::PlaylistCreate, label, pc) {
      Outcome::Done { rows: r, .. } => rows.extend(r),
      Outcome::Stop { path, err } => return Outcome::Stop { path, err },
      other => extra_failed.push(side_failure(other, "playlist not created")),
    }
  }
  Outcome::Done {
    rows,
    path_after: None,
    extra_failed,
  }
}

/// The pre-image carries the download's hash as `file_hash_after` already: it is known before
/// anything is copied, and startup recovery needs it to recognise the landed file after a crash.
fn land_one(b: &mut Batch, staged: &Path, dest: &RelPath) -> Outcome {
  let path = dest.as_str();
  let lib = b.lib;
  if let Err(e) = validate_target(dest) {
    return Outcome::failed(path, e);
  }
  let resolved = match as_on_disk(lib, dest) {
    Ok(d) => d,
    Err(e) => return Outcome::failed(path, e),
  };
  let dest = &resolved;
  let abs = lib.abs(dest);
  let taken = || {
    let msg = format!("{} already exists in {}", dest.file_name(), folder_label(dest));
    Outcome::failed(path, Error::Exists(msg))
  };
  if abs.symlink_metadata().is_ok() {
    return taken();
  }
  if let Some(o) = twin_outcome(lib, path, dest, false) {
    return o;
  }
  let hash = match fs::file_hash(staged) {
    Ok(h) => h,
    Err(e) => return Outcome::failed(path, e),
  };
  let label = format!("Saved {} in {}", dest.file_name(), folder_label(dest));
  let mut e = b.entry(Kind::Ingest, label.clone());
  e.path_after = Some(dest.clone());
  e.file_hash_after = Some(hash.clone());
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  let tmp = match fs::stage_copy(staged, &abs, &e.id) {
    Ok(t) => t,
    Err(Error::Exists(_)) => return give_up(lib, &mut e, taken(), None),
    Err(err) => return give_up(lib, &mut e, skip_or_fail(path, err), None),
  };
  if fs::file_hash(&tmp).ok().as_deref() != Some(hash.as_str()) {
    let _ = fs::remove_file(&tmp);
    let failed = Outcome::Failed {
      path: path.to_string(),
      err: Error::Verify(format!(
        "the copy of {} in the library does not match the download",
        dest.file_name()
      )),
      counts: true,
    };
    return give_up(lib, &mut e, failed, None);
  }
  fault::point("after_stage_copy");
  match fs::stage_finish(&tmp, &abs, staged) {
    Ok(()) => {}
    Err(Error::Exists(_)) => return give_up(lib, &mut e, taken(), None),
    Err(err) => return give_up(lib, &mut e, skip_or_fail(path, err), None),
  }
  fault::point("after_replace");
  if let Err(o) = commit(lib, &mut e, path) {
    return o;
  }
  Outcome::done(
    Applied {
      label,
      path_before: None,
      path_after: Some(dest.to_string()),
    },
    Some(dest.clone()),
    Vec::new(),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn effective_keeps_only_real_changes() {
    let before = TagRead {
      title: "Song".into(),
      artist: "Artist".into(),
      ..TagRead::default()
    };
    let changes = TagSet {
      title: Some(" Song ".into()),
      artist: Some("Other".into()),
      album: Some(String::new()),
      ..TagSet::default()
    };
    let eff = effective(&changes, &before);
    assert_eq!(
      eff,
      TagSet {
        artist: Some("Other".into()),
        ..TagSet::default()
      }
    );
  }
}
