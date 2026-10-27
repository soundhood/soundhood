//! "Undo last change": replays a journaled batch in reverse, as a new batch whose source is
//! `undo:<batch>`, through the same mechanics as any other write. An entry whose file or playlist
//! is no longer exactly as the batch left it is refused and reported ("changed since — not
//! undone"); nothing is forced.

use super::tagwrite::{
  commit, content_hash, delete, playlist_state, preimage, relocate, side_failure, write_playlist, write_tags, Batch,
  Outcome, PlaylistState, CHANGED_SINCE, FILE_IN_USE,
};
use super::{
  fault, folder_label, journal, message, Applied, BatchReport, ChangeSummary, Failed, JournalEntry, Kind,
  PlaylistChange,
};
use crate::error::{Error, Result};
use crate::fs;
use crate::model::{Library, RelPath};
use crate::playlist;
use std::collections::HashSet;

/// The most recent batch on THIS device that is not an undo and was not undone yet.
pub fn last_change(lib: &Library) -> Result<Option<ChangeSummary>> {
  let mine = journal::read_device(&lib.root, &lib.device)?;
  // An undo made on another device also counts: the journal travels with the library.
  let all = journal::read_all(&lib.root)?;
  let undone: HashSet<&str> = all
    .iter()
    .filter(|e| e.committed)
    .filter_map(|e| e.source.strip_prefix("undo:"))
    .collect();
  let mut best: Option<ChangeSummary> = None;
  for (batch, entries) in group_by_batch(&mine) {
    let first = entries[0];
    if first.source.starts_with("undo:") || first.source == "cleanup" || undone.contains(batch) {
      continue;
    }
    if let Some(s) = summarize(batch, &entries) {
      if best.as_ref().is_none_or(|b| s.ts >= b.ts) {
        best = Some(s);
      }
    }
  }
  Ok(best)
}

/// Replays a batch in reverse. Refuses (reported per entry, not applied) any entry whose current
/// file hash / playlist hash no longer matches the journaled after-state. Writes its own batch with
/// source "undo:<batch>".
///
/// Reads every device's journal, so a batch made on the PC can be undone on the phone once its
/// files have arrived. A batch that was already undone is refused as a whole.
pub fn undo_batch(lib: &Library, batch: &str) -> Result<BatchReport> {
  let all = journal::read_all(&lib.root)?;
  let source = format!("undo:{batch}");
  if all.iter().any(|e| e.committed && e.source == source) {
    return Err(Error::Refused("this change was undone already".into()));
  }
  let entries: Vec<&JournalEntry> = all
    .iter()
    .filter(|e| e.batch == batch && e.committed && e.kind != Kind::Cleanup)
    .collect();
  if entries.is_empty() {
    return Err(Error::NotFound(format!("no change {batch} to undo")));
  }
  let mut b = Batch::new(lib, &source, &[]);
  for (main, lyrics) in with_companions(&entries).into_iter().rev() {
    if b.stopped {
      let path = entry_path(main);
      b.not_attempted(path);
      continue;
    }
    let outcome = undo_entry(&mut b, main);
    let track_undone = matches!(outcome, Outcome::Done { .. });
    b.record(outcome);
    // A track's lyrics files go back only with it, so the two are never split up.
    if !track_undone {
      continue;
    }
    for c in lyrics.into_iter().rev() {
      match undo_entry(&mut b, c) {
        Outcome::Done { .. } | Outcome::NoChange { .. } => {}
        stop @ Outcome::Stop { .. } => {
          b.record(stop);
          break;
        }
        other => b.report.failed.push(side_failure(other, "lyrics file not put back")),
      }
    }
  }
  Ok(b.report)
}

/// Each entry with the lyrics-file entries that followed it in the batch (they were journaled
/// right after their track).
fn with_companions<'a>(entries: &[&'a JournalEntry]) -> Vec<(&'a JournalEntry, Vec<&'a JournalEntry>)> {
  let mut out: Vec<(&JournalEntry, Vec<&JournalEntry>)> = Vec::new();
  for &e in entries {
    match out.last_mut() {
      Some((_, lyrics)) if is_companion(e) => lyrics.push(e),
      _ => out.push((e, Vec::new())),
    }
  }
  out
}

/// Entries grouped by batch, batches in the order they first appear.
fn group_by_batch(entries: &[JournalEntry]) -> Vec<(&str, Vec<&JournalEntry>)> {
  let mut out: Vec<(&str, Vec<&JournalEntry>)> = Vec::new();
  for e in entries {
    match out.iter_mut().find(|(b, _)| *b == e.batch) {
      Some((_, list)) => list.push(e),
      None => out.push((e.batch.as_str(), vec![e])),
    }
  }
  out
}

