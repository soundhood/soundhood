//! Library commands: the UI's scan, playlist and track edits, now thin calls into
//! `soundhood_core::api::Core`. Every mutating command goes through the core's one write path
//! (journal, verify, bin) and emits `core:batch` when it changed something; names and argument
//! shapes are unchanged.
//!
//! Each single-op command is a `tauri::command` wrapper over a plain function of the core, so the
//! behaviour the UI sees (what is an error, what is success) is tested without a window. The core
//! already returns a real skip or failure ("file in use", "read-only file", "<name> already exists
//! in <folder>") as the call's error; an op that was already in effect is success, as it was before
//! the rebuild.

use crate::state::{emit_batch, emit_change, is_library_dir, reason, track_in_library, with_core};
use serde::Deserialize;
use soundhood_core::api::Core;
use soundhood_core::index::RefreshReport;
use soundhood_core::ingest::{BatchReport, ChangeSummary};
use soundhood_core::{PlaylistFile, Track};
use std::path::PathBuf;
use tauri::AppHandle;

/// Refreshes the index from disk (only changed files are re-read) and returns the track list.
#[tauri::command]
pub async fn scan_music_folder(app: AppHandle, dir: String) -> Result<Vec<Track>, String> {
  if !is_library_dir(&dir) {
    return Err("Selected path is not a directory".into());
  }
  with_core(&app, dir, |_, core| core.scan().map_err(reason)).await
}

/// Every playlist file in `_Playlists/`, sorted by name; none when the folder is missing.
#[tauri::command]
pub async fn list_playlists(app: AppHandle, library_dir: String) -> Result<Vec<PlaylistFile>, String> {
  // The pre-rebuild host answered an empty list for a missing folder; keep that.
  if !is_library_dir(&library_dir) {
    return Ok(Vec::new());
  }
  with_core(&app, library_dir, |_, core| core.playlists().map_err(reason)).await
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlaylistEditArgs {
  #[serde(alias = "libraryDir")]
  library_dir: String,
  name: String,
  /// Absolute paths of tracks.
  #[serde(default)]
  paths: Vec<String>,
}

/// Absolute track paths inside the library; others are ignored, as they always were.
fn paths_in_library(core: &Core, paths: &[String]) -> Vec<PathBuf> {
  paths
    .iter()
    .map(PathBuf::from)
    .filter(|p| core.rel(p).is_ok())
    .collect()
}

/// Adds tracks to a playlist (created if needed), without duplicates.
#[tauri::command]
pub async fn playlist_add(app: AppHandle, args: PlaylistEditArgs) -> Result<PlaylistFile, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    add_to_playlist(core, &args, |r| emit_change(app, r))
  })
  .await
}

/// `playlist_add`: tracks already in the playlist are success, the playlist as it is.
pub(crate) fn add_to_playlist(
  core: &Core,
  args: &PlaylistEditArgs,
  emit: impl FnOnce(&BatchReport),
) -> Result<PlaylistFile, String> {
  let paths = paths_in_library(core, &args.paths);
  let (playlist, report) = core.playlist_add(&args.name, &paths).map_err(reason)?;
  emit(&report);
  Ok(playlist)
}

/// Removes tracks from a playlist; the playlist file stays.
#[tauri::command]
pub async fn playlist_remove(app: AppHandle, args: PlaylistEditArgs) -> Result<PlaylistFile, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    remove_from_playlist(core, &args, |r| emit_change(app, r))
  })
  .await
}

/// `playlist_remove`: tracks that are not in the playlist are success, the playlist as it is.
pub(crate) fn remove_from_playlist(
  core: &Core,
  args: &PlaylistEditArgs,
  emit: impl FnOnce(&BatchReport),
) -> Result<PlaylistFile, String> {
  let paths = paths_in_library(core, &args.paths);
  let (playlist, report) = core.playlist_remove(&args.name, &paths).map_err(reason)?;
  emit(&report);
  Ok(playlist)
}

/// Creates an empty playlist, or returns the existing one untouched.
#[tauri::command]
pub async fn playlist_create(app: AppHandle, args: PlaylistEditArgs) -> Result<PlaylistFile, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    create_playlist(core, &args, |r| emit_change(app, r))
  })
  .await
}

