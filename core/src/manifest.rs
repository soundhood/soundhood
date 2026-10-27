//! Library manifest (audio files + `_Playlists/**`, blake3) and its diff.
//! Zone: tools. Contract: core/CONTRACT.md.
//!
//! The manifest is the before/after proof that a session wrote nothing it should not have
//! (build brief 5.2 acceptance (a)). Scope: every audio file anywhere under the root plus every
//! file under `_Playlists/`; `_Soundhood/` (journal, plays, queue, snapshots: they change in any
//! session) and the write path's `.soundhood-tmp-*` files are excluded. It has its own walk, not
//! `fs::scan`, so a change to what the index scans cannot shrink what the manifest proves.

use crate::error::{Error, Result};
use crate::fs::{is_audio_file, APP_DIR, PLAYLISTS_DIR, TMP_PREFIX};
use crate::model::RelPath;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// A content snapshot of a library root. `files` is sorted by `rel` (byte order).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
  /// The root folder's own name (never its full path).
  pub root_name: String,
  pub files: Vec<ManifestEntry>,
}

/// One file: where it sits, how big it is, and the blake3 hex of its bytes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ManifestEntry {
  pub rel: RelPath,
  pub size: u64,
  pub blake3: String,
}

/// Walks `root` and hashes every file in scope (in parallel). Symlinks are not followed; any
/// unreadable file fails the whole build, because a manifest with holes proves nothing.
pub fn build(root: &Path) -> Result<Manifest> {
  if !root.is_dir() {
    return Err(Error::NotFound(format!("library root {}", root.display())));
  }
  let mut found: Vec<(RelPath, PathBuf)> = Vec::new();
  let walker = walkdir::WalkDir::new(root)
    .follow_links(false)
    .into_iter()
    .filter_entry(|e| !(e.depth() == 1 && e.file_type().is_dir() && e.file_name().eq_ignore_ascii_case(APP_DIR)));
  for entry in walker {
    let entry = entry.map_err(|e| Error::Other(format!("manifest walk: {e}")))?;
    if !entry.file_type().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with(TMP_PREFIX) {
      continue;
    }
    let rel = RelPath::from_abs(root, entry.path())?;
    let in_playlists =
      rel.parent().is_some() && rel.top_folder().is_some_and(|t| t.eq_ignore_ascii_case(PLAYLISTS_DIR));
    if in_playlists || is_audio_file(&name) {
      found.push((rel, entry.into_path()));
    }
  }
  // NFD/NFC twins share a rel; the raw path keeps their order stable between runs.
  found.sort();
  let files = found
    .par_iter()
    .map(|(rel, abs)| {
      let (size, blake3) = hash_file(abs)?;
      Ok(ManifestEntry {
        rel: rel.clone(),
        size,
        blake3,
      })
    })
    .collect::<Result<Vec<_>>>()?;
  let root_name = root
    .file_name()
    .map(|n| n.to_string_lossy().to_string())
    .unwrap_or_default();
  Ok(Manifest { root_name, files })
}

/// Streams a file through blake3; returns (bytes read, hex digest).
fn hash_file(abs: &Path) -> Result<(u64, String)> {
  let mut file = File::open(abs).map_err(|e| Error::Other(format!("{}: {e}", abs.display())))?;
  let mut hasher = blake3::Hasher::new();
  let mut buf = vec![0u8; 256 * 1024];
  let mut size = 0u64;
  loop {
    let n = file
      .read(&mut buf)
      .map_err(|e| Error::Other(format!("{}: {e}", abs.display())))?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
    size += n as u64;
  }
  Ok((size, hasher.finalize().to_hex().to_string()))
}

/// What differs from `a` to `b`, one line per path in path order: `changed: <rel>` (size or hash),
/// `added: <rel>` (only in `b`), `removed: <rel>` (only in `a`). Empty = identical. Paths compare
/// exactly, so a case-only rename shows as removed + added.
pub fn diff(a: &Manifest, b: &Manifest) -> Vec<String> {
  fn by_rel(m: &Manifest) -> BTreeMap<&str, Vec<(u64, &str)>> {
    let mut map: BTreeMap<&str, Vec<(u64, &str)>> = BTreeMap::new();
    for f in &m.files {
      map.entry(f.rel.as_str()).or_default().push((f.size, f.blake3.as_str()));
    }
    map
  }
  let (am, bm) = (by_rel(a), by_rel(b));
  let mut keys: Vec<&str> = am.keys().chain(bm.keys()).copied().collect();
  keys.sort_unstable();
  keys.dedup();
  keys
    .into_iter()
    .filter_map(|k| match (am.get(k), bm.get(k)) {
      (Some(x), Some(y)) if x != y => Some(format!("changed: {k}")),
      (Some(_), None) => Some(format!("removed: {k}")),
      (None, Some(_)) => Some(format!("added: {k}")),
      _ => None,
    })
    .collect()
}

/// Reads a manifest JSON file.
pub fn read(path: &Path) -> Result<Manifest> {
  let text = std::fs::read_to_string(path).map_err(|e| Error::Other(format!("{}: {e}", path.display())))?;
  Ok(serde_json::from_str(&text)?)
}

