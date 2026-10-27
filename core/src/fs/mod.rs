//! Library root handling: scanning, stamps, hashes, temp files, atomic replace, bins.
//! Write helpers are `pub(crate)`: only `ingest::tagwrite` calls them.

/// App bookkeeping inside the root (synced, one file per device). Never scanned as music.
pub const APP_DIR: &str = "_Soundhood";
/// Playlist files inside the root; the app is their sole writer.
pub const PLAYLISTS_DIR: &str = "_Playlists";
/// Prefix of the hidden temp files the write path creates next to the file it replaces.
pub const TMP_PREFIX: &str = ".soundhood-tmp-";

/// Audio extensions the library recognises (same list as the pre-rebuild host).
pub fn is_audio_file(name: &str) -> bool {
  let Some((_, ext)) = name.rsplit_once('.') else {
    return false;
  };
  matches!(
    ext.to_ascii_lowercase().as_str(),
    "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "wma" | "aiff" | "alac"
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn audio_extensions() {
    assert!(is_audio_file("Song - Artist.M4A"));
    assert!(is_audio_file("a.b.flac"));
    assert!(!is_audio_file("cover.jpg"));
    assert!(!is_audio_file("noext"));
  }
}