/// `playlist_create`: a name that exists already answers that playlist, entries and all (the UI
/// opens it), as the pre-rebuild host did.
pub(crate) fn create_playlist(
  core: &Core,
  args: &PlaylistEditArgs,
  emit: impl FnOnce(&BatchReport),
) -> Result<PlaylistFile, String> {
  let (playlist, report) = core.playlist_create(&args.name).map_err(reason)?;
  emit(&report);
  Ok(playlist)
}

/// Sends a playlist file to the bin; the tracks are untouched.
#[tauri::command]
pub async fn playlist_delete(app: AppHandle, args: PlaylistEditArgs) -> Result<(), String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    let report = core.playlist_delete(&args.name).map_err(reason)?;
    emit_change(app, &report);
    Ok(())
  })
  .await
}

/// The one-time "Make playlists from folders" import: one playlist per first-level folder, never
/// overwriting an existing one. Returns every playlist afterwards.
#[tauri::command]
pub async fn playlists_from_folders(app: AppHandle, library_dir: String) -> Result<Vec<PlaylistFile>, String> {
  with_core(&app, library_dir, |app, core| {
    let (playlists, report) = core.playlists_from_folders().map_err(reason)?;
    emit_change(app, &report);
    // Several playlists in one batch: one that failed fails the command, as a write error always did.
    if let Some(f) = report.failed.first() {
      return Err(f.error.clone());
    }
    Ok(playlists)
  })
  .await
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoveArgs {
  path: String,
  #[serde(alias = "libraryDir")]
  library_dir: String,
  #[serde(alias = "targetFolder")]
  target_folder: String,
}

/// Moves one file into `<library root>/<target folder>/` (same name); playlists follow in the same
/// batch. Returns the moved track.
#[tauri::command]
pub async fn move_track(app: AppHandle, args: MoveArgs) -> Result<Track, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    move_one(core, &args, |r| emit_change(app, r))
  })
  .await
}

/// `move_track`: a taken name in the target folder is refused with "<name> already exists in
/// <folder>", never overwritten.
pub(crate) fn move_one(core: &Core, args: &MoveArgs, emit: impl FnOnce(&BatchReport)) -> Result<Track, String> {
  let abs = track_in_library(core, &args.path)?;
  let (track, report) = core.move_track(&abs, &args.target_folder).map_err(reason)?;
  emit(&report);
  Ok(track)
}

#[derive(Debug, Clone, Deserialize)]
pub struct WriteTagsArgs {
  path: String,
  #[serde(alias = "libraryDir")]
  library_dir: String,
  title: String,
  artist: String,
}

/// Writes title + artist (empty clears the field) through the verified write path and returns the
/// re-read track, so the UI updates without a rescan.
#[tauri::command]
pub async fn write_tags(app: AppHandle, args: WriteTagsArgs) -> Result<Track, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    write_tags_of(core, &args, |r| emit_change(app, r))
  })
  .await
}

/// `write_tags`: the values the file already holds are success, and the file is not rewritten.
pub(crate) fn write_tags_of(
  core: &Core,
  args: &WriteTagsArgs,
  emit: impl FnOnce(&BatchReport),
) -> Result<Track, String> {
  let abs = track_in_library(core, &args.path)?;
  let (track, report) = core
    .write_tags(&abs, args.title.trim(), args.artist.trim())
    .map_err(reason)?;
  emit(&report);
  Ok(track)
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteArgs {
  path: String,
  #[serde(alias = "libraryDir")]
  library_dir: String,
}

/// Sends one file to the bin (desktop recycle bin; on the phone `_Soundhood/.bin`, undoable) and
/// drops it from every playlist in the same batch. Never a hard delete.
#[tauri::command]
pub async fn delete_track(app: AppHandle, args: DeleteArgs) -> Result<(), String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    let abs = track_in_library(core, &args.path)?;
    let report = core.delete_track(&abs).map_err(reason)?;
    emit_change(app, &report);
    Ok(())
  })
  .await
}

/// The last change on this device that can still be undone, in plain words; `null` when none.
#[tauri::command]
pub async fn last_change(app: AppHandle, library_dir: String) -> Result<Option<ChangeSummary>, String> {
  with_core(&app, library_dir, |_, core| core.last_change().map_err(reason)).await
}

