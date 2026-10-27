//! Opening the index: pragmas, the FTS5 assertion, numbered migrations, the meta rows.

use crate::error::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::Duration;

/// Migration N is `MIGRATIONS[N - 1]`; `schema.sql` (lead-owned) is migration 1. A later
/// migration is a new numbered file under `migrations/`, appended here, never an edit of an
/// earlier one.
const MIGRATIONS: &[&str] = &[include_str!("schema.sql")];

/// How the artist side of a file name joins credited artists (DECISIONS, Phase 0): all of them,
/// joined with ", ", primary first.
const ARTIST_CONVENTION: &str = "comma-all";

pub(super) fn open(path: &Path, root: &Path) -> Result<Connection> {
  let mut conn = Connection::open(path)?;
  // Another connection (a second window, a test) may hold the write lock for a moment.
  conn.busy_timeout(Duration::from_secs(5))?;
  // journal_mode answers with the mode it settled on; a file system without WAL support keeps
  // its default, which is slower but still correct.
  let _mode: String = conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get(0))?;
  conn.pragma_update(None, "synchronous", "NORMAL")?;
  conn.pragma_update(None, "foreign_keys", "ON")?;
  // Before the migrations: schema.sql creates FTS5 tables, and "no such module: fts5" would be a
  // far less useful error than this one.
  if !fts5_available(&conn)? {
    return Err(Error::Other(
      "this SQLite build has no FTS5 (ENABLE_FTS5 missing from pragma_compile_options)".into(),
    ));
  }
  migrate(&mut conn)?;
  let root = root.to_string_lossy();
  let tx = conn.transaction()?;
  tx.execute(
    "INSERT INTO roots(id, path, is_default) VALUES (1, ?1, 1)
     ON CONFLICT(id) DO UPDATE SET path = excluded.path",
    [root.as_ref()],
  )?;
  set_meta(&tx, "root_path", &root)?;
  set_meta(&tx, "root_id", "1")?;
  set_meta(&tx, "artist_convention", ARTIST_CONVENTION)?;
  tx.commit()?;
  Ok(conn)
}

pub(super) fn fts5_available(conn: &Connection) -> Result<bool> {
  let hit = conn
    .query_row(
      "SELECT 1 FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'",
      [],
      |_| Ok(()),
    )
    .optional()?;
  Ok(hit.is_some())
}

pub(super) fn set_meta(conn: &Connection, k: &str, v: &str) -> Result<()> {
  conn.execute(
    "INSERT INTO meta(k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    params![k, v],
  )?;
  Ok(())
}

/// The schema version recorded in `meta`, 0 for a brand-new file.
pub(super) fn schema_version(conn: &Connection) -> Result<usize> {
  let has_meta = conn
    .query_row(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
      [],
      |_| Ok(()),
    )
    .optional()?
    .is_some();
  if !has_meta {
    return Ok(0);
  }
  let v: Option<String> = conn
    .query_row("SELECT v FROM meta WHERE k = 'schema_version'", [], |r| r.get(0))
    .optional()?;
  Ok(v.and_then(|v| v.parse().ok()).unwrap_or(0))
}

/// Applies every migration newer than the recorded version, each in its own transaction together
/// with its version bump, so a crash leaves the file at a whole version.
fn migrate(conn: &mut Connection) -> Result<()> {
  let current = schema_version(conn)?;
  if current > MIGRATIONS.len() {
    return Err(Error::Other(format!(
      "the index was written by a newer Soundhood (schema {current}, this build knows {}); \
       delete it and choose Rebuild index",
      MIGRATIONS.len()
    )));
  }
  for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
    let tx = conn.transaction()?;
    tx.execute_batch(sql)?;
    set_meta(&tx, "schema_version", &(i + 1).to_string())?;
    tx.commit()?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn migrations_run_once_and_record_the_version() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("i.sqlite");
    let conn = open(&path, Path::new("/lib")).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len());
    drop(conn);
    // A second open finds the version and runs nothing ("table meta already exists" otherwise).
    let conn = open(&path, Path::new("/lib")).unwrap();
    assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len());
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "wal");
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1);
    let sync: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap();
    assert_eq!(sync, 1, "NORMAL");
  }

  #[test]
  fn a_newer_schema_is_refused() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("i.sqlite");
    let conn = open(&path, Path::new("/lib")).unwrap();
    set_meta(&conn, "schema_version", "999").unwrap();
    drop(conn);
    let err = open(&path, Path::new("/lib")).unwrap_err();
    assert!(err.to_string().contains("newer Soundhood"), "{err}");
  }
}