/// Writes a manifest as pretty JSON through a temp file in the same folder, then renames it into
/// place, so a reader never sees half a manifest.
pub fn write(path: &Path, m: &Manifest) -> Result<()> {
  let dir = match path.parent() {
    Some(d) if !d.as_os_str().is_empty() => d.to_path_buf(),
    _ => PathBuf::from("."),
  };
  let tmp = dir.join(format!("{TMP_PREFIX}manifest-{}.json", std::process::id()));
  let mut text = serde_json::to_string_pretty(m)?;
  text.push('\n');
  let result = (|| -> Result<()> {
    let mut f = File::create(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    Ok(())
  })();
  if result.is_err() {
    let _ = std::fs::remove_file(&tmp);
  }
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  fn put(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
  }

  fn tree() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    put(r, "Song - Artist.m4a", b"root audio");
    put(r, "Chill/B - X.mp3", b"bee");
    put(r, "Chill/a - y.FLAC", b"a");
    put(r, "Chill/cover.jpg", b"not audio");
    put(r, "Rock/Sub/deep.opus", b"deep");
    put(r, "_Playlists/Mix.m3u8", b"#EXTM3U\nChill/B - X.mp3\n");
    put(r, "_Playlists/notes.txt", b"anything under _Playlists counts");
    put(r, "_Playlists/.soundhood-tmp-job1.m3u8", b"temp");
    put(r, "_Soundhood/journal/dev/2026-10.jsonl", b"{}");
    put(r, "_Soundhood/.bin/2026-10/x.mp3", b"binned");
    put(r, "_soundhood/x.mp3", b"case-insensitive app dir");
    put(r, "Chill/.soundhood-tmp-job2.mp3", b"temp");
    put(
      r,
      "Rock/_Soundhood/nested.mp3",
      b"only the top-level app dir is excluded",
    );
    t
  }

  fn rels(m: &Manifest) -> Vec<&str> {
    m.files.iter().map(|f| f.rel.as_str()).collect()
  }

  #[test]
  fn scope_is_audio_plus_playlists_minus_app_dir_and_temps() {
    let t = tree();
    let m = build(t.path()).unwrap();
    // On a case-sensitive file system `_soundhood` and `_Soundhood` are two folders; both are
    // excluded. On Windows they are the same folder.
    assert_eq!(
      rels(&m),
      [
        "Chill/B - X.mp3",
        "Chill/a - y.FLAC",
        "Rock/Sub/deep.opus",
        "Rock/_Soundhood/nested.mp3",
        "Song - Artist.m4a",
        "_Playlists/Mix.m3u8",
        "_Playlists/notes.txt",
      ]
    );
    let bee = m.files.iter().find(|f| f.rel.as_str() == "Chill/B - X.mp3").unwrap();
    assert_eq!(bee.size, 3);
    assert_eq!(bee.blake3, blake3::hash(b"bee").to_hex().to_string());
    assert_eq!(m.root_name, t.path().file_name().unwrap().to_string_lossy());
  }

  #[test]
  fn building_twice_is_identical() {
    let t = tree();
    let (a, b) = (build(t.path()).unwrap(), build(t.path()).unwrap());
    assert_eq!(a, b);
    assert!(diff(&a, &b).is_empty());
  }

  #[test]
  fn diff_names_changed_added_and_removed_in_path_order() {
    let t = tree();
    let before = build(t.path()).unwrap();
    put(t.path(), "Chill/B - X.mp3", b"bee!"); // content and size
    put(t.path(), "Chill/a - y.FLAC", b"b"); // same size, other bytes
    std::fs::remove_file(t.path().join("Rock/Sub/deep.opus")).unwrap();
    put(t.path(), "New/one.m4a", b"new");
    put(t.path(), "_Soundhood/plays.jsonl", b"never in scope");
    let after = build(t.path()).unwrap();
    assert_eq!(
      diff(&before, &after),
      [
        "changed: Chill/B - X.mp3",
        "changed: Chill/a - y.FLAC",
        "added: New/one.m4a",
        "removed: Rock/Sub/deep.opus"
      ]
    );
    assert_eq!(diff(&after, &before)[2], "removed: New/one.m4a");
  }

  #[test]
  fn json_round_trip_through_write_and_read() {
    let t = tree();
    let m = build(t.path()).unwrap();
    let out = t.path().join("_Soundhood").join("snap.json");
    write(&out, &m).unwrap();
    assert_eq!(read(&out).unwrap(), m);
    // The snapshot sits in _Soundhood, so taking it does not change the manifest.
    assert_eq!(build(t.path()).unwrap(), m);
    let leftovers: Vec<_> = std::fs::read_dir(out.parent().unwrap())
      .unwrap()
      .filter(|e| {
        e.as_ref()
          .unwrap()
          .file_name()
          .to_string_lossy()
          .starts_with(TMP_PREFIX)
      })
      .collect();
    assert!(leftovers.is_empty());
  }

  #[test]
  fn missing_root_is_an_error() {
    let t = tempfile::tempdir().unwrap();
    assert!(build(&t.path().join("nope")).is_err());
  }
}
