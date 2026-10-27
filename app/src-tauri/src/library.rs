//! Library commands: the UI's scan, playlist and track edits, now thin calls into
//! `soundhood_core::api::Core`. Every mutating command goes through the core's one write path
//! (journal, verify, bin) and emits `core:batch`; names and argument shapes are unchanged.

use crate::state::{emit_batch, is_library_dir, single_op, track_in_library, with_core};
use serde::Deserialize;
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
  with_core(&app, dir, |_, core| core.scan().map_err(|e| e.to_string())).await
}

/// Every playlist file in `_Playlists/`, sorted by name; none when the folder is missing.
#[tauri::command]
pub async fn list_playlists(app: AppHandle, library_dir: String) -> Result<Vec<PlaylistFile>, String> {
  // The pre-rebuild host answered an empty list for a missing folder; keep that.
  if !is_library_dir(&library_dir) {
    return Ok(Vec::new());
  }
  with_core(&app, library_dir, |_, core| core.playlists().map_err(|e| e.to_string())).await
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
fn paths_in_library(core: &soundhood_core::api::Core, paths: &[String]) -> Vec<PathBuf> {
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
    let paths = paths_in_library(core, &args.paths);
    let (playlist, report) = core.playlist_add(&args.name, &paths).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)?;
    Ok(playlist)
  })
  .await
}

/// Removes tracks from a playlist; the playlist file stays.
#[tauri::command]
pub async fn playlist_remove(app: AppHandle, args: PlaylistEditArgs) -> Result<PlaylistFile, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    let paths = paths_in_library(core, &args.paths);
    let (playlist, report) = core.playlist_remove(&args.name, &paths).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)?;
    Ok(playlist)
  })
  .await
}

/// Creates an empty playlist, or returns the existing one untouched.
#[tauri::command]
pub async fn playlist_create(app: AppHandle, args: PlaylistEditArgs) -> Result<PlaylistFile, String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    let (playlist, report) = core.playlist_create(&args.name).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)?;
    Ok(playlist)
  })
  .await
}

/// Sends a playlist file to the bin; the tracks are untouched.
#[tauri::command]
pub async fn playlist_delete(app: AppHandle, args: PlaylistEditArgs) -> Result<(), String> {
  with_core(&app, args.library_dir.clone(), move |app, core| {
    let report = core.playlist_delete(&args.name).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)
  })
  .await
}

/// The one-time "Make playlists from folders" import: one playlist per first-level folder, never
/// overwriting an existing one. Returns every playlist afterwards.
#[tauri::command]
pub async fn playlists_from_folders(app: AppHandle, library_dir: String) -> Result<Vec<PlaylistFile>, String> {
  with_core(&app, library_dir, |app, core| {
    let (playlists, report) = core.playlists_from_folders().map_err(|e| e.to_string())?;
    emit_batch(app, &report);
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
    let abs = track_in_library(core, &args.path)?;
    let (track, report) = core.move_track(&abs, &args.target_folder).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)?;
    Ok(track)
  })
  .await
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
    let abs = track_in_library(core, &args.path)?;
    let (track, report) = core
      .write_tags(&abs, args.title.trim(), args.artist.trim())
      .map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)?;
    Ok(track)
  })
  .await
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
    let report = core.delete_track(&abs).map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    single_op(&report)
  })
  .await
}

/// The last change on this device that can still be undone, in plain words; `null` when none.
#[tauri::command]
pub async fn last_change(app: AppHandle, library_dir: String) -> Result<Option<ChangeSummary>, String> {
  with_core(&app, library_dir, |_, core| {
    core.last_change().map_err(|e| e.to_string())
  })
  .await
}

/// Undoes the last change on this device. The report lists what was restored and what was refused
/// (a file changed since); the UI shows it as is.
#[tauri::command]
pub async fn undo_last(app: AppHandle, library_dir: String) -> Result<BatchReport, String> {
  with_core(&app, library_dir, |app, core| {
    let report = core.undo_last().map_err(|e| e.to_string())?;
    emit_batch(app, &report);
    Ok(report)
  })
  .await
}

/// "Rebuild index": drops this device's index and rebuilds it from the files alone.
#[tauri::command]
pub async fn rebuild_index(app: AppHandle, library_dir: String) -> Result<RefreshReport, String> {
  with_core(&app, library_dir, |_, core| {
    core.rebuild_index().map_err(|e| e.to_string())
  })
  .await
}
