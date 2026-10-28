//! The SQLite index on a generated fixture library: change detection, FTS5, the old track list,
//! the legacy JSON seed, playlists, and a 2,400-row timing run.

use rusqlite::Connection;
use soundhood_core::fixtures::{self, FixtureReport, FixtureSpec};
use soundhood_core::index::{self, Index};
use soundhood_core::{fs, manifest, DeviceId, Library, Platform, RelPath, Track};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

struct Fixture {
  _dirs: (TempDir, TempDir),
  lib: Library,
  app: PathBuf,
  report: FixtureReport,
}

fn fixture(spec: &FixtureSpec) -> Fixture {
  let (root, app) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
  let report = fixtures::generate(root.path(), spec).unwrap();
  let lib = Library {
    root: root.path().to_path_buf(),
    device: DeviceId("test-device".into()),
    platform: Platform::Desktop,
  };
  let app_dir = app.path().to_path_buf();
  Fixture {
    _dirs: (root, app),
    lib,
    app: app_dir,
    report,
  }
}

fn open(f: &Fixture) -> Index {
  Index::open(&f.app, &f.lib.root).unwrap()
}

/// A second connection on the index file, for checks the public surface does not offer.
fn sql(f: &Fixture) -> Connection {
  Connection::open(Index::db_path(&f.app, &f.lib.root)).unwrap()
}

fn count(c: &Connection, q: &str) -> i64 {
  c.query_row(q, [], |r| r.get(0)).unwrap()
}

fn meta(c: &Connection, k: &str) -> String {
  c.query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| r.get(0))
    .unwrap()
}

/// External-content FTS tables must agree with `tracks` after every kind of write.
fn assert_fts_consistent(c: &Connection) {
  c.execute(
    "INSERT INTO tracks_fts(tracks_fts, rank) VALUES ('integrity-check', 1)",
    [],
  )
  .unwrap();
  c.execute(
    "INSERT INTO tracks_tri(tracks_tri, rank) VALUES ('integrity-check', 1)",
    [],
  )
  .unwrap();
}

/// Moves the mtime to a second no earlier bump used, so change detection sees every bump even
/// when the content (and size) stay the same.
fn bump_mtime(path: &Path) {
  use std::sync::atomic::{AtomicU64, Ordering};
  static BUMPS: AtomicU64 = AtomicU64::new(1);
  let ahead = 3600 + 10 * BUMPS.fetch_add(1, Ordering::SeqCst);
  let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
  file
    .set_modified(SystemTime::now() + Duration::from_secs(ahead))
    .unwrap();
}

#[test]
fn refresh_reads_only_new_and_changed_files() {
  let f = fixture(&FixtureSpec::default());
  let before = manifest::build(&f.lib.root).unwrap();
  let idx = open(&f);

  let first = idx.refresh(&f.lib).unwrap();
  assert_eq!((first.total, first.read, first.removed), (50, 50, 0));
  let second = idx.refresh(&f.lib).unwrap();
  assert_eq!((second.total, second.read, second.removed), (50, 0, 0));

  let touched = f.lib.abs(&RelPath::new(&f.report.tracks[5].rel).unwrap());
  bump_mtime(&touched);
  let third = idx.refresh(&f.lib).unwrap();
  assert_eq!((third.total, third.read, third.removed), (50, 1, 0));

  let gone = &f.report.tracks[6].rel;
  std::fs::remove_file(f.lib.abs(&RelPath::new(gone).unwrap())).unwrap();
  let fourth = idx.refresh(&f.lib).unwrap();
  assert_eq!((fourth.total, fourth.read, fourth.removed), (49, 0, 1));
  assert!(idx.track(&f.lib, &RelPath::new(gone).unwrap()).unwrap().is_none());
  assert_eq!(idx.tracks(&f.lib).unwrap().len(), 49);

  let c = sql(&f);
  assert_eq!(count(&c, "SELECT count(*) FROM tracks"), 49);
  assert_fts_consistent(&c);
  // The index never writes into the library (the deletion above was the test's own).
  let after = manifest::build(&f.lib.root).unwrap();
  let diff = manifest::diff(&before, &after);
  assert_eq!(diff, [format!("removed: {gone}")], "{diff:?}");
}

