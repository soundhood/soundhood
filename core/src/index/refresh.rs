//! One refresh or rebuild pass: scan, compare stamps, read the files that changed (in parallel,
//! outside the connection lock), then write tracks, artists and playlists in one transaction.

use super::artists::{fold_name, split_artists};
use super::{clamp_i64, db, legacy, lock, now_secs, Index, RefreshReport};
use crate::error::Result;
use crate::fs::{self, FileStamp, PLAYLISTS_DIR};
use crate::model::{path_key, Library, RelPath};
use crate::playlist;
use crate::tags::{self, TagRead};
use rayon::prelude::*;
use rusqlite::{params, Connection, TransactionBehavior};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Mode {
  /// Re-read only new files and files whose mtime or size changed.
  Incremental,
  /// Drop every row and read every file.
  Rebuild,
}

/// A track row as change detection sees it.
struct Existing {
  id: i64,
  mtime: i64,
  size: i64,
  added_at: i64,
}

/// The columns a pass writes for one file. `None` = not known: rows seeded from the legacy cache
/// carry title, artist and duration only, and keep `codec` NULL so they can be told apart.
struct Fields {
  title: String,
  artist: String,
  album: Option<String>,
  album_artist: Option<String>,
  genre: Option<String>,
  year: Option<i64>,
  release_date: Option<String>,
  duration_ms: i64,
  codec: Option<String>,
  bitrate: Option<i64>,
  sample_rate: Option<i64>,
  has_art: bool,
  art_hash: Option<Vec<u8>>,
}

impl From<TagRead> for Fields {
  fn from(t: TagRead) -> Fields {
    let (year, release_date) = split_date(&t.year);
    Fields {
      title: t.title,
      artist: t.artist,
      album: Some(t.album),
      album_artist: Some(t.album_artist),
      genre: Some(t.genre),
      year,
      release_date,
      duration_ms: clamp_i64(t.duration_ms),
      codec: Some(t.codec),
      bitrate: t.bitrate.map(i64::from),
      sample_rate: t.sample_rate.map(i64::from),
      has_art: t.has_art,
      art_hash: t.art_hash.as_deref().and_then(hex_bytes),
    }
  }
}

impl From<&legacy::Entry> for Fields {
  fn from(e: &legacy::Entry) -> Fields {
    Fields {
      title: e.title.clone(),
      artist: e.artist.clone(),
      album: None,
      album_artist: None,
      genre: None,
      year: None,
      release_date: None,
      duration_ms: clamp_i64(e.duration_secs.saturating_mul(1000)),
      codec: None,
      bitrate: None,
      sample_rate: None,
      has_art: false,
      art_hash: None,
    }
  }
}

impl Index {
  pub(super) fn pass(&self, lib: &Library, mode: Mode) -> Result<RefreshReport> {
    let _pass = lock(&self.pass);
    let started = Instant::now();
    let (stamps, skipped) = fs::scan_report(&lib.root)?;
    for line in &skipped {
      eprintln!("soundhood index: skipped {line}");
    }
    *lock(&self.skipped) = skipped;

    let existing = load_existing(&self.conn())?;
    let seed = match mode {
      Mode::Incremental => self.take_seed(lib, existing.is_empty()),
      // a real rebuild reads the files
      Mode::Rebuild => {
        lock(&self.seed).clear();
        HashMap::new()
      }
    };

    let mut to_read: Vec<&FileStamp> = Vec::new();
    let mut seeded: Vec<(&FileStamp, &legacy::Entry)> = Vec::new();
    for s in &stamps {
      let unchanged = mode == Mode::Incremental
        && existing
          .get(s.rel.as_str())
          .is_some_and(|r| r.mtime == s.mtime && r.size == clamp_i64(s.size));
      if unchanged {
        continue;
      }
      match seed.get(s.rel.as_str()) {
        Some(e) if e.matches(s.mtime, s.size) => seeded.push((s, e)),
        _ => to_read.push(s),
      }
    }
    let reads: Vec<TagRead> = to_read
      .par_iter()
      .map(|s| tags::read_lenient(&lib.abs(&s.rel)))
      .collect();

    let mut conn = self.conn();
    // IMMEDIATE: take the write lock now, not halfway through the pass.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if mode == Mode::Rebuild {
      clear(&tx)?;
    }
    db::set_meta(&tx, "device_id", &lib.device.0)?;

    let present: HashSet<&str> = stamps.iter().map(|s| s.rel.as_str()).collect();
    let mut removed = 0;
    for (rel, row) in &existing {
      if !present.contains(rel.as_str()) {
        if mode == Mode::Incremental {
          tx.prepare_cached("DELETE FROM tracks WHERE id = ?1")?
            .execute([row.id])?;
        }
        removed += 1;
      }
    }

