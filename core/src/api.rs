//! The surface the hosts call. Lead-owned: signatures change only through an interface change
//! request. Every mutating method routes through `ingest::tagwrite` and returns its `BatchReport`.

use crate::error::{Error, Result};
use crate::index::{self, Index, RefreshReport};
use crate::ingest::tagwrite::{self, ApplyOptions, OpResult};
use crate::ingest::{undo, BatchReport, ChangeSummary, Op};
use crate::model::{Library, Platform, PlaylistFile, RelPath, TagSet, Track};
use crate::{fs, playlist};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// One open library on one device. Hosts keep one `Core` per library root.
pub struct Core {
  pub lib: Library,
  index: Index,
  /// Serialises every write: the core is the single writer of user files on this device.
  write_lock: Mutex<()>,
  app_data_dir: PathBuf,
  /// Where the pre-rebuild JSON tag cache lives, until the first successful refresh removes it.
  legacy_cache_dir: Mutex<Option<PathBuf>>,
}

/// What a host learns at startup.
#[derive(serde::Serialize, Clone, Debug)]
pub struct OpenReport {
  pub device: String,
  pub orphans_removed: Vec<String>,
  pub legacy_cache_removed: bool,
}

impl Core {
  /// Opens the library at `root`: device id from `app_data_dir`, index in `app_data_dir`, orphaned
  /// temp files from interrupted writes cleaned up (journaled). `legacy_cache_dir` is where the
  /// pre-rebuild JSON tag cache lived; it is deleted after the first successful index refresh.
  pub fn open(root: &Path, app_data_dir: &Path, legacy_cache_dir: Option<&Path>) -> Result<(Core, OpenReport)> {
    if !root.is_dir() {
      return Err(Error::NotFound(format!("library folder {}", root.display())));
    }
    let device = fs::device_id(app_data_dir)?;
    let lib = Library {
      root: root.to_path_buf(),
      device: device.clone(),
      platform: Platform::current(),
    };
    // The legacy cache seeds the first refresh, so upgrading does not re-read every file.
    let index = Index::open(app_data_dir, root)?.with_legacy_cache_dir(legacy_cache_dir);
    let orphans = tagwrite::cleanup_orphans(&lib)?;
    let core = Core {
      lib,
      index,
      write_lock: Mutex::new(()),
      app_data_dir: app_data_dir.to_path_buf(),
      legacy_cache_dir: Mutex::new(legacy_cache_dir.map(Path::to_path_buf)),
    };
    let report = OpenReport {
      device: device.0,
      orphans_removed: orphans.iter().map(RelPath::to_string).collect(),
      // The cache goes after the first successful refresh (`scan`), not at open.
      legacy_cache_removed: false,
    };
    Ok((core, report))
  }

  /// Where this device's index lives (for diagnostics and "Copy log").
  pub fn index_path(&self) -> PathBuf {
    Index::db_path(&self.app_data_dir, &self.lib.root)
  }

  /// Refresh the index from disk (incremental) and return the UI's track list.
  pub fn scan(&self) -> Result<Vec<Track>> {
    self.index.refresh(&self.lib)?;
    self.drop_legacy_cache();
    self.index.tracks(&self.lib)
  }

  /// "Rebuild index": drop and rebuild from the files alone.
  pub fn rebuild_index(&self) -> Result<RefreshReport> {
    let report = self.index.rebuild(&self.lib)?;
    self.drop_legacy_cache();
    Ok(report)
  }

  pub fn playlists(&self) -> Result<Vec<PlaylistFile>> {
    playlist::list(&self.lib.root)
  }

  /// Tier 1. Writes title + artist (empty = clear) and returns the re-read track.
  pub fn write_tags(&self, abs: &Path, title: &str, artist: &str) -> Result<(Track, BatchReport)> {
    let rel = self.rel(abs)?;
    let changes = TagSet {
      title: Some(title.trim().to_string()),
      artist: Some(artist.trim().to_string()),
      ..TagSet::default()
    };
    // Unchanged values are no change: the file is not rewritten and the call still succeeds.
    let (report, _) = self.run_one(Op::WriteTags {
      rel: rel.clone(),
      changes,
    })?;
    Ok((self.track_at(&rel)?, report))
  }