#[test]
fn open_records_meta_and_the_root() {
  let f = fixture(&FixtureSpec {
    tracks: 6,
    folders: 2,
    playlists: 1,
    messy: false,
  });
  let idx = open(&f);
  assert!(idx.fts5_available().unwrap());
  idx.refresh(&f.lib).unwrap();
  let c = sql(&f);
  assert_eq!(meta(&c, "schema_version"), "1");
  assert_eq!(meta(&c, "root_path"), f.lib.root.to_string_lossy());
  assert_eq!(meta(&c, "root_id"), "1");
  assert_eq!(meta(&c, "device_id"), "test-device");
  assert_eq!(meta(&c, "artist_convention"), "comma-all");
  let (id, path): (i64, String) = c
    .query_row("SELECT id, path FROM roots", [], |r| Ok((r.get(0)?, r.get(1)?)))
    .unwrap();
  assert_eq!((id, path.as_str()), (1, &*f.lib.root.to_string_lossy()));
  assert_eq!(count(&c, "SELECT count(*) FROM tracks WHERE root_id = 1"), 6);
  let name = Index::db_path(&f.app, &f.lib.root);
  let name = name.file_name().unwrap().to_string_lossy();
  assert!(
    name.starts_with("library-") && name.ends_with(".sqlite") && name.len() == 31,
    "{name}"
  );
  // Re-opening an existing index runs no migration and keeps the rows.
  drop(idx);
  let idx = open(&f);
  assert_eq!(idx.refresh(&f.lib).unwrap().read, 0);
}