/// Undoes the last change on this device. The report lists what was restored and what was refused
/// (a file changed since); the UI shows it as is.
#[tauri::command]
pub async fn undo_last(app: AppHandle, library_dir: String) -> Result<BatchReport, String> {
  with_core(&app, library_dir, |app, core| {
    let report = core.undo_last().map_err(reason)?;
    emit_batch(app, &report);
    Ok(report)
  })
  .await
}

/// Undoes the change with this batch id (the `batch` of the report its own command sent), whether
/// or not newer changes came after it. The report lists what was restored and what was refused (a
/// file or playlist changed since); a change already undone, or not found, is refused as the error.
#[tauri::command]
pub async fn undo_batch(app: AppHandle, library_dir: String, batch: String) -> Result<BatchReport, String> {
  with_core(&app, library_dir, move |app, core| {
    undo_change(core, &batch, |r| emit_batch(app, r))
  })
  .await
}

/// What an Undo says for a batch id the journal does not hold (the core's words carry the raw id).
pub(crate) const NO_RECORD: &str = "no record of this change";

/// `undo_batch`: like `undo_last`, its report is always sent, refusals and all. An unknown id is
/// refused in plain words, never with the id itself.
pub(crate) fn undo_change(core: &Core, batch: &str, emit: impl FnOnce(&BatchReport)) -> Result<BatchReport, String> {
  let report = core.undo_batch(batch).map_err(|e| match e {
    soundhood_core::Error::NotFound(_) => NO_RECORD.to_string(),
    e => reason(e),
  })?;
  emit(&report);
  Ok(report)
}