    let mut artists = ArtistIds::load(&tx)?;
    let now = now_secs();
    let writes = to_read
      .iter()
      .zip(reads.into_iter().map(Fields::from))
      .chain(seeded.iter().map(|(s, e)| (s, Fields::from(*e))));
    for (s, fields) in writes {
      let prev = existing.get(s.rel.as_str());
      let id = write_track(&tx, mode, prev, s, &fields, now)?;
      artists.link(&tx, id, &fields.artist)?;
    }
    ArtistIds::prune(&tx)?;
    reconcile_playlists(&tx, &lib.root)?;
    tx.commit()?;
    drop(conn);

    Ok(RefreshReport {
      total: stamps.len(),
      read: to_read.len(),
      removed,
      millis: started.elapsed().as_millis(),
    })
  }

  /// The legacy seed for this pass: whatever `seed_from_legacy_json` loaded, or, for the first
  /// refresh of an empty index with a legacy cache folder set, a fresh load. Used once.
  fn take_seed(&self, lib: &Library, index_empty: bool) -> HashMap<String, legacy::Entry> {
    if lock(&self.seed).is_empty() && index_empty {
      if let Some(dir) = &self.legacy_cache_dir {
        // only a cache: a bad one means reading the files, not a failed refresh
        if let Err(e) = self.seed_from_legacy_json(lib, dir) {
          eprintln!("soundhood index: legacy tag cache not used: {e}");
        }
      }
    }
    std::mem::take(&mut *lock(&self.seed))
  }
}

fn load_existing(conn: &Connection) -> Result<HashMap<String, Existing>> {
  let mut stmt = conn.prepare("SELECT rel_path, id, mtime, size, added_at FROM tracks")?;
  let rows = stmt.query_map([], |r| {
    Ok((
      r.get::<_, String>(0)?,
      Existing {
        id: r.get(1)?,
        mtime: r.get(2)?,
        size: r.get(3)?,
        added_at: r.get(4)?,
      },
    ))
  })?;
  Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Everything "Rebuild index" re-derives from the files. Smart-playlist drafts (DB-only, no file)
/// and per-device history (`plays`, `player_state`, ...) are not derived from files and stay.
fn clear(conn: &Connection) -> Result<()> {
  conn.execute_batch(
    "DELETE FROM playlist_items WHERE playlist_id IN (SELECT id FROM playlists WHERE rules_json IS NULL);
     DELETE FROM playlists WHERE rules_json IS NULL;
     DELETE FROM track_artists;
     DELETE FROM tracks;
     DELETE FROM artists;",
  )?;
  Ok(())
}

/// Updates a changed row in place, or inserts a new one. A rebuild re-inserts a surviving path
/// under its old id and `added_at`, so play history and "recently added" do not shift.
fn write_track(
  conn: &Connection,
  mode: Mode,
  prev: Option<&Existing>,
  s: &FileStamp,
  f: &Fields,
  now: i64,
) -> Result<i64> {
  let size = clamp_i64(s.size);
  if let (Mode::Incremental, Some(p)) = (mode, prev) {
    // A changed file needs "Analyse library" again (analysed_at NULL); the old hashes stay
    // until it runs, so it can tell a tag edit (same audio) from new audio.
    conn
      .prepare_cached(
        "UPDATE tracks SET mtime = ?2, size = ?3, title = ?4, artist = ?5, album = ?6,
           album_artist = ?7, genre = ?8, year = ?9, release_date = ?10, duration_ms = ?11,
           codec = ?12, bitrate = ?13, sample_rate = ?14, has_art = ?15, art_hash = ?16,
           analysed_at = NULL
         WHERE id = ?1",
      )?
      .execute(params![
        p.id,
        s.mtime,
        size,
        f.title,
        f.artist,
        f.album,
        f.album_artist,
        f.genre,
        f.year,
        f.release_date,
        f.duration_ms,
        f.codec,
        f.bitrate,
        f.sample_rate,
        f.has_art,
        f.art_hash
      ])?;
    conn
      .prepare_cached("DELETE FROM track_artists WHERE track_id = ?1")?
      .execute([p.id])?;
    return Ok(p.id);
  }
  conn
    .prepare_cached(
      "INSERT INTO tracks(id, root_id, rel_path, mtime, size, title, artist, album, album_artist,
         genre, year, release_date, duration_ms, codec, bitrate, sample_rate, has_art, art_hash,
         added_at)
       VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
    )?
    .execute(params![
      prev.map(|p| p.id),
      s.rel.as_str(),
      s.mtime,
      size,
      f.title,
      f.artist,
      f.album,
      f.album_artist,
      f.genre,
      f.year,
      f.release_date,
      f.duration_ms,
      f.codec,
      f.bitrate,
      f.sample_rate,
      f.has_art,
      f.art_hash,
      prev.map_or(now, |p| p.added_at)
    ])?;
  Ok(conn.last_insert_rowid())
}