#[test]
fn fts5_is_compiled_in_and_both_tables_answer_queries() {
  let f = fixture(&FixtureSpec::default());
  let rel = RelPath::new(&f.report.tracks[0].rel).unwrap();
  retag_artist(&f.lib.abs(&rel), "Beyoncé");
  let idx = open(&f);
  assert!(idx.fts5_available().unwrap());
  idx.refresh(&f.lib).unwrap();
  let c = sql(&f);
  let options: i64 = count(
    &c,
    "SELECT count(*) FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'",
  );
  assert_eq!(options, 1);

  let hits = |table: &str, q: &str| -> Vec<String> {
    let mut stmt = c
      .prepare(&format!(
        "SELECT t.rel_path FROM {table} JOIN tracks t ON t.id = {table}.rowid WHERE {table} MATCH ?1 ORDER BY t.rel_path"
      ))
      .unwrap();
    stmt
      .query_map([q], |r| r.get(0))
      .unwrap()
      .collect::<rusqlite::Result<_>>()
      .unwrap()
  };
  // unicode61 with remove_diacritics: the plain spelling finds the accented one
  assert_eq!(hits("tracks_fts", "beyonce"), [rel.as_str()]);
  assert_eq!(hits("tracks_fts", "artist:beyoncé"), [rel.as_str()]);
  let cafe = &f.report.tracks[19].rel;
  assert_eq!(hits("tracks_fts", "cafe lumiere"), [cafe.as_str()]);
  assert_eq!(hits("tracks_fts", "senora"), [cafe.as_str()]);
  // trigram: substrings anywhere in a word
  assert_eq!(hits("tracks_tri", "eyonc"), [rel.as_str()]);
  assert_eq!(hits("tracks_tri", "umièr"), [cafe.as_str()]);
  assert!(hits("tracks_tri", "zzzq").is_empty());
  // rel_path is searchable in the word index (folder names)
  assert!(!hits("tracks_fts", "rel_path:archive").is_empty());
  // the artist row folds diacritics for matching, keeping the tag's spelling as its name
  let (name, folded): (String, String) = c
    .query_row(
      "SELECT name, name_folded FROM artists WHERE name_folded = 'beyonce'",
      [],
      |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap();
  assert_eq!((name.as_str(), folded.as_str()), ("Beyoncé", "beyonce"));
  assert_fts_consistent(&c);
}

#[test]
fn track_artists_follow_the_house_split() {
  let f = fixture(&FixtureSpec::default());
  let idx = open(&f);
  idx.refresh(&f.lib).unwrap();
  let c = sql(&f);
  let credits = |rel: &str| -> Vec<(String, String, i64)> {
    let mut stmt = c
      .prepare(
        "SELECT a.name, ta.role, ta.position FROM track_artists ta
         JOIN artists a ON a.id = ta.artist_id JOIN tracks t ON t.id = ta.track_id
         WHERE t.rel_path = ?1 ORDER BY ta.position",
      )
      .unwrap();
    stmt
      .query_map([rel], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
      .unwrap()
      .collect::<rusqlite::Result<_>>()
      .unwrap()
  };
  let feat = &f.report.tracks[9];
  assert_eq!(feat.artist, "Mira Velloux feat. Orrin Tal");
  assert_eq!(
    credits(&feat.rel),
    [
      ("Mira Velloux".into(), "main".into(), 0),
      ("Orrin Tal".into(), "featured".into(), 1)
    ]
  );
  let pair = &f.report.tracks[13];
  assert_eq!(
    credits(&pair.rel),
    [
      ("Sola Brakke".into(), "main".into(), 0),
      ("Teodor Fenn".into(), "main".into(), 1)
    ]
  );
  // untagged and artist-less files credit nobody; every artist row is credited somewhere
  assert!(credits(&f.report.tracks[23].rel).is_empty());
  assert_eq!(
    count(
      &c,
      "SELECT count(*) FROM artists a WHERE NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_id = a.id)"
    ),
    0
  );
  // ALL CAPS spelling of a known artist folds onto the same row
  let caps = &f.report.tracks[11];
  assert_eq!(credits(&caps.rel).len(), 1);
  let distinct = count(&c, "SELECT count(DISTINCT name_folded) FROM artists");
  assert_eq!(distinct, count(&c, "SELECT count(*) FROM artists"));
  // A retag re-credits the track; the artist nobody credits any more is dropped.
  let only = |name: &str| {
    count(
      &c,
      &format!("SELECT count(*) FROM artists WHERE name_folded = '{name}'"),
    )
  };
  let first = f.lib.abs(&RelPath::new(&f.report.tracks[0].rel).unwrap());
  retag_artist(&first, "Ulla Solo, Ilse Marrow");
  idx.refresh(&f.lib).unwrap();
  assert_eq!(only("ulla solo"), 1);
  retag_artist(&first, "Ilse Marrow");
  idx.refresh(&f.lib).unwrap();
  assert_eq!(only("ulla solo"), 0);
  assert_eq!(only("ilse marrow"), 1);
  retag_artist(&first, "Ulla Solo");
  idx.refresh(&f.lib).unwrap();
  std::fs::remove_file(&first).unwrap();
  idx.refresh(&f.lib).unwrap();
  assert_eq!(only("ulla solo"), 0, "a deleted file's credits go with it");
}

/// Sets the artist tag with lofty directly (the core's write path is crate-private) and moves the
/// mtime on, so a refresh within the same second still sees the change.
fn retag_artist(abs: &Path, artist: &str) {
  use lofty::file::{AudioFile, TaggedFileExt};
  use lofty::tag::Accessor;
  let mut tagged = lofty::read_from_path(abs).unwrap();
  tagged.primary_tag_mut().unwrap().set_artist(artist.into());
  tagged
    .save_to_path(abs, lofty::config::WriteOptions::default())
    .unwrap();
  bump_mtime(abs);
}

// ---- the old scan_music_folder, ported as the oracle ------------------------------------------

fn old_is_audio(path: &Path) -> bool {
  let ext = path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.to_ascii_lowercase());
  matches!(
    ext.as_deref(),
    Some("mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "wma" | "aiff" | "alac")
  )
}

fn old_first_folder(root: &Path, path: &Path) -> String {
  let Ok(rel) = path.strip_prefix(root) else {
    return "(root)".into();
  };
  let mut parts = rel.components();
  match (parts.next(), parts.next()) {
    (Some(std::path::Component::Normal(d)), Some(_)) => d.to_string_lossy().into_owned(),
    _ => "(root)".into(),
  }
}

fn old_scan_dir(root: &Path, dir: &Path, out: &mut Vec<Track>) {
  for entry in std::fs::read_dir(dir).unwrap() {
    let entry = entry.unwrap();
    let path = entry.path();
    let ft = entry.file_type().unwrap();
    if ft.is_dir() {
      old_scan_dir(root, &path, out);
    } else if ft.is_file() && old_is_audio(&path) {
      out.push(Track {
        path: path.to_string_lossy().to_string(),
        name: path
          .file_name()
          .and_then(|n| n.to_str())
          .unwrap_or("unknown")
          .to_string(),
        playlist: old_first_folder(root, &path),
        title: String::new(),
        artist: String::new(),
        duration_secs: 0,
      });
    }
  }
}

fn old_read_tags(path: &Path) -> (String, String, u64) {
  use lofty::file::{AudioFile, TaggedFileExt};
  use lofty::tag::Accessor;
  let Ok(tagged) = lofty::read_from_path(path) else {
    return (String::new(), String::new(), 0);
  };
  let secs = tagged.properties().duration().as_secs();
  let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
  let title = tag
    .and_then(|t| t.title().map(|s| s.trim().to_string()))
    .unwrap_or_default();
  let artist = tag
    .and_then(|t| t.artist().map(|s| s.trim().to_string()))
    .unwrap_or_default();
  (title, artist, secs)
}

fn old_split_artists(artist: &str) -> Vec<String> {
  let mut out = Vec::new();
  for part in artist.split([',', '/', ';']) {
    let mut piece = part.trim().to_string();
    let lower = piece.to_lowercase();
    for marker in [" feat. ", " feat ", " ft. ", " ft "] {
      if let Some(i) = lower.find(marker) {
        let (main, featured) = piece.split_at(i);
        let featured = featured[marker.len()..].trim().to_string();
        piece = main.trim().to_string();
        if !featured.is_empty() {
          out.push(featured);
        }
        break;
      }
    }
    if !piece.is_empty() {
      out.push(piece);
    }
  }
  out
}

fn old_artist_from_filename(name: &str, known: &HashSet<String>) -> String {
  let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
  let Some((left, right)) = stem.rsplit_once(" - ") else {
    return String::new();
  };
  for candidate in [right.trim(), left.trim()] {
    if candidate.is_empty() {
      continue;
    }
    if known.contains(&candidate.to_lowercase()) {
      return candidate.to_string();
    }
  }
  String::new()
}

fn old_scan_music_folder(root: &Path) -> Vec<Track> {
  let mut tracks = Vec::new();
  old_scan_dir(root, root, &mut tracks);
  for t in &mut tracks {
    let (title, artist, secs) = old_read_tags(Path::new(&t.path));
    t.title = title;
    t.artist = artist;
    t.duration_secs = secs;
  }
  let known: HashSet<String> = tracks
    .iter()
    .flat_map(|t| old_split_artists(&t.artist))
    .map(|a| a.to_lowercase())
    .collect();
  for t in &mut tracks {
    if t.artist.is_empty() {
      t.artist = old_artist_from_filename(&t.name, &known);
    }
  }
  tracks.sort_by(|a, b| a.playlist.cmp(&b.playlist).then(a.name.cmp(&b.name)));
  tracks
}

// -----------------------------------------------------------------------------------------------

#[test]
fn tracks_equal_the_old_scan_music_folder() {
  let f = fixture(&FixtureSpec::default());
  let idx = open(&f);
  idx.refresh(&f.lib).unwrap();
  let got = idx.tracks(&f.lib).unwrap();
  let want = old_scan_music_folder(&f.lib.root);
  assert_eq!(got.len(), want.len());
  for (g, w) in got.iter().zip(&want) {
    assert_eq!(g, w);
  }
  // The fallback really ran: the untagged track got its artist from its file name.
  let untagged = got.iter().find(|t| t.title.is_empty()).unwrap();
  assert!(!untagged.artist.is_empty(), "{untagged:?}");
  // Root files first, as "(root)" sorts before the folder names.
  assert_eq!(got[0].playlist, "(root)");
  if cfg!(windows) {
    assert!(got
      .iter()
      .filter(|t| t.playlist != "(root)")
      .all(|t| t.path.contains('\\')));
  }
  // One track at a time gives the same answer, also for a differently-cased path.
  for t in &got {
    let rel = f.lib.rel(Path::new(&t.path)).unwrap();
    assert_eq!(idx.track(&f.lib, &rel).unwrap().as_ref(), Some(t));
  }
  let upper = RelPath::new(&f.lib.rel(Path::new(&got[3].path)).unwrap().as_str().to_uppercase()).unwrap();
  assert_eq!(idx.track(&f.lib, &upper).unwrap().as_ref(), Some(&got[3]));
}

#[test]
fn rebuild_reads_every_file_and_keeps_ids() {
  let f = fixture(&FixtureSpec::default());
  let idx = open(&f);
  idx.refresh(&f.lib).unwrap();
  let c = sql(&f);
  let ids = |c: &Connection| -> HashMap<String, (i64, i64)> {
    let mut stmt = c.prepare("SELECT rel_path, id, added_at FROM tracks").unwrap();
    stmt
      .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))
      .unwrap()
      .collect::<rusqlite::Result<_>>()
      .unwrap()
  };
  let before = ids(&c);
  let tracks_before = idx.tracks(&f.lib).unwrap();
  let gone = f.report.tracks[8].rel.clone();
  std::fs::remove_file(f.lib.abs(&RelPath::new(&gone).unwrap())).unwrap();

  let r = idx.rebuild(&f.lib).unwrap();
  assert_eq!((r.total, r.read, r.removed), (49, 49, 1));
  let after = ids(&c);
  assert_eq!(after.len(), 49);
  for (rel, v) in &after {
    assert_eq!(before.get(rel), Some(v), "{rel}: id and added_at survive a rebuild");
  }
  let gone_abs = f.lib.abs(&RelPath::new(&gone).unwrap());
  let mut expected = tracks_before;
  expected.retain(|t| t.path != gone_abs.to_string_lossy());
  assert_eq!(idx.tracks(&f.lib).unwrap(), expected);
  assert_fts_consistent(&c);
  assert_eq!(idx.refresh(&f.lib).unwrap().read, 0);
}

