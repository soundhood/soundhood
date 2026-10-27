//! Read-only file access for the UI, the download queue file and the platform name.

use std::path::Path;

/// Whole file as bytes, for the player on platforms where the direct file URL is refused by the
/// webview (Android). Returned as a raw IPC response, not JSON.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
  let bytes = std::fs::read(&path).map_err(|e| format!("{}: {}", path, e))?;
  Ok(tauri::ipc::Response::new(bytes))
}

/// Embedded cover picture of a track (front cover preferred, else the first picture), raw bytes;
/// empty when there is none. The UI sniffs JPEG/PNG from the first bytes.
#[tauri::command]
pub fn cover_art(path: String) -> Result<tauri::ipc::Response, String> {
  let art = soundhood_core::tags::cover_art(Path::new(&path)).map_err(|e| format!("{}: {}", path, e))?;
  Ok(tauri::ipc::Response::new(art.unwrap_or_default()))
}

/// The download queue lives as a small JSON file inside the library (`_Soundhood/download-queue.json`),
/// so whatever carries the Music folder between phone and PC carries the queue too. Tier 3
/// bookkeeping: write-then-rename, no journal; format and location unchanged in Phase 0.
const QUEUE_REL: &str = "_Soundhood/download-queue.json";

/// The queue file's text, or "" when there is none yet.
#[tauri::command]
pub fn queue_read(library_dir: String) -> Result<String, String> {
  let p = Path::new(&library_dir).join(QUEUE_REL);
  if !p.exists() {
    return Ok(String::new());
  }
  std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// Replaces the queue file (the UI has already union-merged it).
#[tauri::command]
pub fn queue_write(library_dir: String, json: String) -> Result<(), String> {
  let p = Path::new(&library_dir).join(QUEUE_REL);
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