/// `artists` rows by folded name, kept in step with the inserts of one pass.
struct ArtistIds {
  by_folded: HashMap<String, i64>,
}

impl ArtistIds {
  fn load(conn: &Connection) -> Result<ArtistIds> {
    let mut stmt = conn.prepare("SELECT name_folded, id FROM artists")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    Ok(ArtistIds {
      by_folded: rows.collect::<rusqlite::Result<_>>()?,
    })
  }

  /// `track_artists` rows for one track from its artist tag (house split). The first spelling
  /// of an artist seen by the index names it; later spellings that fold equal share the row.
  fn link(&mut self, conn: &Connection, track_id: i64, tag: &str) -> Result<()> {
    for (position, (name, role)) in split_artists(tag).into_iter().enumerate() {
      let folded = fold_name(&name);
      let artist_id = match self.by_folded.get(&folded) {
        Some(id) => *id,
        None => {
          conn
            .prepare_cached("INSERT INTO artists(name, name_folded) VALUES (?1, ?2)")?
            .execute(params![name, folded])?;
          let id = conn.last_insert_rowid();
          self.by_folded.insert(folded, id);
          id
        }
      };
      conn
        .prepare_cached(
          "INSERT OR IGNORE INTO track_artists(track_id, artist_id, position, role) VALUES (?1, ?2, ?3, ?4)",
        )?
        .execute(params![track_id, artist_id, position as i64, role.as_str()])?;
    }
    Ok(())
  }

  /// Artists no track credits any more.
  fn prune(conn: &Connection) -> Result<()> {
    conn.execute(
      "DELETE FROM artists WHERE NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_id = artists.id)",
      [],
    )?;
    Ok(())
  }
}

/// Playlist lines to track ids: the exact path first, else the comparison key (NFC +
/// lower-case), the way playlist membership has always compared. No match = NULL = "missing";
/// the line itself is always kept.
struct Resolver {
  exact: HashMap<String, i64>,
  by_key: HashMap<String, i64>,
}

impl Resolver {
  fn load(conn: &Connection) -> Result<Resolver> {
    let mut stmt = conn.prepare("SELECT rel_path, id FROM tracks ORDER BY rel_path")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut res = Resolver {
      exact: HashMap::new(),
      by_key: HashMap::new(),
    };
    for row in rows {
      let (rel, id) = row?;
      // case twins (possible on Android): the first in path order answers for the key
      res.by_key.entry(path_key(&rel)).or_insert(id);
      res.exact.insert(rel, id);
    }
    Ok(res)
  }

  fn resolve(&self, line: &str) -> Option<i64> {
    let rel = RelPath::new(line).ok()?;
    self
      .exact
      .get(rel.as_str())
      .or_else(|| self.by_key.get(&rel.key()))
      .copied()
  }

  /// Re-points existing playlist lines at the current track ids (used when the playlist files
  /// themselves could not be re-read).
  fn re_resolve(&self, conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("SELECT playlist_id, position, rel_path FROM playlist_items")?;
    let items = stmt
      .query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
      })?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    for (playlist_id, position, line) in items {
      conn
        .prepare_cached("UPDATE playlist_items SET track_id = ?3 WHERE playlist_id = ?1 AND position = ?2")?
        .execute(params![playlist_id, position, self.resolve(&line)])?;
    }
    Ok(())
  }
}