#[test]
fn playlists_are_mirrored_and_missing_lines_are_kept() {
  let f = fixture(&FixtureSpec::default());
  let idx = open(&f);
  idx.refresh(&f.lib).unwrap();
  let c = sql(&f);
  let items = |name: &str| -> Vec<(String, Option<i64>)> {
    let mut stmt = c
      .prepare(
        "SELECT i.rel_path, i.track_id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
         WHERE p.name = ?1 ORDER BY i.position",
      )
      .unwrap();
    stmt
      .query_map([name], |r| Ok((r.get(0)?, r.get(1)?)))
      .unwrap()
      .collect::<rusqlite::Result<_>>()
      .unwrap()
  };
  assert_eq!(count(&c, "SELECT count(*) FROM playlists"), 5);
  for pl in &f.report.playlists {
    let got = items(&pl.name);
    let lines: Vec<&str> = got.iter().map(|(l, _)| l.as_str()).collect();
    assert_eq!(lines, pl.entries, "{}: every line, in file order", pl.name);
    assert!(got.iter().all(|(_, id)| id.is_some()), "{}", pl.name);
  }
  let file_rel: String = c
    .query_row(
      "SELECT file_rel_path FROM playlists WHERE name = 'Late Night'",
      [],
      |r| r.get(0),
    )
    .unwrap();
  assert_eq!(file_rel, "_Playlists/Late Night.m3u8");

  // A track that disappears stays in its playlist as a missing line (track_id NULL).
  let late = &f.report.playlists[2];
  let victim = late.entries[1].clone();
  std::fs::remove_file(f.lib.abs(&RelPath::new(&victim).unwrap())).unwrap();
  // A line naming a file in another case still resolves (membership compares keys).
  let pl_dir = f.lib.root.join("_Playlists");
  let focus = std::fs::read_to_string(pl_dir.join("Focus.m3u8")).unwrap();
  let shouted = f.report.playlists[1].entries[0].to_uppercase();
  std::fs::write(
    pl_dir.join("Focus.m3u8"),
    format!("{focus}{shouted}\nNowhere/Not A File.mp3\n"),
  )
  .unwrap();
  std::fs::remove_file(pl_dir.join("Empty.m3u8")).unwrap();
  idx.refresh(&f.lib).unwrap();

  let got = items("Late Night");
  assert_eq!(got.len(), late.entries.len(), "the missing line is kept");
  assert_eq!(got[1], (victim, None));
  let focus = items("Focus");
  let n = focus.len();
  assert_eq!(focus[n - 1], ("Nowhere/Not A File.mp3".to_string(), None));
  assert_eq!(focus[n - 2].1, focus[0].1, "upper-case line resolves to the same track");
  assert_eq!(count(&c, "SELECT count(*) FROM playlists"), 4, "Empty.m3u8 is gone");
}

