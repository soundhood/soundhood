//! Startup recovery: the change a crash interrupted after it had happened on disk, but before its
//! commit line was written, is finished on record so "Undo last change" can reach it; the one it
//! interrupted before that is closed as not applied.
//!
//! A crash leaves at most one change in flight: the last pre-image this device wrote. Every other
//! open pre-image was given up on while the app kept running (its last line says `NOT_APPLIED`),
//! or belongs to a change the app has moved past. So only this device's last entry is looked at,
//! and it is decided once:
//! - The disk shows exactly what the change would have left (for a tag edit, the bytes of the
//!   checked copy whose hash the write path journaled right before the rename; for a move or
//!   rename, the same bytes under the new name only; for a delete, the same bytes in the bin): the
//!   playlists it was about to rewrite get their journaled lines (only where they are still as the
//!   entry found them) and the commit line is written, source `"recovery"` (an undo keeps its
//!   `"undo:<batch>"`, which the undo bookkeeping keys on), note [`RECOVERED`].
//! - The disk does not: one more open line closes the entry, note [`INTERRUPTED`] when the disk
//!   still shows the state from before the change, [`NOT_ON_DISK`] otherwise. Either way no later
//!   start looks at it again, so a change made some other way afterwards (by hand, or the other
//!   device's identical one) is never taken for this one.
//! - Something cannot be read now (a locked file, a bin that cannot be listed): nothing is
//!   written, and the next start decides.
//!
//! Recovery is best effort and never fails the start.

use super::tagwrite::{content_hash, now_ms, NOT_APPLIED};
use super::{journal, JournalEntry, Kind, PlaylistChange};
use crate::error::Error;
use crate::fs::{self, BinRecord};
use crate::model::{Library, Platform, RelPath};
use crate::playlist::{self, Expect};

/// The note on a commit line written by recovery.
pub(crate) const RECOVERED: &str = "finished after an interrupted run";
/// The note on the line recovery writes to close an entry whose change did not happen: the disk
/// still shows the state from before it.
pub(crate) const INTERRUPTED: &str = "not applied: interrupted before the change";
/// The note on the line recovery writes to close an entry whose change is not on disk, where the
/// disk does not show the state from before it either (the file was changed, moved or removed
/// some other way since).
pub(crate) const NOT_ON_DISK: &str = "not applied: interrupted, and the change is not on disk";

