//! The one write path. Every change to a user file goes through here, in this order: journal
//! pre-image (`committed: false`, fsynced) -> the change (a verified hidden temp renamed over the
//! original, a no-clobber rename, a move to the bin, or the sole m3u8 writer) -> the m3u8
//! consistency rewrites of the same batch -> journal commit line with the after hashes.
//!
//! Read-only files, files another process holds and the track playing now are skipped, never
//! failed, and never count toward the abort rule: 3 consecutive failed checks of a rewritten temp
//! stop the batch. Nothing is ever overwritten to make room, and nothing is deleted except to a bin.

use super::{
  companions, decode, fault, folder_label, journal, message, tracks, validate_folder_name, validate_segment, Applied,
  BatchReport, Failed, JournalEntry, Kind, Op, PlaylistChange, Skipped,
};
use crate::error::{Error, Result};
use crate::fs::{self, BinRecord};
use crate::model::{Library, Platform, PlaylistFile, RelPath, TagSet};
use crate::playlist;
use crate::tags::{self, TagRead};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

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
pub(crate) const CHANGED_SINCE: &str = "changed since — not undone";
const NOT_ATTEMPTED: &str = "not attempted: the batch stopped";

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
/// A temp whose entry did commit is a leftover after its rename and goes too, so every temp the
/// core made is removed; the journal line records which case it was. Only names of the exact shape
/// the core gives its temps count (`fs::temp_entry_id`): a user's own file that merely starts with
/// the prefix is left alone. A temp that cannot be removed now (another program holds it) is left
/// for the next start.
pub fn cleanup_orphans(lib: &Library) -> Result<Vec<RelPath>> {
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

  /// Writes an outcome into the report and keeps the abort counter.
  pub fn record(&mut self, outcome: Outcome) -> OpResult {
    match outcome {
      Outcome::Done {
        rows,
        path_after,
        extra_failed,
      } => {
        self.report.applied.extend(rows);
        self.report.failed.extend(extra_failed);
        self.failures_in_row = 0;
        OpResult::Done(path_after)
      }
      Outcome::NoChange { path, reason } => {
        self.report.skipped.push(Skipped { path, reason });
        OpResult::NoChange
      }
      Outcome::Skipped { path, reason } => {
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
          path,
          error: message(&err),
        });
        if counts {
          self.failures_in_row += 1;
          if self.failures_in_row >= ABORT_AFTER {
            self.report.aborted = true;
            self.stopped = true;
          }
        }
        OpResult::Failed(err)
      }
      Outcome::Stop { path, err } => {
        self.report.failed.push(Failed {
          path,
          error: message(&err),
        });
        self.report.aborted = true;
        self.stopped = true;
        OpResult::Failed(err)
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

fn now_ms() -> i64 {
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
      if let Some(o) = audio_guard(b, &rel) {
        return o;
      }
      let label = format!("Edited tags of {}", rel.file_name());
      write_tags(b, &rel, &changes, label, None)
    }
    Op::Move { rel, to_folder } => {
      if let Some(o) = audio_guard(b, &rel) {
        return o;
      }
      let path = rel.to_string();
      let folder = match validate_folder_name(&to_folder) {
        Ok(f) => f,
        Err(e) => return Outcome::failed(&path, e),
      };
      let to = match RelPath::new(&format!("{folder}/{}", rel.file_name())) {
        Ok(to) => to,
        Err(e) => return Outcome::failed(&path, e),
      };
      if to == rel {
        // The old host's answer to a move into the folder the file is already in.
        let msg = format!("{} already exists in {folder}", rel.file_name());
        return Outcome::failed(&path, Error::Exists(msg));
      }
      let label = format!("Moved {} to {folder}", rel.file_name());
      relocate(b, &rel, &to, Kind::Move, label, None, &[], true)
    }
    Op::Rename { rel, to } => {
      if let Some(o) = audio_guard(b, &rel) {
        return o;
      }
      let path = rel.to_string();
      if let Err(e) = validate_target(&to) {
        return Outcome::failed(&path, e);
      }
      if to == rel {
        return Outcome::no_change(&path, "same name");
      }
      let label = format!("Renamed {} to {}", rel.file_name(), to.file_name());
      relocate(b, &rel, &to, Kind::Rename, label, None, &[], true)
    }
    Op::Delete { rel } => {
      if let Some(o) = audio_guard(b, &rel) {
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
    Err(e) if e.kind() == std::io::ErrorKind::NotFound && undoing => Some(Outcome::skipped(path, CHANGED_SINCE)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Outcome::failed(
      path,
      Error::NotFound(format!("{path} is not there any more")),
    )),
    Err(e) => Some(Outcome::failed(path, e.into())),
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
  let abs = b.lib.abs(rel);
  if let Some(o) = check_file(&abs, path, expect_hash.is_some()) {
    return o;
  }
  let before = match tags::read(&abs) {
    Ok(t) => t,
    Err(e) => return skip_or_fail(path, e),
  };
  let hash_before = match fs::file_hash(&abs) {
    Ok(h) => h,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != hash_before) {
    return Outcome::skipped(path, CHANGED_SINCE);
  }
  let changes = effective(changes, &before);
  if changes.is_empty() {
    return Outcome::no_change(path, "no change");
  }
  let mut e = b.entry(Kind::Tags, label.clone());
  e.path_before = Some(rel.clone());
  e.path_after = Some(rel.clone());
  e.tags_before = Some(tags::tagset_of(&before));
  e.tags_after = Some(changes.clone());
  e.file_hash_before = Some(hash_before);
  if let Err(o) = preimage(b.lib, &e, path) {
    return o;
  }
  let tmp = match fs::copy_to_tmp(&abs, &e.id) {
    Ok(tmp) => tmp,
    Err(err) => return skip_or_fail(path, err),
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
    // tags::write refuses before writing anything (an unsupported format, or an item it could not
    // keep byte-for-byte): nothing went wrong with the file, so it is a skip, not a failed check.
    Err(Error::Refused(m)) => {
      let _ = fs::remove_file(&tmp);
      // The first line is the plain reason; the rest is technical detail.
      return Outcome::skipped(path, m.lines().next().unwrap_or_default());
    }
    Err(err) => {
      let _ = fs::remove_file(&tmp);
      return Outcome::Failed {
        path: path.to_string(),
        err: Error::Verify(format!(
          "not changed: the rewritten copy did not check out ({})",
          message(&err)
        )),
        counts: true,
      };
    }
  };
  if let Err(err) = fs::atomic_replace(&tmp, &abs) {
    let _ = fs::remove_file(&tmp);
    return skip_or_fail(path, err);
  }
  fault::point("after_replace");
  e.file_hash_after = fs::file_hash(&abs).ok();
  e.note = note;
  if let Err(o) = commit(b.lib, &mut e, path) {
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
  let hash = match fs::file_hash(&src) {
    Ok(h) => h,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != hash) {
    return Outcome::skipped(path, CHANGED_SINCE);
  }
  // A case or normalisation change of the same name is a rename, not a collision.
  let taken = |dest: &RelPath, own: &RelPath| dest.key() != own.key() && lib.abs(dest).symlink_metadata().is_ok();
  if taken(to, from) {
    return taken_outcome(path, to, undoing);
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
      if taken(&c_to, &c.rel) {
        return taken_outcome(path, &c_to, undoing);
      }
      follow.push((c.rel, c_to));
    }
  }
  let changes = match playlist_changes(&lib.root, from, Some(to), restore) {
    Ok(c) => c,
    Err(e) => return Outcome::failed(path, e),
  };
  let mut e = b.entry(kind, label.clone());
  e.path_before = Some(from.clone());
  e.path_after = Some(to.clone());
  e.file_hash_before = Some(hash.clone());
  e.playlists_touched = changes;
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  match fs::rename_no_clobber(&src, &dst) {
    Ok(()) => {}
    // Taken meanwhile, or by a name only the folder listing folds to the same (case-sensitive disks).
    Err(Error::Exists(_)) => return taken_outcome(path, to, undoing),
    Err(err) => return skip_or_fail(path, err),
  }
  fault::point("after_replace");
  if let Err((err, written)) = rewrite_playlists(lib, &e.id, &mut e.playlists_touched) {
    // Put everything back so the library stays consistent (both steps run either way).
    let undone = restore_playlists(lib, &e.id, &e.playlists_touched[..written]).and(fs::rename_no_clobber(&dst, &src));
    let msg = match undone {
      Ok(()) => format!("a playlist could not be updated ({}); nothing was moved", message(&err)),
      Err(back) => format!(
        "a playlist could not be updated ({}), and moving the file back failed ({}): it is now at {to}",
        message(&err),
        message(&back)
      ),
    };
    return Outcome::failed(path, Error::Other(msg));
  }
  e.file_hash_after = Some(hash);
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
  if let Some(o) = check_file(&abs, path, expect_hash.is_some()) {
    return o;
  }
  let hash = match fs::file_hash(&abs) {
    Ok(h) => h,
    Err(e) => return skip_or_fail(path, e),
  };
  if expect_hash.is_some_and(|want| want != hash) {
    return Outcome::skipped(path, CHANGED_SINCE);
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
    Err(e) => return Outcome::failed(path, e),
  };
  let mut e = b.entry(Kind::Delete, label.clone());
  e.path_before = Some(rel.clone());
  e.file_hash_before = Some(hash);
  e.playlists_touched = changes;
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  let rec = match to_bin(lib, rel) {
    Ok(rec) => rec,
    Err(err) => return skip_or_fail(path, err),
  };
  fault::point("after_replace");
  if let Err((err, written)) = rewrite_playlists(lib, &e.id, &mut e.playlists_touched) {
    let undone = restore_playlists(lib, &e.id, &e.playlists_touched[..written]).and(fs::restore_from_bin(lib, &rec));
    let msg = match undone {
      Ok(()) => format!(
        "a playlist could not be updated ({}); nothing was deleted",
        message(&err)
      ),
      Err(back) => format!(
        "a playlist could not be updated ({}), and the file could not be brought back from the bin ({})",
        message(&err),
        message(&back)
      ),
    };
    return Outcome::failed(path, Error::Other(msg));
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
/// Any playlist that cannot be read, or that the app cannot write back under its own name (a
/// legacy `.m3u`, a name that does not survive sanitising), refuses the whole op: the file is not
/// moved rather than leaving that playlist stale.
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
    let abs = writable_playlist(root, &pl)?;
    let before_hash = fs::file_hash(&abs)?;
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

/// The `.m3u8` the sole writer would write for `pl`, refusing when that is not the file `pl` was
/// read from (a legacy `.m3u`, or a file name that sanitising would change).
fn writable_playlist(root: &Path, pl: &PlaylistFile) -> Result<PathBuf> {
  let refuse = || {
    Error::Refused(format!(
      "playlist {} cannot be updated by the app (only .m3u8 files with a clean name are), so nothing was changed",
      pl.name
    ))
  };
  let abs = playlist::file_rel(&pl.name).map_err(|_| refuse())?.to_abs(root);
  if abs.with_extension("m3u").exists() || !abs.is_file() {
    return Err(refuse());
  }
  match playlist::read(root, &pl.name) {
    Ok(m3u8) if m3u8.entries == pl.entries => Ok(abs),
    _ => Err(refuse()),
  }
}

/// blake3 hex of the bytes the sole writer produces for `entries`.
pub(crate) fn content_hash(entries: &[String]) -> String {
  blake3::hash(playlist::render(entries).as_bytes()).to_hex().to_string()
}

/// Writes each change's `after` (or bins the playlist when `after` is `None`), filling `after_hash`.
/// On failure returns the error and how many were written before it.
fn rewrite_playlists(
  lib: &Library,
  entry_id: &str,
  changes: &mut [PlaylistChange],
) -> std::result::Result<(), (Error, usize)> {
  for (i, pc) in changes.iter_mut().enumerate() {
    let after = pc.after.clone().unwrap_or_default();
    playlist::write(&lib.root, &pc.name, &after, &format!("{entry_id}-p{i}")).map_err(|e| (e, i))?;
    pc.after_hash = Some(content_hash(&after));
  }
  Ok(())
}

/// Writes each change's `before` back (the rollback of a half-done op).
fn restore_playlists(lib: &Library, entry_id: &str, changes: &[PlaylistChange]) -> Result<()> {
  for (i, pc) in changes.iter().enumerate() {
    let before = pc.before.clone().unwrap_or_default();
    playlist::write(&lib.root, &pc.name, &before, &format!("{entry_id}-r{i}"))?;
  }
  Ok(())
}

/// A playlist as the write path sees it.
pub(crate) enum PlaylistState {
  Absent,
  /// Only a legacy `.m3u` of that name exists; the app never writes it.
  Legacy,
  /// The `.m3u8`, its lines and the blake3 of its bytes.
  Present(PlaylistFile, String),
}

/// The current state of playlist `name`. An unreadable playlist is an error, never `Absent`.
pub(crate) fn playlist_state(root: &Path, name: &str) -> Result<PlaylistState> {
  let abs = playlist::file_rel(name)?.to_abs(root);
  match playlist::read(root, name) {
    Ok(pl) => {
      let hash = fs::file_hash(&abs)?;
      Ok(PlaylistState::Present(pl, hash))
    }
    Err(Error::NotFound(_)) if abs.with_extension("m3u").exists() => Ok(PlaylistState::Legacy),
    Err(Error::NotFound(_)) => Ok(PlaylistState::Absent),
    Err(e) => Err(e),
  }
}

fn legacy_refusal(name: &str) -> Error {
  Error::Refused(format!(
    "playlist {name} is a legacy .m3u file; the app only writes .m3u8"
  ))
}

/// Tier 2: one journaled playlist write. `pc.after = None` sends the playlist to the bin.
pub(crate) fn write_playlist(b: &mut Batch, kind: Kind, label: String, pc: PlaylistChange) -> Outcome {
  let path = pc.name.clone();
  let lib = b.lib;
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
  match pc.after.clone() {
    Some(after) => {
      if let Err(err) = playlist::write(&lib.root, &pc.name, &after, &job) {
        return skip_or_fail(&path, err);
      }
      pc.after_hash = Some(content_hash(&after));
    }
    None => match to_bin(lib, &rel) {
      Ok(rec) => e.bin = Some(rec),
      Err(err) => return skip_or_fail(&path, err),
    },
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

/// Adds tracks (in order, no duplicates), creating the playlist when it does not exist yet.
fn playlist_add(b: &mut Batch, name: &str, rels: &[RelPath]) -> Outcome {
  let clean = match playlist::sanitize_name(name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (before, before_hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (Some(pl.entries), Some(h)),
    Ok(PlaylistState::Absent) => (None, None),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
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
  let clean = match playlist::sanitize_name(name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (current, hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (pl.entries, h),
    Ok(PlaylistState::Absent) => return Outcome::failed(&clean, Error::NotFound(format!("No playlist named {clean}"))),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
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
  let clean = match playlist::sanitize_name(name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Absent) => {}
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

fn playlist_delete(b: &mut Batch, name: &str) -> Outcome {
  let clean = match playlist::sanitize_name(name) {
    Ok(n) => n,
    Err(e) => return Outcome::failed(name, e),
  };
  let (current, hash) = match playlist_state(&b.lib.root, &clean) {
    Ok(PlaylistState::Present(pl, h)) => (pl.entries, h),
    Ok(PlaylistState::Absent) => return Outcome::failed(&clean, Error::NotFound(format!("No playlist named {clean}"))),
    Ok(PlaylistState::Legacy) => return Outcome::failed(&clean, legacy_refusal(&clean)),
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
          path: pl.name,
          error: message(&e),
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

fn land_one(b: &mut Batch, staged: &Path, dest: &RelPath) -> Outcome {
  let path = dest.as_str();
  let lib = b.lib;
  if let Err(e) = validate_target(dest) {
    return Outcome::failed(path, e);
  }
  let abs = lib.abs(dest);
  if abs.symlink_metadata().is_ok() {
    let msg = format!("{} already exists in {}", dest.file_name(), folder_label(dest));
    return Outcome::failed(path, Error::Exists(msg));
  }
  let hash = match fs::file_hash(staged) {
    Ok(h) => h,
    Err(e) => return Outcome::failed(path, e),
  };
  let label = format!("Saved {} in {}", dest.file_name(), folder_label(dest));
  let mut e = b.entry(Kind::Ingest, label.clone());
  e.path_after = Some(dest.clone());
  if let Err(o) = preimage(lib, &e, path) {
    return o;
  }
  let tmp = match fs::stage_copy(staged, &abs, &e.id) {
    Ok(t) => t,
    Err(err) => return skip_or_fail(path, err),
  };
  if fs::file_hash(&tmp).ok().as_deref() != Some(hash.as_str()) {
    let _ = fs::remove_file(&tmp);
    return Outcome::Failed {
      path: path.to_string(),
      err: Error::Verify(format!(
        "the copy of {} in the library does not match the download",
        dest.file_name()
      )),
      counts: true,
    };
  }
  fault::point("after_stage_copy");
  if let Err(err) = fs::stage_finish(&tmp, &abs, staged) {
    return skip_or_fail(path, err);
  }
  fault::point("after_replace");
  e.file_hash_after = Some(hash);
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
