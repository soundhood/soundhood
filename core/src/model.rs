//! Shared value types. Only the lead changes these (they are part of the core's public surface).

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// A path relative to the library root: the exact on-disk characters, forward slashes, no leading
/// slash, no `.`/`..` segments, never empty. NOT normalised: NTFS treats NFC and NFD names as
/// different files, so an NFD name must stay NFD or it no longer opens. Comparisons go through
/// [`RelPath::key`] (NFC + lower-case).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RelPath(String);

impl RelPath {
  /// Normalises `\` to `/`, strips leading/trailing slashes, and rejects empty, `.`/`..` segments
  /// and absolute paths (drive letters, UNC). Keeps the characters otherwise as given (no NFC).
  pub fn new(s: &str) -> Result<RelPath> {
    let s = s.trim_start_matches('\u{feff}').replace('\\', "/");
    if s.starts_with("//") || s.as_bytes().get(1) == Some(&b':') {
      return Err(Error::InvalidPath(format!("absolute path is not root-relative: {s}")));
    }
    let s = s.trim_matches('/');
    if s.is_empty() {
      return Err(Error::InvalidPath("empty path".into()));
    }
    let mut parts = Vec::new();
    for seg in s.split('/') {
      if seg.is_empty() {
        continue; // collapse "a//b"
      }
      if seg == "." || seg == ".." {
        return Err(Error::InvalidPath(format!("'{seg}' segment in {s}")));
      }
      parts.push(seg);
    }
    Ok(RelPath(parts.join("/")))
  }

  /// The root-relative form of `abs`. The prefix test is case-insensitive on Windows (the file
  /// system is), exact elsewhere.
  pub fn from_abs(root: &Path, abs: &Path) -> Result<RelPath> {
    if let Ok(rel) = abs.strip_prefix(root) {
      return Self::from_components(rel);
    }
    if cfg!(windows) {
      let (r, a) = (
        root.to_string_lossy().replace('\\', "/"),
        abs.to_string_lossy().replace('\\', "/"),
      );
      let r = r.trim_end_matches('/');
      if a.len() > r.len() && a[..r.len()].eq_ignore_ascii_case(r) && a.as_bytes()[r.len()] == b'/' {
        return RelPath::new(&a[r.len() + 1..]);
      }
    }
    Err(Error::InvalidPath(format!(
      "{} is not inside {}",
      abs.display(),
      root.display()
    )))
  }

  fn from_components(rel: &Path) -> Result<RelPath> {
    let mut parts = Vec::new();
    for c in rel.components() {
      match c {
        Component::Normal(s) => parts.push(s.to_string_lossy().to_string()),
        Component::CurDir => {}
        _ => return Err(Error::InvalidPath(rel.display().to_string())),
      }
    }
    RelPath::new(&parts.join("/"))
  }

  pub fn to_abs(&self, root: &Path) -> PathBuf {
    let mut p = root.to_path_buf();
    for seg in self.0.split('/') {
      p.push(seg);
    }
    p
  }

  pub fn as_str(&self) -> &str {
    &self.0
  }

  /// Last segment, e.g. `Song - Artist.m4a`.
  pub fn file_name(&self) -> &str {
    self.0.rsplit('/').next().unwrap_or(&self.0)
  }

  /// The containing folder, or `None` for a file directly in the root.
  pub fn parent(&self) -> Option<RelPath> {
    self.0.rsplit_once('/').map(|(p, _)| RelPath(p.to_string()))
  }

  /// First path segment when the file sits in a sub-folder (the legacy "playlist" = first-level folder).
  pub fn top_folder(&self) -> Option<&str> {
    self.0.split_once('/').map(|(first, _)| first)
  }

  pub fn join(&self, name: &str) -> Result<RelPath> {
    RelPath::new(&format!("{}/{}", self.0, name))
  }

  /// Comparison key: NFC + lower-cased. Windows and the Proton web UI disagree on case, and
  /// macOS/Android sources may hand over NFD, so membership and collision checks compare keys,
  /// never raw strings.
  pub fn key(&self) -> String {
    self.0.nfc().collect::<String>().to_lowercase()
  }

