// register_listener / remove_listener: the webview subscribes to the plugin's "progress" events through them
const COMMANDS: &[&str] = &["download", "cancel", "ytdlp_version", "ytdlp_update", "netcheck", "register_listener", "remove_listener"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