/// Mirrors `_Playlists/*.m3u8` into `playlists` / `playlist_items`, every line in file order.
/// Reading only: the playlist files are never written here.
fn reconcile_playlists(conn: &Connection, root: &Path) -> Result<()> {
  let resolver = Resolver::load(conn)?;
  let lists = match playlist::list(root) {
    Ok(lists) => lists,
    Err(e) => {
      // A playlist held open by the sync client must not empty the index's copy of it.
      eprintln!("soundhood index: playlists not re-read ({e}); keeping the indexed ones");
      return resolver.re_resolve(conn);
    }
  };
  let files = playlist_files(root);
  let mut kept: HashSet<&str> = HashSet::new();
  for pl in &lists {
    if !kept.insert(pl.name.as_str()) {
      // Foo.m3u next to Foo.m3u8: one name, the first listed wins
      eprintln!(
        "soundhood index: two playlist files named '{}'; indexing the first",
        pl.name
      );
      continue;
    }
    let (file_rel, mtime) = files.get(&pl.name).cloned().unzip();
    conn
      .prepare_cached(
        "INSERT INTO playlists(name, file_rel_path, kind, mtime, saved) VALUES (?1, ?2, 'm3u8', ?3, 1)
         ON CONFLICT(name) DO UPDATE SET file_rel_path = excluded.file_rel_path, kind = 'm3u8',
           mtime = excluded.mtime, saved = 1",
      )?
      .execute(params![pl.name, file_rel, mtime])?;
    let id: i64 = conn
      .prepare_cached("SELECT id FROM playlists WHERE name = ?1")?
      .query_row([&pl.name], |r| r.get(0))?;
    conn
      .prepare_cached("DELETE FROM playlist_items WHERE playlist_id = ?1")?
      .execute([id])?;
    for (position, line) in pl.entries.iter().enumerate() {
      conn
        .prepare_cached(
          "INSERT INTO playlist_items(playlist_id, position, rel_path, track_id) VALUES (?1, ?2, ?3, ?4)",
        )?
        .execute(params![id, position as i64, line, resolver.resolve(line)])?;
    }
  }
  // File-backed playlists whose file is gone. Smart drafts (rules_json set) have no file.
  let mut stmt = conn.prepare("SELECT id, name FROM playlists WHERE rules_json IS NULL")?;
  let gone: Vec<i64> = stmt
    .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
    .collect::<rusqlite::Result<Vec<_>>>()?
    .into_iter()
    .filter(|(_, name)| !kept.contains(name.as_str()))
    .map(|(id, _)| id)
    .collect();
  for id in gone {
    // playlist_items go with it (ON DELETE CASCADE)
    conn
      .prepare_cached("DELETE FROM playlists WHERE id = ?1")?
      .execute([id])?;
  }
  Ok(())
}

/// Playlist name -> (`_Playlists/<file name>`, mtime). A `.m3u8` wins over a `.m3u` of the same
/// name, being the one the app writes. Unreadable entries are left out: this is metadata only.
fn playlist_files(root: &Path) -> HashMap<String, (String, i64)> {
  let mut out: HashMap<String, (String, i64)> = HashMap::new();
  let Ok(rd) = std::fs::read_dir(root.join(PLAYLISTS_DIR)) else {
    return out;
  };
  for entry in rd.flatten() {
    let path = entry.path();
    let (Some(stem), Some(ext), Some(file)) = (
      path.file_stem().map(|s| s.to_string_lossy().into_owned()),
      path.extension().and_then(|x| x.to_str()),
      path.file_name().map(|s| s.to_string_lossy().into_owned()),
    ) else {
      continue;
    };
    let m3u8 = ext.eq_ignore_ascii_case("m3u8");
    if !m3u8 && !ext.eq_ignore_ascii_case("m3u") {
      continue;
    }
    if !m3u8 && out.contains_key(&stem) {
      continue;
    }
    let Ok((mtime, _)) = fs::stamp(&path) else {
      continue;
    };
    out.insert(stem, (format!("{PLAYLISTS_DIR}/{file}"), mtime));
  }
  out
}

/// `("2015", None)` -> year 2015; a full date keeps the year and the date as written.
fn split_date(raw: &str) -> (Option<i64>, Option<String>) {
  let raw = raw.trim();
  let digits: String = raw.chars().take_while(char::is_ascii_digit).collect();
  let year = if digits.len() == 4 { digits.parse().ok() } else { None };
  let date = (raw.len() > 4).then(|| raw.to_string());
  (year, date)
}

/// Lower-case hex to bytes (`art_hash` is stored as a 32-byte BLOB); `None` for anything else.
fn hex_bytes(hex: &str) -> Option<Vec<u8>> {
  if !hex.len().is_multiple_of(2) {
    return None;
  }
  (0..hex.len())
    .step_by(2)
    .map(|i| hex.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn dates_and_hashes() {
    assert_eq!(split_date("2015"), (Some(2015), None));
    assert_eq!(split_date(" 2019-03-01 "), (Some(2019), Some("2019-03-01".into())));
    assert_eq!(split_date(""), (None, None));
    assert_eq!(split_date("199"), (None, None));
    assert_eq!(split_date("circa"), (None, Some("circa".into())));
    assert_eq!(hex_bytes("00ff10"), Some(vec![0, 255, 16]));
    assert_eq!(hex_bytes("0"), None);
    assert_eq!(hex_bytes("zz"), None);
    let h = blake3::hash(b"x").to_hex().to_string();
    assert_eq!(hex_bytes(&h).map(|b| b.len()), Some(32));
  }
}
