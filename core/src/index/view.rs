//! Rows to the UI's `Track` shape, exactly as the pre-rebuild `scan_music_folder` produced it.
//!
//! Order: the old scan collected files in directory-walk order and then sorted them by
//! (first-level folder, file name), byte-wise and case-sensitively, so `"(root)"` comes before
//! most folder names and `B.mp3` before `a.mp3`. That sort is reproduced here; files with the same
//! folder and name (in different sub-folders) were left in walk order by the old stable sort and
//! are ordered by their path here. `fs::scan` itself returns plain path order, which differs
//! (`Rock/Sub/z.mp3` sorts before `Rock/a.mp3` there, after it here).

use super::artists::{artist_from_filename, legacy_split};
use crate::error::Result;
use crate::model::{path_key, Library, RelPath, Track};
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashSet;

/// The playlist name the old host gave files sitting directly in the root.
const ROOT_PLAYLIST: &str = "(root)";

struct Row {
  rel: RelPath,
  title: String,
  artist: String,
  duration_ms: i64,
}

const SELECT: &str = "SELECT rel_path, title, artist, duration_ms FROM tracks";

/// One `SELECT` row before validation.
type Raw = (String, Option<String>, Option<String>, Option<i64>);

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Raw> {
  Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}

fn to_row(raw: Raw) -> Result<Row> {
  let (rel, title, artist, duration_ms) = raw;
  Ok(Row {
    rel: RelPath::new(&rel)?,
    title: title.unwrap_or_default(),
    artist: artist.unwrap_or_default(),
    duration_ms: duration_ms.unwrap_or(0),
  })
}

pub(super) fn tracks(conn: &Connection, lib: &Library) -> Result<Vec<Track>> {
  let mut stmt = conn.prepare(SELECT)?;
  let rows = stmt
    .query_map([], row)?
    .map(|r| to_row(r?))
    .collect::<Result<Vec<Row>>>()?;
  let known = known_artists(rows.iter().map(|r| r.artist.as_str()));
  let mut out: Vec<(RelPath, Track)> = rows
    .into_iter()
    .map(|r| {
      let t = to_track(lib, &r, &known);
      (r.rel, t)
    })
    .collect();
  out.sort_by(|(ra, a), (rb, b)| {
    a.playlist
      .cmp(&b.playlist)
      .then_with(|| a.name.cmp(&b.name))
      .then_with(|| ra.cmp(rb))
  });
  Ok(out.into_iter().map(|(_, t)| t).collect())
}

pub(super) fn track(conn: &Connection, lib: &Library, rel: &RelPath) -> Result<Option<Track>> {
  let exact = conn
    .query_row(&format!("{SELECT} WHERE rel_path = ?1"), [rel.as_str()], row)
    .optional()?;
  let raw = match exact {
    Some(raw) => Some(raw),
    // The path as the caller spelled it may differ in case or normalisation from the disk.
    None => {
      let key = rel.key();
      let mut stmt = conn.prepare(SELECT)?;
      let mut found = None;
      for r in stmt.query_map([], row)? {
        let r = r?;
        if path_key(&r.0) == key {
          found = Some(r);
          break;
        }
      }
      found
    }
  };
  let Some(raw) = raw else {
    return Ok(None);
  };
  let r = to_row(raw)?;
  let known = if r.artist.is_empty() {
    let mut stmt = conn.prepare("SELECT artist FROM tracks WHERE artist <> ''")?;
    let artists = stmt
      .query_map([], |x| x.get::<_, String>(0))?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    known_artists(artists.iter().map(String::as_str))
  } else {
    HashSet::new()
  };
  Ok(Some(to_track(lib, &r, &known)))
}

/// Every artist named by a tag, lower-cased, split the way the old host split them.
fn known_artists<'a>(tags: impl Iterator<Item = &'a str>) -> HashSet<String> {
  tags.flat_map(legacy_split).map(|a| a.to_lowercase()).collect()
}

fn to_track(lib: &Library, r: &Row, known: &HashSet<String>) -> Track {
  let name = r.rel.file_name().to_string();
  let artist = if r.artist.is_empty() {
    artist_from_filename(&name, known)
  } else {
    r.artist.clone()
  };
  Track {
    // PathBuf joins, as the old walk built them: backslashes after the root on Windows
    path: lib.abs(&r.rel).to_string_lossy().into_owned(),
    playlist: r.rel.top_folder().unwrap_or(ROOT_PLAYLIST).to_string(),
    name,
    title: r.title.clone(),
    artist,
    // truncated seconds, like the old `duration().as_secs()`
    duration_secs: u64::try_from(r.duration_ms).unwrap_or(0) / 1000,
  }
}