  /// True for anything under `_Soundhood/` (bookkeeping, the Android bin) or `_Playlists/`.
  pub fn is_app_owned(&self) -> bool {
    let top = self.top_folder().unwrap_or("");
    top.eq_ignore_ascii_case("_Soundhood") || top.eq_ignore_ascii_case("_Playlists")
  }
}

impl TryFrom<String> for RelPath {
  type Error = Error;
  fn try_from(s: String) -> Result<Self> {
    RelPath::new(&s)
  }
}

impl From<RelPath> for String {
  fn from(r: RelPath) -> String {
    r.0
  }
}

impl std::fmt::Display for RelPath {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.0)
  }
}

/// Stable per-install identifier. Names this device's files under `_Soundhood/` (journal,
/// queue, plays), so two devices never write the same file.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(pub String);

impl std::fmt::Display for DeviceId {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.0)
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
  Desktop,
  Android,
}

impl Platform {
  pub fn current() -> Platform {
    if cfg!(target_os = "android") {
      Platform::Android
    } else {
      Platform::Desktop
    }
  }
}

/// Everything a core call needs to know about where it is operating.
#[derive(Clone, Debug)]
pub struct Library {
  /// Absolute library root (the folder the user picked).
  pub root: PathBuf,
  pub device: DeviceId,
  pub platform: Platform,
}

impl Library {
  pub fn abs(&self, rel: &RelPath) -> PathBuf {
    rel.to_abs(&self.root)
  }
  pub fn rel(&self, abs: &Path) -> Result<RelPath> {
    RelPath::from_abs(&self.root, abs)
  }
}

/// The track shape the current UI consumes (`scan_music_folder`, `move_track`, `write_tags`).
/// Unchanged in Phase 0: `path` is absolute, `name` the file name with extension, `playlist` the
/// first-level folder or `"(root)"`, `duration_secs` snake_case on the wire.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Track {
  pub path: String,
  pub name: String,
  pub playlist: String,
  pub title: String,
  pub artist: String,
  pub duration_secs: u64,
}

/// The playlist shape the current UI consumes: entries are root-relative, forward slashes, in order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaylistFile {
  pub name: String,
  pub entries: Vec<String>,
}

/// Tag fields the write path can change. `None` = leave untouched; `Some("")` = clear the field.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagSet {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub artist: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub album: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub album_artist: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub genre: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub year: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub comment: Option<String>,
}

impl TagSet {
  pub fn is_empty(&self) -> bool {
    *self == TagSet::default()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn relpath_normalises() {
    assert_eq!(RelPath::new("\\ytmp3\\A - B.m4a").unwrap().as_str(), "ytmp3/A - B.m4a");
    assert_eq!(RelPath::new("a//b/").unwrap().as_str(), "a/b");
    assert!(RelPath::new("../x").is_err());
    assert!(RelPath::new("C:/Music/x.mp3").is_err());
    assert!(RelPath::new("").is_err());
    // NFD "é" (e + U+0301) is kept as-is: the on-disk name is NFD and must still open.
    let nfd = RelPath::new("Beyonce\u{301}.mp3").unwrap();
    assert_eq!(nfd.as_str(), "Beyonce\u{301}.mp3");
    // ...but compares equal to the NFC spelling through key().
    assert_eq!(nfd.key(), RelPath::new("BEYONC\u{c9}.MP3").unwrap().key());
  }

  #[test]
  fn relpath_from_abs() {
    let root = Path::new("/lib");
    assert_eq!(
      RelPath::from_abs(root, Path::new("/lib/a/b.mp3")).unwrap().as_str(),
      "a/b.mp3"
    );
    assert!(RelPath::from_abs(root, Path::new("/other/b.mp3")).is_err());
  }

  #[test]
  fn relpath_parts() {
    let r = RelPath::new("Chill/Song - Artist.m4a").unwrap();
    assert_eq!(r.file_name(), "Song - Artist.m4a");
    assert_eq!(r.parent().unwrap().as_str(), "Chill");
    assert_eq!(r.top_folder(), Some("Chill"));
    assert!(RelPath::new("x.mp3").unwrap().parent().is_none());
    assert!(RelPath::new("_Soundhood/journal/x.jsonl").unwrap().is_app_owned());
  }
}
