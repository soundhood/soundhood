-- soundhood-core index schema, migration 0001.
-- The index is a rebuildable per-device cache: deleting the .sqlite file and running
-- "Rebuild index" must reproduce the same library from the files alone.
-- Connection pragmas (journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON) are set by
-- index::open() on every connection, not here, because PRAGMA journal_mode cannot run
-- inside the migration transaction.

CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);  -- schema_version, root_path, root_id, device_id, artist_convention

CREATE TABLE roots(
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tracks(
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL DEFAULT 1 REFERENCES roots,
  rel_path TEXT NOT NULL UNIQUE,                 -- NFC, forward slashes, matches m3u8 lines byte-for-byte
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  audio_hash BLOB, audio_hash_version INTEGER,
  fp_hash BLOB, fingerprint BLOB,
  title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT,
  year INTEGER, release_date TEXT, track_no INTEGER, disc_no INTEGER,
  duration_ms INTEGER, codec TEXT, bitrate INTEGER, sample_rate INTEGER,
  lufs REAL, rg_track_gain REAL, rg_track_peak REAL, bpm REAL, musical_key TEXT,
  mb_recording_id TEXT, mb_release_group_id TEXT, acoustid TEXT, source TEXT,
  added_at INTEGER NOT NULL,
  ingest_state TEXT NOT NULL DEFAULT 'indexed',
  analysed_at INTEGER,
  has_art INTEGER NOT NULL DEFAULT 0, art_hash BLOB,
  lyrics_source TEXT, lyrics_synced INTEGER, lyrics_word_sync INTEGER,
  lyrics_checked_at INTEGER, lyrics_negative_until INTEGER
);

CREATE TABLE artists(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_folded TEXT NOT NULL UNIQUE,
  mb_artist_id TEXT
);

CREATE TABLE track_artists(
  track_id INTEGER REFERENCES tracks ON DELETE CASCADE,
  artist_id INTEGER REFERENCES artists,
  position INTEGER,
  role TEXT NOT NULL DEFAULT 'main',
  PRIMARY KEY(track_id, artist_id, role)
);

CREATE TABLE playlists(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  file_rel_path TEXT,
  kind TEXT NOT NULL DEFAULT 'm3u8',
  mtime INTEGER,
  rules_json TEXT,
  saved INTEGER NOT NULL DEFAULT 1                -- smart drafts: saved=0, file_rel_path NULL
);

CREATE TABLE playlist_items(
  playlist_id INTEGER REFERENCES playlists ON DELETE CASCADE,
  position INTEGER,
  rel_path TEXT NOT NULL,
  track_id INTEGER,                               -- NULL = "missing", never dropped
  PRIMARY KEY(playlist_id, position)
);

CREATE TABLE plays(
  id INTEGER PRIMARY KEY,
  track_id INTEGER, audio_hash BLOB, played_at INTEGER, device TEXT, completed INTEGER
);

CREATE TABLE ingest_jobs(
  id TEXT PRIMARY KEY,
  rel_path TEXT, staging_path TEXT,
  state TEXT NOT NULL,
  proposal_json TEXT, batch_id TEXT, confidence REAL,
  created_at INTEGER, updated_at INTEGER, error TEXT
);

CREATE TABLE lookup_cache(key TEXT PRIMARY KEY, kind TEXT, body TEXT, fetched_at INTEGER);
CREATE TABLE player_state(k TEXT PRIMARY KEY, v TEXT);  -- last queue (rel_paths), index, position, shuffle, repeat
CREATE TABLE sync_state(k TEXT PRIMARY KEY, v TEXT);    -- last successful sync ts, journal cursor per device, remote SHA1 cache

CREATE VIRTUAL TABLE tracks_fts USING fts5(
  title, artist, album, rel_path,
  content='tracks', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2 tokenchars '-'"
);
CREATE VIRTUAL TABLE tracks_tri USING fts5(
  title, artist, album,
  content='tracks', content_rowid='id',
  tokenize="trigram"
);

-- External-content FTS triggers (both tables).
CREATE TRIGGER tracks_ai AFTER INSERT ON tracks BEGIN
  INSERT INTO tracks_fts(rowid, title, artist, album, rel_path) VALUES (new.id, new.title, new.artist, new.album, new.rel_path);
  INSERT INTO tracks_tri(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
END;
CREATE TRIGGER tracks_ad AFTER DELETE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, rel_path) VALUES ('delete', old.id, old.title, old.artist, old.album, old.rel_path);
  INSERT INTO tracks_tri(tracks_tri, rowid, title, artist, album) VALUES ('delete', old.id, old.title, old.artist, old.album);
END;
CREATE TRIGGER tracks_au AFTER UPDATE OF title, artist, album, rel_path ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, rel_path) VALUES ('delete', old.id, old.title, old.artist, old.album, old.rel_path);
  INSERT INTO tracks_tri(tracks_tri, rowid, title, artist, album) VALUES ('delete', old.id, old.title, old.artist, old.album);
  INSERT INTO tracks_fts(rowid, title, artist, album, rel_path) VALUES (new.id, new.title, new.artist, new.album, new.rel_path);
  INSERT INTO tracks_tri(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
END;

CREATE INDEX tracks_artist ON tracks(artist);
CREATE INDEX tracks_year ON tracks(year);
CREATE INDEX tracks_added ON tracks(added_at);
CREATE INDEX tracks_audio_hash ON tracks(audio_hash);
CREATE INDEX tracks_ingest_state ON tracks(ingest_state);
CREATE INDEX tracks_analysed ON tracks(analysed_at);
CREATE INDEX playlist_items_rel ON playlist_items(rel_path);
CREATE INDEX track_artists_artist ON track_artists(artist_id);