/// "Rebuild index": drops this device's index and rebuilds it from the files alone.
#[tauri::command]
pub async fn rebuild_index(app: AppHandle, library_dir: String) -> Result<RefreshReport, String> {
  with_core(&app, library_dir, |_, core| core.rebuild_index().map_err(reason)).await
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::state::changed;
  use soundhood_core::fixtures::{generate, FixtureReport, FixtureSpec};
  use std::cell::Cell;
  use std::path::Path;

  /// A small generated library (6 tracks, 2 folders, Favourites + Focus) and its open core.
  fn library() -> (tempfile::TempDir, FixtureReport, Core) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("lib");
    let spec = FixtureSpec {
      tracks: 6,
      folders: 2,
      playlists: 2,
      messy: false,
    };
    let fixture = generate(&root, &spec).unwrap();
    let (core, _) = Core::open(&root, &tmp.path().join("data"), None).unwrap();
    core.scan().unwrap();
    (tmp, fixture, core)
  }

  fn abs(core: &Core, rel: &str) -> String {
    core.lib.root.join(rel).to_string_lossy().into_owned()
  }

  fn playlist_args(core: &Core, name: &str, rels: &[&str]) -> PlaylistEditArgs {
    PlaylistEditArgs {
      library_dir: core.lib.root.to_string_lossy().into_owned(),
      name: name.into(),
      paths: rels.iter().map(|r| abs(core, r)).collect(),
    }
  }

  /// Records whether the command told the UI about a change.
  fn recorder(sent: &Cell<Option<bool>>) -> impl FnOnce(&BatchReport) + '_ {
    move |r| sent.set(Some(changed(r)))
  }

  fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
  }

  #[test]
  fn writing_the_tags_a_file_already_has_is_success_and_writes_nothing() {
    let (_tmp, fixture, core) = library();
    let t = fixture
      .tracks
      .iter()
      .find(|t| !t.title.is_empty() && !t.artist.is_empty())
      .unwrap();
    let file = core.lib.root.join(&t.rel);
    let before = bytes(&file);
    let sent = Cell::new(None);
    let args = WriteTagsArgs {
      path: abs(&core, &t.rel),
      library_dir: core.lib.root.to_string_lossy().into_owned(),
      title: format!(" {} ", t.title),
      artist: t.artist.clone(),
    };
    let track = write_tags_of(&core, &args, recorder(&sent)).expect("same values are not an error");
    assert_eq!(track.title, t.title);
    assert_eq!(bytes(&file), before, "the file was rewritten");
    assert_eq!(
      sent.get(),
      Some(false),
      "a no-change batch must not reach the UI as a change"
    );
    assert!(core.last_change().unwrap().is_none(), "nothing may be journaled");
  }

  #[test]
  fn adding_a_track_already_in_the_playlist_is_success() {
    let (_tmp, fixture, core) = library();
    let fav = fixture.playlists.iter().find(|p| p.name == "Favourites").unwrap();
    let member = fav.entries[0].clone();
    let m3u8 = core.lib.root.join("_Playlists/Favourites.m3u8");
    let before = bytes(&m3u8);
    let sent = Cell::new(None);
    let got = add_to_playlist(&core, &playlist_args(&core, "Favourites", &[&member]), recorder(&sent))
      .expect("already a member is not an error");
    assert_eq!(got.entries, fav.entries);
    assert_eq!(bytes(&m3u8), before);
    assert_eq!(sent.get(), Some(false));
  }

  #[test]
  fn removing_a_track_that_is_not_in_the_playlist_is_success() {
    let (_tmp, fixture, core) = library();
    let fav = fixture.playlists.iter().find(|p| p.name == "Favourites").unwrap();
    let outsider = fixture
      .tracks
      .iter()
      .find(|t| !fav.entries.iter().any(|e| e.eq_ignore_ascii_case(&t.rel)))
      .expect("a track outside Favourites");
    let m3u8 = core.lib.root.join("_Playlists/Favourites.m3u8");
    let before = bytes(&m3u8);
    let sent = Cell::new(None);
    let got = remove_from_playlist(
      &core,
      &playlist_args(&core, "Favourites", &[&outsider.rel]),
      recorder(&sent),
    )
    .expect("not a member is not an error");
    assert_eq!(got.entries, fav.entries);
    assert_eq!(bytes(&m3u8), before);
    assert_eq!(sent.get(), Some(false));
  }

  #[test]
  fn creating_a_playlist_that_exists_returns_it_untouched() {
    let (_tmp, fixture, core) = library();
    let fav = fixture.playlists.iter().find(|p| p.name == "Favourites").unwrap();
    assert!(!fav.entries.is_empty());
    let m3u8 = core.lib.root.join("_Playlists/Favourites.m3u8");
    let before = bytes(&m3u8);
    let sent = Cell::new(None);
    let got = create_playlist(&core, &playlist_args(&core, "Favourites", &[]), recorder(&sent))
      .expect("an existing name is not an error");
    assert_eq!(got.name, "Favourites");
    assert_eq!(got.entries, fav.entries, "the existing playlist, entries and all");
    assert_eq!(bytes(&m3u8), before);
    assert_eq!(sent.get(), Some(false));
  }

  #[test]
  fn a_real_change_is_sent_to_the_ui() {
    let (_tmp, fixture, core) = library();
    let fav = fixture.playlists.iter().find(|p| p.name == "Favourites").unwrap();
    let outsider = fixture
      .tracks
      .iter()
      .find(|t| !fav.entries.iter().any(|e| e.eq_ignore_ascii_case(&t.rel)))
      .unwrap();
    let sent = Cell::new(None);
    let got = add_to_playlist(
      &core,
      &playlist_args(&core, "Favourites", &[&outsider.rel]),
      recorder(&sent),
    )
    .unwrap();
    assert_eq!(got.entries.len(), fav.entries.len() + 1);
    assert_eq!(sent.get(), Some(true));

    let sent = Cell::new(None);
    create_playlist(&core, &playlist_args(&core, "Brand New", &[]), recorder(&sent)).unwrap();
    assert_eq!(sent.get(), Some(true));
  }

  #[test]
  fn undo_batch_undoes_that_change_and_leaves_a_newer_one() {
    let (_tmp, fixture, core) = library();
    let t = fixture
      .tracks
      .iter()
      .find(|t| !t.title.is_empty() && !t.artist.is_empty())
      .unwrap();
    let file = core.lib.root.join(&t.rel);
    let title_now = |core: &Core| {
      let tracks = core.scan().unwrap();
      let track = tracks.iter().find(|x| Path::new(&x.path) == file.as_path()).unwrap();
      track.title.clone()
    };
    // The tag edit's own report carries its batch id (the UI keeps it from the core:batch event).
    let edit = std::cell::RefCell::new(None);
    let args = WriteTagsArgs {
      path: abs(&core, &t.rel),
      library_dir: core.lib.root.to_string_lossy().into_owned(),
      title: "Another Title".into(),
      artist: t.artist.clone(),
    };
    write_tags_of(&core, &args, |r| *edit.borrow_mut() = Some(r.batch.clone())).unwrap();
    let edit = edit.into_inner().expect("the tag edit sent its report");
    assert_eq!(title_now(&core), "Another Title");
    // A newer change on top: a playlist add.
    let fav = fixture.playlists.iter().find(|p| p.name == "Favourites").unwrap();
    let outsider = fixture
      .tracks
      .iter()
      .find(|t| !fav.entries.iter().any(|e| e.eq_ignore_ascii_case(&t.rel)))
      .unwrap();
    let m3u8 = core.lib.root.join("_Playlists/Favourites.m3u8");
    add_to_playlist(&core, &playlist_args(&core, "Favourites", &[&outsider.rel]), |_| {}).unwrap();
    let added = bytes(&m3u8);
    let newest = core.last_change().unwrap().unwrap().batch;
    assert_ne!(newest, edit);

    let sent = Cell::new(None);
    let report = undo_change(&core, &edit, recorder(&sent)).expect("an older change can be undone by its id");
    assert_eq!(sent.get(), Some(true), "the undo's report goes to the UI");
    assert_eq!(report.applied.len(), 1);
    assert!(report.skipped.is_empty() && report.failed.is_empty());
    assert_eq!(title_now(&core), t.title, "the tags are back");
    assert_eq!(bytes(&m3u8), added, "the newer change is left as it is");
    assert_eq!(core.last_change().unwrap().unwrap().batch, newest);

    // Twice is refused with a plain reason, and so is an id the journal does not know.
    let sent = Cell::new(None);
    let err = undo_change(&core, &edit, recorder(&sent)).unwrap_err();
    assert_eq!(err, "this change was undone already");
    assert_eq!(sent.get(), None);
    // An id shaped like a real one (32 hex digits) that the journal does not hold: plain words only.
    let unknown = "0123456789abcdef0123456789abcdef";
    let err = undo_change(&core, unknown, |_| panic!("nothing to send")).unwrap_err();
    assert_eq!(err, NO_RECORD);
    assert!(!err.contains(unknown));
    assert_eq!(bytes(&m3u8), added);
  }

  #[test]
  #[allow(clippy::permissions_set_readonly_false)] // only to let the temp dir clean up
  fn a_read_only_file_is_refused_with_the_plain_reason() {
    let (_tmp, fixture, core) = library();
    let t = &fixture.tracks[0];
    let file = core.lib.root.join(&t.rel);
    let mut perms = std::fs::metadata(&file).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&file, perms).unwrap();
    let args = WriteTagsArgs {
      path: abs(&core, &t.rel),
      library_dir: core.lib.root.to_string_lossy().into_owned(),
      title: "Another Title".into(),
      artist: t.artist.clone(),
    };
    let sent = Cell::new(None);
    let err = write_tags_of(&core, &args, recorder(&sent)).unwrap_err();
    assert_eq!(err, "read-only file");
    assert_eq!(sent.get(), None);
    let mut perms = std::fs::metadata(&file).unwrap().permissions();
    perms.set_readonly(false);
    std::fs::set_permissions(&file, perms).unwrap();
  }

  #[test]
  fn a_taken_name_is_refused_with_the_plain_reason() {
    let (_tmp, fixture, core) = library();
    // A root-level track, and a file of the same name already in a folder.
    let t = fixture.tracks.iter().find(|t| !t.rel.contains('/')).unwrap();
    let folder = fixture
      .tracks
      .iter()
      .find_map(|t| t.rel.split_once('/').map(|(f, _)| f.to_string()))
      .unwrap();
    std::fs::copy(core.lib.root.join(&t.rel), core.lib.root.join(&folder).join(&t.rel)).unwrap();
    let args = MoveArgs {
      path: abs(&core, &t.rel),
      library_dir: core.lib.root.to_string_lossy().into_owned(),
      target_folder: folder.clone(),
    };
    let err = move_one(&core, &args, |_| panic!("a refused op is not sent as a change")).unwrap_err();
    assert_eq!(err, format!("{} already exists in {folder}", t.rel));
  }
}