/// A batch in plain words: the first change's label, " and N more" for the rest. Lyrics files
/// that followed their track and cleanups are not counted. `None` when nothing in it committed.
pub(crate) fn summarize(batch: &str, entries: &[&JournalEntry]) -> Option<ChangeSummary> {
  let done: Vec<&JournalEntry> = entries
    .iter()
    .copied()
    .filter(|e| e.committed && e.kind != Kind::Cleanup)
    .collect();
  let ts = done.iter().map(|e| e.ts).max()?;
  let shown: Vec<&JournalEntry> = done.iter().copied().filter(|e| !is_companion(e)).collect();
  let (first, count) = match shown.first() {
    Some(first) => (first.label.clone(), shown.len()),
    None => (done[0].label.clone(), done.len()),
  };
  let label = if count > 1 && shown.iter().all(|e| e.kind == Kind::PlaylistCreate) {
    format!("Made {count} playlists from folders")
  } else if count > 1 {
    format!("{first} and {} more", count - 1)
  } else {
    first
  };
  Some(ChangeSummary {
    batch: batch.to_string(),
    ts,
    label,
    count,
  })
}

/// A lyrics file that moved or went to the bin with its track (a file entry for a non-audio path).
fn is_companion(e: &JournalEntry) -> bool {
  let path = e.path_before.as_ref().or(e.path_after.as_ref());
  matches!(e.kind, Kind::Move | Kind::Rename | Kind::Delete | Kind::Ingest)
    && path.is_some_and(|p| !fs::is_audio_file(p.file_name()))
}

fn entry_path(e: &JournalEntry) -> String {
  if let Some(pc) = e.playlists_touched.first().filter(|_| is_playlist_kind(e.kind)) {
    return pc.name.clone();
  }
  e.path_after
    .as_ref()
    .or(e.path_before.as_ref())
    .map(|p| p.to_string())
    .unwrap_or_default()
}

fn is_playlist_kind(kind: Kind) -> bool {
  matches!(kind, Kind::Playlist | Kind::PlaylistCreate | Kind::PlaylistDelete)
}

/// The reverse of one entry.
fn undo_entry(b: &mut Batch, e: &JournalEntry) -> Outcome {
  let not_undoable = |why: &str| Outcome::Skipped {
    path: entry_path(e),
    reason: format!("not undone: {why}"),
  };
  match e.kind {
    Kind::Tags => {
      let (Some(rel), Some(before), Some(hash)) = (&e.path_after, &e.tags_before, &e.file_hash_after) else {
        return not_undoable("the journal does not hold what the tags were");
      };
      let label = format!("Restored tags of {}", rel.file_name());
      write_tags(b, rel, before, label, Some(hash))
    }
    Kind::Move | Kind::Rename => {
      let (Some(from), Some(to), Some(hash)) = (&e.path_after, &e.path_before, &e.file_hash_after) else {
        return not_undoable("the journal does not say where the file was");
      };
      let label = if e.kind == Kind::Move {
        format!("Moved {} back to {}", from.file_name(), folder_label(to))
      } else {
        format!("Renamed {} back to {}", from.file_name(), to.file_name())
      };
      // Its lyrics files have entries of their own in this batch: no companion search here.
      relocate(b, from, to, e.kind, label, Some(hash), &e.playlists_touched, false)
    }
    Kind::Delete => restore_deleted(b, e),
    Kind::Ingest => {
      let (Some(rel), Some(hash)) = (&e.path_after, &e.file_hash_after) else {
        return not_undoable("the journal does not say which file arrived");
      };
      let label = format!("Deleted {} (in the bin)", rel.file_name());
      delete(b, rel, label, Some(hash), &e.playlists_touched, false)
    }
    Kind::Playlist | Kind::PlaylistCreate | Kind::PlaylistDelete => revert_playlist(b, e),
    Kind::Cleanup => Outcome::NoChange {
      path: entry_path(e),
      reason: "cleanups are not undone".into(),
    },
  }
}