  /// Tier 1. Moves a file into `<root>/<target_folder>/`, same name; playlists follow in the same batch.
  pub fn move_track(&self, abs: &Path, target_folder: &str) -> Result<(Track, BatchReport)> {
    let rel = self.rel(abs)?;
    let (report, after) = self.run_one(Op::Move {
      rel,
      to_folder: target_folder.to_string(),
    })?;
    let to = after.ok_or_else(|| Error::other("the move did not say where the file went"))?;
    Ok((self.track_at(&to)?, report))
  }

  /// Tier 1. To the bin (desktop recycle bin, Android `_Soundhood/.bin`); playlists follow.
  pub fn delete_track(&self, abs: &Path) -> Result<BatchReport> {
    let rel = self.rel(abs)?;
    Ok(self.run_one(Op::Delete { rel })?.0)
  }

  /// Tier 2. Adds absolute paths (converted to RelPath) to a playlist, creating it if needed.
  pub fn playlist_add(&self, name: &str, abs_paths: &[PathBuf]) -> Result<(PlaylistFile, BatchReport)> {
    let rels = self.rels(abs_paths)?;
    let (report, _) = self.run_one(Op::PlaylistAdd {
      name: name.to_string(),
      rels,
    })?;
    Ok((self.playlist_named(name)?, report))
  }

  pub fn playlist_remove(&self, name: &str, abs_paths: &[PathBuf]) -> Result<(PlaylistFile, BatchReport)> {
    let rels = self.rels(abs_paths)?;
    let (report, _) = self.run_one(Op::PlaylistRemove {
      name: name.to_string(),
      rels,
    })?;
    Ok((self.playlist_named(name)?, report))
  }

  pub fn playlist_create(&self, name: &str) -> Result<(PlaylistFile, BatchReport)> {
    let (report, _) = self.run_one(Op::PlaylistCreate { name: name.to_string() })?;
    Ok((self.playlist_named(name)?, report))
  }

  pub fn playlist_delete(&self, name: &str) -> Result<BatchReport> {
    Ok(self.run_one(Op::PlaylistDelete { name: name.to_string() })?.0)
  }

  /// The one-time "Make playlists from folders" import; never overwrites an existing playlist.
  pub fn playlists_from_folders(&self) -> Result<(Vec<PlaylistFile>, BatchReport)> {
    let (report, _) = self.run_one(Op::PlaylistsFromFolders)?;
    Ok((playlist::list(&self.lib.root)?, report))
  }

  /// The last change on this device that can still be undone, in plain words.
  pub fn last_change(&self) -> Result<Option<ChangeSummary>> {
    undo::last_change(&self.lib)
  }

  pub fn undo_last(&self) -> Result<BatchReport> {
    let _guard = self.lock();
    let Some(last) = undo::last_change(&self.lib)? else {
      return Err(Error::Refused("Nothing to undo".into()));
    };
    let report = undo::undo_batch(&self.lib, &last.batch)?;
    self.refresh_after(&report)?;
    Ok(report)
  }

  pub fn undo_batch(&self, batch: &str) -> Result<BatchReport> {
    let _guard = self.lock();
    let report = undo::undo_batch(&self.lib, batch)?;
    self.refresh_after(&report)?;
    Ok(report)
  }

  /// Runs the bundled fixture checks through this build ("Run self-test"). `scratch_dir` must be
  /// app-writable: the phone cannot write to the system temp dir, so the host passes its cache dir.
  pub fn self_test(scratch_dir: &Path) -> SelfTestReport {
    let lines = crate::fixtures::self_test_lines_in(scratch_dir);
    let failed = lines.iter().filter(|(ok, _)| !ok).count();
    SelfTestReport {
      passed: lines.len() - failed,
      failed,
      lines: lines
        .into_iter()
        .map(|(ok, l)| format!("{} {l}", if ok { "PASS" } else { "FAIL" }))
        .collect(),
    }
  }