/// The legacy cache exactly as the old host wrote it: absolute paths (backslashes on Windows) to
/// `{mtime, size, title, artist, duration_secs}`.
fn write_legacy_cache(f: &Fixture, cache_dir: &Path, title_of: impl Fn(&str) -> String) -> PathBuf {
  let mut map = serde_json::Map::new();
  for t in &f.report.tracks {
    let rel = RelPath::new(&t.rel).unwrap();
    let abs = f.lib.abs(&rel);
    let (mtime, size) = fs::stamp(&abs).unwrap();
    map.insert(
      abs.to_string_lossy().into_owned(),
      serde_json::json!({
        "mtime": mtime, "size": size, "title": title_of(&t.title), "artist": t.artist,
        "duration_secs": t.duration_secs
      }),
    );
  }
  // Entries the seed must skip: outside the root, and malformed.
  map.insert(
    cache_dir.join("elsewhere.mp3").to_string_lossy().into_owned(),
    serde_json::json!({"mtime": 1, "size": 1, "title": "x", "artist": "y", "duration_secs": 1}),
  );
  map.insert(
    f.lib.root.join("broken.mp3").to_string_lossy().into_owned(),
    serde_json::json!("not an entry"),
  );
  std::fs::create_dir_all(cache_dir).unwrap();
  let path = cache_dir.join(format!("library-{:016x}.json", fnv64(&f.lib.root.to_string_lossy())));
  std::fs::write(&path, serde_json::to_string(&map).unwrap()).unwrap();
  path
}

