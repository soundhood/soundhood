//! soundhood-core: the Rust core shared verbatim by the desktop and Android hosts.
//!
//! No Tauri, no UI, no async runtime of its own. Every write to a user file (audio files and
//! `_Playlists/**/*.m3u8`) goes through [`ingest::tagwrite`]; the write helpers in `fs`, `tags`
//! and `playlist` are `pub(crate)` so nothing outside the core can reach them.
//! See `core/CONTRACT.md` for the module contracts.

pub mod api;
pub mod error;
pub mod fixtures;
pub mod fs;
pub mod index;
pub mod ingest;
pub mod manifest;
pub mod model;
pub mod playlist;
#[cfg(all(feature = "sidecars", not(target_os = "android")))]
pub mod sidecars;
pub mod sync;
pub mod tags;
pub mod ytdlp;

pub use error::{Error, Result};
pub use model::{DeviceId, Library, Platform, PlaylistFile, RelPath, TagSet, Track};
