//! Startup recovery: the change a crash interrupted after it had happened on disk, but before its
//! commit line was written, is finished on record so "Undo last change" can reach it.
//!
//! A crash leaves at most one change in flight: the last pre-image this device wrote. Every other
//! open pre-image was given up on while the app kept running (its last line says `NOT_APPLIED`),
//! or belongs to a change the app has moved past. So only this device's last entry is looked at.
//! When it is open and the disk shows the change evidently happened, the playlists it was about to
//! rewrite get their journaled lines (only where they are still as the entry found them) and the
//! commit line is written: source `"recovery"` (an undo keeps its `"undo:<batch>"`, which the undo
//! bookkeeping keys on), note [`RECOVERED`]. When it did not happen, nothing is written: an open
//! pre-image already means "never happened". Recovery is best effort and never fails the start:
//! anything it cannot read leaves the entry as it is.

use super::tagwrite::{content_hash, now_ms, NOT_APPLIED};
use super::{journal, JournalEntry, Kind, PlaylistChange};
use crate::fs::{self, BinRecord};
use crate::model::{Library, Platform, RelPath, TagSet};
use crate::playlist::{self, Expect};
use crate::tags;

/// The note on a commit line written by recovery.
pub(crate) const RECOVERED: &str = "finished after an interrupted run";

/// Finishes this device's interrupted change, if there is one and it happened. Returns its label.
pub(crate) fn recover(lib: &Library) -> Option<String> {
  let entries = journal::read_device(&lib.root, &lib.device).ok()?;
  let last = entries.into_iter().rev().find(|e| e.kind != Kind::Cleanup)?;
  if last.committed || last.note.as_deref().is_some_and(|n| n.starts_with(NOT_APPLIED)) {
    return None;
  }
  let mut e = finished(lib, last)?;
  e.committed = true;
  e.ts = now_ms();
  e.note = Some(RECOVERED.to_string());
  if !e.source.starts_with("undo:") {
    e.source = "recovery".to_string();
  }
  journal::append(lib, &e).ok()?;
  Some(e.label)
}

/// `e` with its after-state filled in from the disk, when the disk shows its change happened.
fn finished(lib: &Library, mut e: JournalEntry) -> Option<JournalEntry> {
  match e.kind {
    Kind::Tags => {
      let rel = e.path_after.clone()?;
      if !exists_exactly(lib, &rel) {
        return None;
      }
      let abs = lib.abs(&rel);
      // The intended values are there and the bytes are not the old ones.
      if !shows(e.tags_after.as_ref()?, &tags::read(&abs).ok()?) {
        return None;
      }
      let hash = fs::file_hash(&abs).ok()?;
      if e.file_hash_before.as_deref() == Some(hash.as_str()) {
        return None;
      }
      e.file_hash_after = Some(hash);
    }
    Kind::Move | Kind::Rename => {
      let (from, to) = (e.path_before.clone()?, e.path_after.clone()?);
      // The file is under its new name only (a case-only rename is one name or the other).
      if !exists_exactly(lib, &to) || exists_exactly(lib, &from) {
        return None;
      }
      let hash = fs::file_hash(&lib.abs(&to)).ok()?;
      if e.file_hash_before.as_deref() != Some(hash.as_str()) {
        return None;
      }
      e.file_hash_after = Some(hash);
      finish_playlists(lib, &mut e);
    }
    Kind::Delete => {
      let rel = e.path_before.clone()?;
      if lib.abs(&rel).symlink_metadata().is_ok() {
        return None;
      }
      e.bin = Some(binned(lib, &rel, e.ts, e.file_hash_before.as_deref()?)?);
      finish_playlists(lib, &mut e);
    }
    Kind::Ingest => {
      let rel = e.path_after.clone()?;
      if !exists_exactly(lib, &rel) {
        return None;
      }
      let hash = fs::file_hash(&lib.abs(&rel)).ok()?;
      match &e.bin {
        // A delete being undone: the file is back and no longer in the app bin.
        Some(rec) => {
          if rec.bin_rel.as_ref().is_some_and(|b| lib.abs(b).exists()) {
            return None;
          }
        }
        // A download landing: the pre-image holds the download's hash.
        None => {
          if e.file_hash_after.as_deref() != Some(hash.as_str()) {
            return None;
          }
        }
      }
      e.file_hash_after = Some(hash);
      finish_playlists(lib, &mut e);
    }
    Kind::Playlist | Kind::PlaylistCreate | Kind::PlaylistDelete => {
      let ts = e.ts;
      let pc = e.playlists_touched.first_mut()?;
      match pc.after.clone() {
        Some(after) => {
          let want = content_hash(&after);
          if playlist::read_exact(&lib.root, &pc.name).ok()?.hash != want {
            return None;
          }
          pc.after_hash = Some(want);
        }
        None => {
          let rel = playlist::file_rel(&pc.name).ok()?;
          if lib.abs(&rel).symlink_metadata().is_ok() {
            return None;
          }
          let rec = binned(lib, &rel, ts, pc.before_hash.as_deref()?)?;
          e.bin = Some(rec);
        }
      }
    }
    Kind::Cleanup => return None,
  }
  Some(e)
}

/// Every field the edit set holds the value it was set to (trimmed, as written; "" when cleared).
fn shows(want: &TagSet, now: &tags::TagRead) -> bool {
  let fields = [
    (&want.title, &now.title),
    (&want.artist, &now.artist),
    (&want.album, &now.album),
    (&want.album_artist, &now.album_artist),
    (&want.genre, &now.genre),
    (&want.year, &now.year),
    (&want.comment, &now.comment),
  ];
  fields
    .iter()
    .all(|(w, n)| w.as_deref().is_none_or(|w| w.trim() == n.as_str()))
}

/// A file named exactly `rel`'s name sits in its folder (not another case or normalisation of it).
fn exists_exactly(lib: &Library, rel: &RelPath) -> bool {
  let abs = lib.abs(rel);
  let Some(dir) = abs.parent() else {
    return false;
  };
  std::fs::read_dir(dir)
    .map(|rd| rd.flatten().any(|d| d.file_name().to_string_lossy() == rel.file_name()))
    .unwrap_or(false)
}

/// Where an interrupted delete put `rel`: the app bin on Android, the OS recycle bin elsewhere.
fn binned(lib: &Library, rel: &RelPath, since_ms: i64, hash: &str) -> Option<BinRecord> {
  if lib.platform == Platform::Android {
    fs::find_in_app_bin(lib, rel, since_ms, hash)
  } else {
    fs::find_in_os_bin(lib, rel, since_ms)
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
