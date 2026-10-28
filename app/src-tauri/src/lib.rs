//! The Tauri host: thin commands over `soundhood_core::api::Core`, plus what only a host can do
//! (app folders, events, spawning the desktop yt-dlp). Every write to a user file — audio files and
//! `_Playlists/**/*.m3u8` — goes through the core's one write path; nothing here writes one itself.
//! The command names and argument shapes are the binding "Host IPC" contract in `core/CONTRACT.md`.

mod dev;
mod download;
mod files;
mod library;
mod paths;
#[cfg(desktop)]
mod sidecar;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_soundhood_ytdl::init())
    .manage(state::Cores::default())
    .invoke_handler(tauri::generate_handler![
      library::scan_music_folder,
      download::ytdlp_download_audio,
      library::move_track,
      library::delete_track,
      library::write_tags,
      library::list_playlists,
      library::playlist_add,
      library::playlist_remove,
      library::playlist_create,
      library::playlist_delete,
      library::playlists_from_folders,
      library::last_change,
      library::undo_last,
      library::rebuild_index,
      files::platform,
      files::read_file_bytes,
      files::cover_art,
      files::queue_read,
      files::queue_write,
      dev::dev_fixture_root,
      dev::self_test,
      dev::diagnostics
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