fn fnv64(s: &str) -> u64 {
  let mut h: u64 = 0xcbf29ce484222325;
  for b in s.as_bytes() {
    h ^= *b as u64;
    h = h.wrapping_mul(0x100000001b3);
  }
  h
}

#[test]
fn the_first_refresh_seeds_from_the_legacy_json_cache() {
  let f = fixture(&FixtureSpec::default());
  let cache = f.app.join("cache");
  // Cached titles carry a marker, so the test can see which rows came from the cache.
  let legacy = write_legacy_cache(&f, &cache, |t| format!("{t} [cached]"));
  if cfg!(windows) {
    let text = std::fs::read_to_string(&legacy).unwrap();
    assert!(text.contains("\\\\"), "keys use backslashes, as on the owner's PC");
  }
  // One file changed since the cache was written: that one must be read.
  let changed = RelPath::new(&f.report.tracks[4].rel).unwrap();
  bump_mtime(&f.lib.abs(&changed));

  let idx = open(&f).with_legacy_cache_dir(Some(&cache));
  let r = idx.refresh(&f.lib).unwrap();
  assert_eq!(
    (r.total, r.read, r.removed),
    (50, 1, 0),
    "49 rows from the cache, 1 read"
  );
  let tracks = idx.tracks(&f.lib).unwrap();
  let changed_track = idx.track(&f.lib, &changed).unwrap().unwrap();
  assert!(!changed_track.title.ends_with("[cached]"), "{changed_track:?}");
  assert_eq!(tracks.iter().filter(|t| t.title.ends_with("[cached]")).count(), 49);
  // Seeded rows are told apart by codec NULL ("Rebuild index" reads them properly).
  let c = sql(&f);
  assert_eq!(count(&c, "SELECT count(*) FROM tracks WHERE codec IS NULL"), 49);
  assert_eq!(count(&c, "SELECT count(*) FROM tracks WHERE codec IS NOT NULL"), 1);
  // The seed is used once: the next refresh reads nothing and still has the cached rows.
  assert_eq!(idx.refresh(&f.lib).unwrap().read, 0);

  // The cache file itself was only read; removing it is the host's call after the first refresh.
  assert!(legacy.is_file());
  std::fs::write(legacy.with_extension("json.tmp"), b"{}").unwrap();
  assert!(index::remove_legacy_json_cache(&cache, &f.lib.root).unwrap());
  assert!(!legacy.exists() && !legacy.with_extension("json.tmp").exists());
  assert!(!index::remove_legacy_json_cache(&cache, &f.lib.root).unwrap());

  // A rebuild never uses the cache: every file is read and the markers are gone.
  write_legacy_cache(&f, &cache, |t| format!("{t} [cached]"));
  let r = idx.rebuild(&f.lib).unwrap();
  assert_eq!((r.total, r.read), (50, 50));
  assert!(idx
    .tracks(&f.lib)
    .unwrap()
    .iter()
    .all(|t| !t.title.ends_with("[cached]")));
  assert_eq!(count(&c, "SELECT count(*) FROM tracks WHERE codec IS NULL"), 0);
  // After a rebuild the list is the old scan's list again.
  assert_eq!(idx.tracks(&f.lib).unwrap(), old_scan_music_folder(&f.lib.root));
}

