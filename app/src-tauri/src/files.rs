//! Read-only file access for the UI, the download queue file and the platform name.
//!
//! Tauri runs a synchronous command on the main thread, which on the phone is the UI thread, so
//! every command here that touches the disk is `async` and does the work in `spawn_blocking`.

use std::path::Path;

/// Runs blocking file work on a worker thread, never the main thread.
async fn off_main<T, F>(f: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce() -> Result<T, String> + Send + 'static,
{
  tauri::async_runtime::spawn_blocking(f)
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

/// Whole file as bytes, for the player on platforms where the direct file URL is refused by the
/// webview (Android). Returned as a raw IPC response, not JSON.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
  off_main(move || {
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
  })
  .await
}

/// Embedded cover picture of a track (front cover preferred, else the first picture), raw bytes;
/// empty when there is none. The UI sniffs JPEG/PNG from the first bytes.
#[tauri::command]
pub async fn cover_art(path: String) -> Result<tauri::ipc::Response, String> {
  off_main(move || {
    let art = soundhood_core::tags::cover_art(Path::new(&path)).map_err(|e| format!("{}: {}", path, e.reason()))?;
    Ok(tauri::ipc::Response::new(art.unwrap_or_default()))
  })
  .await
}

/// The download queue lives as a small JSON file inside the library (`_Soundhood/download-queue.json`),
/// so whatever carries the Music folder between phone and PC carries the queue too. Tier 3
/// bookkeeping: write-then-rename, no journal; format and location unchanged in Phase 0.
const QUEUE_REL: &str = "_Soundhood/download-queue.json";

/// The queue file's text, or "" when there is none yet.
#[tauri::command]
pub async fn queue_read(library_dir: String) -> Result<String, String> {
  off_main(move || read_queue(Path::new(&library_dir))).await
}

/// Replaces the queue file (the UI has already union-merged it).
#[tauri::command]
pub async fn queue_write(library_dir: String, json: String) -> Result<(), String> {
  off_main(move || write_queue(Path::new(&library_dir), &json)).await
}

fn read_queue(library_dir: &Path) -> Result<String, String> {
  let p = library_dir.join(QUEUE_REL);
  if !p.exists() {
    return Ok(String::new());
  }
  std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

fn write_queue(library_dir: &Path, json: &str) -> Result<(), String> {
  let p = library_dir.join(QUEUE_REL);
  if let Some(parent) = p.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
  }
  let tmp = p.with_extension("json.tmp");
  std::fs::write(&tmp, json).map_err(|e| format!("{}: {}", tmp.display(), e))?;
  std::fs::rename(&tmp, &p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// "windows" | "linux" | "macos" | "android" | "ios": lets the UI adapt (paths, layout, what is
/// available).
#[tauri::command]
pub fn platform() -> String {
  std::env::consts::OS.to_string()
}

#[cfg(test)]
mod tests {
  use super::*;
  use tauri::async_runtime::block_on;

  #[test]
  fn the_queue_round_trips_through_the_async_commands() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_string_lossy().into_owned();
    assert_eq!(block_on(queue_read(dir.clone())), Ok(String::new()));
    block_on(queue_write(dir.clone(), r#"{"items":[]}"#.into())).unwrap();
    assert_eq!(block_on(queue_read(dir.clone())), Ok(r#"{"items":[]}"#.to_string()));
    // Write-then-rename: no temp file is left next to it.
    assert!(!tmp.path().join("_Soundhood/download-queue.json.tmp").exists());
  }

  #[test]
  fn file_bytes_and_cover_art_answer_off_the_main_thread() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("a.bin");
    std::fs::write(&file, b"abc").unwrap();
    let path = file.to_string_lossy().into_owned();
    assert!(block_on(read_file_bytes(path.clone())).is_ok());
    assert!(block_on(read_file_bytes(
      tmp.path().join("missing").to_string_lossy().into_owned()
    ))
    .is_err());
    // Not an audio file: an error, not a panic or a hang.
    assert!(block_on(cover_art(path)).is_err());
  }
}