/// What the disk says about an open entry's change.
enum Found {
  /// It happened: the entry with its after-state filled in.
  Done(JournalEntry),
  /// It is not on disk: the note of the line that closes the entry.
  NotApplied(&'static str),
}

/// Decides this device's interrupted change, if there is one: finishes it on record when it
/// happened (returns its label), closes it when it did not.
pub(crate) fn recover(lib: &Library) -> Option<String> {
  let entries = journal::read_device(&lib.root, &lib.device).ok()?;
  let last = entries.into_iter().rev().find(|e| e.kind != Kind::Cleanup)?;
  if last.committed || last.note.as_deref().is_some_and(|n| n.starts_with(NOT_APPLIED)) {
    return None;
  }
  // `None`: something could not be read; the entry is left for the next start.
  match finished(lib, last.clone())? {
    Found::Done(mut e) => {
      e.committed = true;
      e.ts = now_ms();
      e.note = Some(RECOVERED.to_string());
      if !e.source.starts_with("undo:") {
        e.source = "recovery".to_string();
      }
      journal::append(lib, &e).ok()?;
      Some(e.label)
    }
    Found::NotApplied(note) => {
      let mut e = last;
      e.ts = now_ms();
      e.note = Some(note.to_string());
      let _ = journal::append(lib, &e);
      None
    }
  }
}

/// What the disk says about `e`'s change; `None` when something needed cannot be read now.
fn finished(lib: &Library, mut e: JournalEntry) -> Option<Found> {
  let not = |note| Some(Found::NotApplied(note));
  match e.kind {
    Kind::Tags => {
      let rel = e.path_after.clone()?;
      // The checked copy's hash, journaled right before the rename. Without it the rename never
      // ran, whatever the file shows now.
      let Some(ready) = e.file_hash_after.clone() else {
        return not(INTERRUPTED);
      };
      match hash_exactly(lib, &rel)? {
        Some(now) if now == ready => {}
        Some(now) if e.file_hash_before.as_deref() == Some(now.as_str()) => return not(INTERRUPTED),
        _ => return not(NOT_ON_DISK),
      }
    }
    Kind::Move | Kind::Rename => {
      let (from, to) = (e.path_before.clone()?, e.path_after.clone()?);
      let before = e.file_hash_before.clone()?;
      // A case-only rename is one name or the other: the listing tells them apart.
      match (exists_exactly(lib, &from)?, exists_exactly(lib, &to)?) {
        (false, true) => {
          if fs::file_hash(&lib.abs(&to)).ok()? != before {
            return not(NOT_ON_DISK);
          }
        }
        (true, _) => return not(INTERRUPTED),
        (false, false) => return not(NOT_ON_DISK),
      }
      e.file_hash_after = Some(before);
      finish_playlists(lib, &mut e);
    }
    Kind::Delete => {
      let rel = e.path_before.clone()?;
      let before = e.file_hash_before.clone()?;
      match hash_at(lib, &rel)? {
        Some(now) if now == before => return not(INTERRUPTED),
        Some(_) => return not(NOT_ON_DISK),
        None => {}
      }
      match binned(lib, &rel, e.ts, &before)? {
        Some(rec) => e.bin = Some(rec),
        None => return not(NOT_ON_DISK),
      }
      finish_playlists(lib, &mut e);
    }
    Kind::Ingest => {
      let rel = e.path_after.clone()?;
      let Some(hash) = hash_exactly(lib, &rel)? else {
        return not(INTERRUPTED);
      };
      match &e.bin {
        // A delete being undone: the file is back and no longer in the app bin.
        Some(rec) => {
          if rec.bin_rel.as_ref().is_some_and(|b| lib.abs(b).exists()) {
            return not(NOT_ON_DISK);
          }
        }
        // A download landing: the pre-image holds the download's hash.
        None => {
          if e.file_hash_after.as_deref() != Some(hash.as_str()) {
            return not(NOT_ON_DISK);
          }
        }
      }
      e.file_hash_after = Some(hash);
      finish_playlists(lib, &mut e);
    }
    Kind::Playlist | Kind::PlaylistCreate | Kind::PlaylistDelete => {
      let ts = e.ts;
      let pc = e.playlists_touched.first_mut()?;
      let now = match playlist::read_exact(&lib.root, &pc.name) {
        Ok(x) => Some(x.hash),
        Err(Error::NotFound(_)) => None,
        Err(_) => return None,
      };
      if now == pc.before_hash {
        return not(INTERRUPTED);
      }
      match pc.after.clone() {
        Some(after) => {
          let want = content_hash(&after);
          if now.as_deref() != Some(want.as_str()) {
            return not(NOT_ON_DISK);
          }
          pc.after_hash = Some(want);
        }
        None => {
          if now.is_some() {
            return not(NOT_ON_DISK);
          }
          let rel = playlist::file_rel(&pc.name).ok()?;
          match binned(lib, &rel, ts, pc.before_hash.as_deref()?)? {
            Some(rec) => e.bin = Some(rec),
            None => return not(NOT_ON_DISK),
          }
        }
      }
    }
    Kind::Cleanup => return None,
  }
  Some(Found::Done(e))
}

/// Whether a file named exactly `rel`'s name sits in its folder (not another case or
/// normalisation of it); `None` when the folder cannot be listed.
fn exists_exactly(lib: &Library, rel: &RelPath) -> Option<bool> {
  let abs = lib.abs(rel);
  let dir = abs.parent()?;
  match std::fs::read_dir(dir) {
    Ok(rd) => Some(rd.flatten().any(|d| d.file_name().to_string_lossy() == rel.file_name())),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(false),
    Err(_) => None,
  }
}

/// The hash of the file named exactly `rel`, `Some(None)` when there is none, `None` when it
/// cannot be read now.
fn hash_exactly(lib: &Library, rel: &RelPath) -> Option<Option<String>> {
  if !exists_exactly(lib, rel)? {
    return Some(None);
  }
  hash_at(lib, rel)
}

/// The hash of the file at `rel` (any case the file system folds to it), `Some(None)` when there is
/// none, `None` when it cannot be read now.
fn hash_at(lib: &Library, rel: &RelPath) -> Option<Option<String>> {
  match fs::file_hash(&lib.abs(rel)) {
    Ok(h) => Some(Some(h)),
    Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Some(None),
    Err(_) => None,
  }
}

/// Where an interrupted delete put the bytes `hash` that were at `rel`: the app bin on Android, the
/// OS recycle bin elsewhere. `Some(None)` when they are in neither, `None` when the bin cannot be
/// listed now.
fn binned(lib: &Library, rel: &RelPath, since_ms: i64, hash: &str) -> Option<Option<BinRecord>> {
  if lib.platform == Platform::Android {
    Some(fs::find_in_app_bin(lib, rel, since_ms, hash))
  } else {
    fs::find_in_os_bin(lib, rel, since_ms, hash).ok()
  }
}

/// Writes the journaled `after` of every playlist the entry was about to rewrite, where the
/// playlist is still exactly as the entry found it (`before_hash`), and records `after_hash` for
/// each that holds it now. A playlist someone changed meanwhile is left as it is, without an
/// `after_hash`, so undo leaves it alone too.
fn finish_playlists(lib: &Library, e: &mut JournalEntry) {
  let id = e.id.clone();
  for (i, pc) in e.playlists_touched.iter_mut().enumerate() {
    finish_playlist(lib, &format!("{id}-c{i}"), pc);
  }
}

fn finish_playlist(lib: &Library, job: &str, pc: &mut PlaylistChange) {
  let Some(after) = pc.after.clone() else {
    return;
  };
  let want = content_hash(&after);
  let Ok(now) = playlist::read_exact(&lib.root, &pc.name) else {
    return;
  };
  if now.hash == want {
    pc.after_hash = Some(want);
    return;
  }
  if pc.before_hash.as_deref() != Some(now.hash.as_str()) {
    return;
  }
  if playlist::write_expecting(&lib.root, &pc.name, &after, job, Some(Expect::Hash(&now.hash))).is_ok() {
    pc.after_hash = Some(want);
  }
}