#[test]
fn seed_from_legacy_json_converts_keys_and_skips_strays() {
  let f = fixture(&FixtureSpec::default());
  let cache = f.app.join("cache");
  let idx = open(&f);
  assert_eq!(idx.seed_from_legacy_json(&f.lib, &cache).unwrap(), 0, "no cache file");
  write_legacy_cache(&f, &cache, |t| t.to_string());
  // 50 tracks; the key outside the root and the malformed entry are skipped.
  assert_eq!(idx.seed_from_legacy_json(&f.lib, &cache).unwrap(), 50);
  // An explicitly loaded seed is used by the next refresh even without a cache dir set.
  let r = idx.refresh(&f.lib).unwrap();
  assert_eq!((r.total, r.read), (50, 0));
  assert_eq!(idx.tracks(&f.lib).unwrap(), old_scan_music_folder(&f.lib.root));

  // A cache that is not JSON is an error from the explicit call, and a plain read in refresh.
  let f2 = fixture(&FixtureSpec {
    tracks: 6,
    folders: 2,
    playlists: 0,
    messy: false,
  });
  let cache2 = f2.app.join("cache");
  std::fs::create_dir_all(&cache2).unwrap();
  std::fs::write(
    cache2.join(format!("library-{:016x}.json", fnv64(&f2.lib.root.to_string_lossy()))),
    b"not json",
  )
  .unwrap();
  let idx2 = open(&f2).with_legacy_cache_dir(Some(&cache2));
  assert!(idx2.seed_from_legacy_json(&f2.lib, &cache2).is_err());
  assert_eq!(idx2.refresh(&f2.lib).unwrap().read, 6);
}