  pub fn rel(&self, abs: &Path) -> Result<RelPath> {
    self.lib.rel(abs)
  }

  fn rels(&self, abs_paths: &[PathBuf]) -> Result<Vec<RelPath>> {
    abs_paths.iter().map(|p| self.rel(p)).collect()
  }

  fn lock(&self) -> MutexGuard<'_, ()> {
    // A panic in another write cannot leave a half-applied state the lock protects (every write
    // is journaled), so a poisoned lock is still usable.
    self.write_lock.lock().unwrap_or_else(PoisonError::into_inner)
  }

  /// One op as its own batch, under the write lock, with the index refreshed after a change. The
  /// op's skip or failure becomes the call's `Err` with its reason ("file in use", "read-only
  /// file", "<name> already exists in <folder>", ...); "nothing to change" is success.
  fn run_one(&self, op: Op) -> Result<(BatchReport, Option<RelPath>)> {
    let _guard = self.lock();
    let (report, mut results) = tagwrite::apply_detailed(&self.lib, vec![op], &ApplyOptions::default());
    self.refresh_after(&report)?;
    match results.pop() {
      Some(OpResult::Done(path_after)) => Ok((report, path_after)),
      Some(OpResult::NoChange) | None => Ok((report, None)),
      Some(OpResult::Skipped(err)) | Some(OpResult::Failed(err)) => Err(err),
    }
  }

  /// Any applied change refreshes the index (incremental), and every file the batch's report names
  /// (before and after) is read again even when its mtime and size match the index: a tag rewrite can
  /// keep the size, and an edit and its undo can land in the same second.
  fn refresh_after(&self, report: &BatchReport) -> Result<()> {
    if report.applied.is_empty() {
      return Ok(());
    }
    let touched: Vec<RelPath> = report
      .applied
      .iter()
      .flat_map(|a| [a.path_before.as_deref(), a.path_after.as_deref()])
      .flatten()
      .filter_map(|p| RelPath::new(p).ok())
      .collect();
    self.index.refresh_touched(&self.lib, &touched)?;
    Ok(())
  }

  /// The UI's track for `rel`, from the freshly refreshed index.
  fn track_at(&self, rel: &RelPath) -> Result<Track> {
    self
      .index
      .track(&self.lib, rel)?
      .ok_or_else(|| Error::NotFound(rel.to_string()))
  }

  /// The playlist the UI asked for by name, in any case or Unicode form, as the write path found it
  /// ([`playlist::on_disk_name`]); a legacy `.m3u` of that name is found too.
  fn playlist_named(&self, name: &str) -> Result<PlaylistFile> {
    let clean = playlist::sanitize_name(name)?;
    let on_disk = playlist::on_disk_name(&self.lib.root, &clean)?;
    match playlist::read(&self.lib.root, &on_disk) {
      Err(Error::NotFound(missing)) => playlist::list(&self.lib.root)?
        .into_iter()
        .find(|p| playlist::same_name(&p.name, &clean))
        .ok_or(Error::NotFound(missing)),
      other => other,
    }
  }

  /// Removes the pre-rebuild JSON tag cache once, after a successful refresh. A failure to remove
  /// it is retried after the next refresh; it never fails the scan.
  fn drop_legacy_cache(&self) {
    let mut pending = self.legacy_cache_dir.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(dir) = pending.as_ref() {
      if index::remove_legacy_json_cache(dir, &self.lib.root).is_ok() {
        *pending = None;
      }
    }
  }
}

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct SelfTestReport {
  pub passed: usize,
  pub failed: usize,
  pub lines: Vec<String>,
}