/// Brings a deleted file back from the bin (never over a file that is there now), and puts it back
/// into the playlists it left: the exact journaled lines where a playlist is unchanged since,
/// appended at the end otherwise. Journaled as `Kind::Ingest` (a file arriving), so undoing the
/// undo bins it again.
fn restore_deleted(b: &mut Batch, e: &JournalEntry) -> Outcome {
  let lib = b.lib;
  let (Some(rel), Some(rec)) = (&e.path_before, &e.bin) else {
    return Outcome::Skipped {
      path: entry_path(e),
      reason: "not undone: the journal does not say where the file went".into(),
    };
  };
  let path = rel.as_str();
  if lib.abs(rel).symlink_metadata().is_ok() {
    return Outcome::Skipped {
      path: path.to_string(),
      reason: CHANGED_SINCE.into(),
    };
  }
  let mut extra_failed = Vec::new();
  let mut changes = Vec::new();
  if fs::is_audio_file(rel.file_name()) {
    for pc in &e.playlists_touched {
      match back_into(&lib.root, pc, rel) {
        Ok(Some(c)) => changes.push(c),
        Ok(None) => {}
        Err(err) => extra_failed.push(Failed {
          path: pc.name.clone(),
          error: format!("not put back into this playlist: {}", message(&err)),
        }),
      }
    }
  }
  let label = format!("Restored {} from the bin", rel.file_name());
  let mut u = b.entry(Kind::Ingest, label.clone());
  u.path_after = Some(rel.clone());
  u.bin = Some(rec.clone());
  u.playlists_touched = changes;
  if let Err(o) = preimage(lib, &u, path) {
    return o;
  }
  if let Err(err) = fs::restore_from_bin(lib, rec) {
    let reason = match err {
      Error::Exists(_) => CHANGED_SINCE.to_string(),
      Error::NotFound(_) => "not undone: it is no longer in the bin".to_string(),
      Error::InUse(_) => FILE_IN_USE.to_string(),
      Error::Refused(m) => format!("not undone: {m}"),
      err => {
        return Outcome::Failed {
          path: path.to_string(),
          err,
          counts: false,
        }
      }
    };
    return Outcome::Skipped {
      path: path.to_string(),
      reason,
    };
  }
  fault::point("after_replace");
  let hash = fs::file_hash(&lib.abs(rel)).ok();
  if hash.is_some() && hash != e.file_hash_before {
    u.note = Some("the file brought back from the bin differs from the one deleted".into());
  }
  u.file_hash_after = hash;
  // Membership is best effort per playlist: the file is back either way.
  let mut written = Vec::new();
  for (i, mut pc) in std::mem::take(&mut u.playlists_touched).into_iter().enumerate() {
    let after = pc.after.clone().unwrap_or_default();
    match playlist::write(&lib.root, &pc.name, &after, &format!("{}-p{i}", u.id)) {
      Ok(()) => {
        pc.after_hash = Some(content_hash(&after));
        written.push(pc);
      }
      Err(err) => extra_failed.push(Failed {
        path: pc.name.clone(),
        error: format!("not put back into this playlist: {}", message(&err)),
      }),
    }
  }
  u.playlists_touched = written;
  if let Err(o) = commit(lib, &mut u, path) {
    return o;
  }
  Outcome::Done {
    rows: vec![Applied {
      label,
      path_before: None,
      path_after: Some(rel.to_string()),
    }],
    path_after: Some(rel.clone()),
    extra_failed,
  }
}

/// The rewrite that puts `rel` back into the playlist a delete took it out of: the journaled lines
/// when the playlist is byte-for-byte as the delete left it, else `rel` appended. `None` when the
/// playlist is gone or already lists it.
fn back_into(root: &std::path::Path, pc: &PlaylistChange, rel: &RelPath) -> Result<Option<PlaylistChange>> {
  let PlaylistState::Present(current, hash) = playlist_state(root, &pc.name)? else {
    return Ok(None);
  };
  let after = match (&pc.before, &pc.after_hash) {
    (Some(before), Some(after_hash)) if *after_hash == hash => before.clone(),
    _ => playlist::with_added(&current.entries, std::slice::from_ref(rel)),
  };
  if after == current.entries {
    return Ok(None);
  }
  Ok(Some(PlaylistChange {
    name: pc.name.clone(),
    before: Some(current.entries),
    after: Some(after),
    before_hash: Some(hash),
    after_hash: None,
  }))
}

/// Puts a playlist back as it was before the entry: its old lines, recreated if the entry deleted
/// it, or to the bin if the entry created it. Refused unless the playlist is exactly as the entry
/// left it.
fn revert_playlist(b: &mut Batch, e: &JournalEntry) -> Outcome {
  let Some(pc) = e.playlists_touched.first() else {
    return Outcome::NoChange {
      path: entry_path(e),
      reason: "nothing to undo".into(),
    };
  };
  let name = pc.name.as_str();
  let (current, current_hash) = match playlist_state(&b.lib.root, name) {
    Ok(PlaylistState::Present(pl, h)) => (Some(pl.entries), Some(h)),
    Ok(PlaylistState::Absent) => (None, None),
    Ok(PlaylistState::Legacy) => (None, Some(String::new())),
    Err(err) => {
      return Outcome::Failed {
        path: name.to_string(),
        err,
        counts: false,
      }
    }
  };
  if current_hash != pc.after_hash {
    return Outcome::Skipped {
      path: name.to_string(),
      reason: CHANGED_SINCE.into(),
    };
  }
  let (kind, label) = match (&pc.before, &current) {
    (Some(_), Some(_)) => (Kind::Playlist, format!("Restored playlist {name}")),
    (Some(_), None) => (Kind::PlaylistCreate, format!("Restored playlist {name}")),
    (None, Some(_)) => (Kind::PlaylistDelete, format!("Deleted playlist {name} (in the bin)")),
    (None, None) => {
      return Outcome::NoChange {
        path: name.to_string(),
        reason: "nothing to undo".into(),
      }
    }
  };
  let change = PlaylistChange {
    name: name.to_string(),
    before: current,
    after: pc.before.clone(),
    before_hash: current_hash,
    after_hash: None,
  };
  write_playlist(b, kind, label, change)
}
