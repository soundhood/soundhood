//! Same-stem companion files of a track (`<stem>.lrc`, `<stem>.txt`, `<stem>.lyricsfile.yaml`):
//! they travel with it on a move or rename and go to the bin with it on a delete.

use crate::error::Result;
use crate::model::RelPath;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// The suffixes (after the track's stem) that make a file a companion.
const SUFFIXES: [&str; 3] = [".lrc", ".txt", ".lyricsfile.yaml"];

/// One companion: where it is, and the suffix as spelled on disk (kept when it moves).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Companion {
  pub rel: RelPath,
  pub suffix: String,
}

impl Companion {
  /// Where this companion goes when its track becomes `track_to`: same suffix, new stem and folder.
  pub fn follow(&self, track_to: &RelPath) -> Result<RelPath> {
    let name = format!("{}{}", stem(track_to.file_name()), self.suffix);
    match track_to.parent() {
      Some(dir) => dir.join(&name),
      None => RelPath::new(&name),
    }
  }
}

/// The track's file name without its extension (`Song - Artist.m4a` -> `Song - Artist`).
fn stem(name: &str) -> &str {
  match name.rsplit_once('.') {
    Some((s, _)) if !s.is_empty() => s,
    _ => name,
  }
}

fn key(s: &str) -> String {
  s.nfc().collect::<String>().to_lowercase()
}

/// The companions of `track` in its folder, matched case-insensitively (NFC) so `Song.LRC` is
/// found and keeps its spelling. Sorted, so batches journal them in a stable order.
pub(crate) fn of(root: &Path, track: &RelPath) -> Result<Vec<Companion>> {
  let track_stem = key(stem(track.file_name()));
  let dir = match track.parent() {
    Some(p) => p.to_abs(root),
    None => root.to_path_buf(),
  };
  let mut out = Vec::new();
  for entry in std::fs::read_dir(&dir)? {
    let entry = entry?;
    if !entry.file_type()?.is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    let lower = key(&name);
    for suffix in SUFFIXES {
      if lower.strip_prefix(track_stem.as_str()) == Some(suffix) {
        // The on-disk spelling of the suffix: the same number of chars at the end of the name.
        let n = suffix.chars().count();
        let on_disk: String = name
          .chars()
          .rev()
          .take(n)
          .collect::<Vec<_>>()
          .into_iter()
          .rev()
          .collect();
        let rel = match track.parent() {
          Some(p) => p.join(&name)?,
          None => RelPath::new(&name)?,
        };
        out.push(Companion { rel, suffix: on_disk });
      }
    }
  }
  out.sort_by(|a, b| a.rel.cmp(&b.rel));
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_same_stem_lyrics_files_and_follows_the_track() {
    let d = tempfile::tempdir().unwrap();
    let dir = d.path().join("Chill");
    std::fs::create_dir_all(&dir).unwrap();
    for f in [
      "Song - Artist.m4a",
      "Song - Artist.LRC",
      "Song - Artist.txt",
      "Song - Artist.lyricsfile.yaml",
      "Song - Artist (Live).lrc",
      "Song - Artist.jpg",
      "Other.lrc",
    ] {
      std::fs::write(dir.join(f), b"x").unwrap();
    }
    let track = RelPath::new("Chill/Song - Artist.m4a").unwrap();
    let found = of(d.path(), &track).unwrap();
    let rels: Vec<&str> = found.iter().map(|c| c.rel.as_str()).collect();
    assert_eq!(
      rels,
      vec![
        "Chill/Song - Artist.LRC",
        "Chill/Song - Artist.lyricsfile.yaml",
        "Chill/Song - Artist.txt"
      ]
    );
    let to = RelPath::new("Pop/New Name.m4a").unwrap();
    assert_eq!(found[0].follow(&to).unwrap().as_str(), "Pop/New Name.LRC");
    assert_eq!(found[1].follow(&to).unwrap().as_str(), "Pop/New Name.lyricsfile.yaml");
    let root_to = RelPath::new("x.m4a").unwrap();
    assert_eq!(found[2].follow(&root_to).unwrap().as_str(), "x.txt");
  }
}