#[test]
fn refresh_of_2400_files_from_the_index_takes_seconds() {
  let f = fixture(&FixtureSpec::default());
  // Bulk up to 2,400 files by copying the fixture's files into more folders (copies, not new tags:
  // the tag read is what the timing is about, not tag variety).
  let sources: Vec<PathBuf> = f
    .report
    .tracks
    .iter()
    .map(|t| f.lib.abs(&RelPath::new(&t.rel).unwrap()))
    .collect();
  let mut n = sources.len();
  let mut folder = 0;
  while n < 2400 {
    let dir = f.lib.root.join(format!("Bulk {folder:02}"));
    std::fs::create_dir_all(&dir).unwrap();
    for (i, src) in sources.iter().enumerate().take((2400 - n).min(sources.len())) {
      let ext = src.extension().unwrap().to_string_lossy();
      std::fs::copy(src, dir.join(format!("Track {i:03} - Artist {folder}.{ext}"))).unwrap();
      n += 1;
    }
    folder += 1;
  }

  let idx = open(&f);
  let full = idx.refresh(&f.lib).unwrap();
  assert_eq!((full.total, full.read), (2400, 2400));
  let cached = idx.refresh(&f.lib).unwrap();
  assert_eq!((cached.total, cached.read), (2400, 0));
  let started = std::time::Instant::now();
  let tracks = idx.tracks(&f.lib).unwrap();
  let list_ms = started.elapsed().as_millis();
  assert_eq!(tracks.len(), 2400);
  let rebuild = idx.rebuild(&f.lib).unwrap();
  assert_eq!(rebuild.read, 2400);

  // The upgrade path: a fresh index on another app dir, seeded from the old JSON cache.
  let cache = f.app.join("cache");
  std::fs::create_dir_all(&cache).unwrap();
  let mut legacy = serde_json::Map::new();
  for t in &tracks {
    let (mtime, size) = fs::stamp(Path::new(&t.path)).unwrap();
    legacy.insert(
      t.path.clone(),
      serde_json::json!({"mtime": mtime, "size": size, "title": t.title, "artist": "",
        "duration_secs": t.duration_secs}),
    );
  }
  let name = format!("library-{:016x}.json", fnv64(&f.lib.root.to_string_lossy()));
  std::fs::write(cache.join(name), serde_json::to_string(&legacy).unwrap()).unwrap();
  let app2 = tempfile::tempdir().unwrap();
  let seeded = Index::open(app2.path(), &f.lib.root)
    .unwrap()
    .with_legacy_cache_dir(Some(&cache));
  let upgrade = seeded.refresh(&f.lib).unwrap();
  assert_eq!((upgrade.total, upgrade.read), (2400, 0));

  eprintln!(
    "index timing, 2,400 files ({} build): first refresh {} ms (all read), refresh from the index {} ms, \
     track list {} ms, rebuild {} ms, first refresh seeded from the legacy JSON cache {} ms",
    if cfg!(debug_assertions) { "debug" } else { "release" },
    full.millis,
    cached.millis,
    list_ms,
    rebuild.millis,
    upgrade.millis
  );
}
