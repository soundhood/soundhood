//! Tier 2 playlist edits through the sole m3u8 writer: journaled before/after content, no write
//! over a playlist that cannot be read, the folder import, undo.

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::tagwrite::{apply, ApplyOptions};
use soundhood_core::ingest::{undo, BatchReport, Kind, Op};
use soundhood_core::model::{Library, RelPath};
use soundhood_core::{manifest, playlist};
use support::*;

fn one(lib: &Library, op: Op) -> BatchReport {
  apply(lib, vec![op], &ApplyOptions::default())
}

fn tracks_in(lib: &Library, list: &str) -> Vec<RelPath> {
  playlist::read(&lib.root, list)
    .unwrap()
    .entries
    .iter()
    .map(|e| rel(e))
    .collect()
}

#[test]
fn add_remove_create_delete_each_journal_and_undo_back_to_the_start() {
  let (_d, lib, _) = fixture_lib(20, false);
  let start = manifest::build(&lib.root).unwrap();
  let picks = tracks_in(&lib, "Focus");
  let (a, b) = (picks[0].clone(), picks[1].clone());
  let file = lib.root.join("_Playlists/Road Trip.m3u8");

  let rep = one(
    &lib,
    Op::PlaylistAdd {
      name: " Road Trip ".into(),
      rels: vec![a.clone(), b.clone(), a.clone()],
    },
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(rep.applied[0].label, "Added 2 tracks to Road Trip");
  assert_eq!(
    std::fs::read_to_string(&file).unwrap(),
    format!("#EXTM3U\n{a}\n{b}\n"),
    "house format, no duplicates"
  );
  let e = entries(&lib).pop().unwrap();
  assert_eq!(e.kind, Kind::Playlist);
  let pc = &e.playlists_touched[0];
  assert_eq!(pc.before, None, "created by the add");
  assert_eq!(pc.after.as_ref().unwrap().len(), 2);
  assert_eq!(
    pc.after_hash.as_deref(),
    Some(blake3::hash(&std::fs::read(&file).unwrap()).to_hex().as_str())
  );

  let again = one(
    &lib,
    Op::PlaylistAdd {
      name: "road trip".into(),
      rels: vec![rel(&a.as_str().to_uppercase())],
    },
  );
  assert!(again.applied.is_empty());
  assert_eq!(again.skipped[0].reason, "already in the playlist");

  let rep = one(
    &lib,
    Op::PlaylistRemove {
      name: "Road Trip".into(),
      rels: vec![a.clone()],
    },
  );
  assert_eq!(rep.applied[0].label, "Removed 1 track from Road Trip");
  assert_eq!(std::fs::read_to_string(&file).unwrap(), format!("#EXTM3U\n{b}\n"));

  let rep = one(
    &lib,
    Op::PlaylistCreate {
      name: "Road Trip".into(),
    },
  );
  assert_eq!(rep.skipped[0].reason, "playlist already exists");
  let rep = one(
    &lib,
    Op::PlaylistCreate {
      name: "Night Bus".into(),
    },
  );
  assert_eq!(rep.applied[0].label, "Created playlist Night Bus");
  assert_eq!(
    std::fs::read(lib.root.join("_Playlists/Night Bus.m3u8")).unwrap(),
    b"#EXTM3U\n"
  );

  let rep = one(
    &lib,
    Op::PlaylistDelete {
      name: "Road Trip".into(),
    },
  );
  assert_eq!(rep.applied[0].label, "Deleted playlist Road Trip");
  assert!(!file.exists());
  let e = entries(&lib).pop().unwrap();
  assert_eq!(e.kind, Kind::PlaylistDelete);
  assert!(e.bin.unwrap().bin_rel.unwrap().as_str().starts_with("_Soundhood/.bin/"));

  let missing = one(
    &lib,
    Op::PlaylistRemove {
      name: "Nope".into(),
      rels: vec![a.clone()],
    },
  );
  assert_eq!(missing.failed[0].error, "No playlist named Nope");
  assert!(!lib.root.join("_Playlists/Nope.m3u8").exists(), "no ghost playlist");

  // Undo everything, newest first: delete, create, remove, add.
  let mut labels = Vec::new();
  while let Some(last) = undo::last_change(&lib).unwrap() {
    labels.push(last.label.clone());
    let u = undo::undo_batch(&lib, &last.batch).unwrap();
    assert!(
      u.failed.is_empty() && u.skipped.is_empty(),
      "{}: {}",
      last.label,
      show(&u)
    );
  }
  assert_eq!(
    labels,
    vec![
      "Deleted playlist Road Trip",
      "Created playlist Night Bus",
      "Removed 1 track from Road Trip",
      "Added 2 tracks to Road Trip"
    ]
  );
  assert!(!file.exists() && !lib.root.join("_Playlists/Night Bus.m3u8").exists());
  assert!(manifest::diff(&start, &manifest::build(&lib.root).unwrap()).is_empty());
}

#[test]
fn a_playlist_that_cannot_be_read_is_never_written_over() {
  let (_d, lib, _) = fixture_lib(10, false);
  let bad = lib.root.join("_Playlists/Latin.m3u8");
  let bytes = b"#EXTM3U\nCaf\xe9 - Someone.mp3\n".to_vec();
  std::fs::write(&bad, &bytes).unwrap();
  let some = tracks_in(&lib, "Favourites")[0].clone();
  for op in [
    Op::PlaylistAdd {
      name: "Latin".into(),
      rels: vec![some.clone()],
    },
    Op::PlaylistRemove {
      name: "Latin".into(),
      rels: vec![some.clone()],
    },
    Op::PlaylistCreate { name: "Latin".into() },
    Op::PlaylistDelete { name: "Latin".into() },
  ] {
    let rep = one(&lib, op.clone());
    assert!(rep.applied.is_empty(), "{op:?}: {}", show(&rep));
    assert_eq!(rep.failed.len(), 1, "{op:?}: {}", show(&rep));
    assert_eq!(std::fs::read(&bad).unwrap(), bytes, "{op:?}");
  }
  assert!(entries(&lib).is_empty());
}

#[test]
fn a_legacy_m3u_is_refused_not_shadowed_by_a_new_m3u8() {
  let (_d, lib, _) = fixture_lib(10, false);
  std::fs::write(lib.root.join("_Playlists/Old.m3u"), "#EXTM3U\nx.mp3\n").unwrap();
  let some = tracks_in(&lib, "Favourites")[0].clone();
  let rep = one(
    &lib,
    Op::PlaylistAdd {
      name: "Old".into(),
      rels: vec![some],
    },
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert!(rep.failed[0].error.contains(".m3u"), "{}", show(&rep));
  let rep = one(&lib, Op::PlaylistCreate { name: "old".into() });
  assert_eq!(rep.skipped[0].reason, "playlist already exists");
  assert!(!lib.root.join("_Playlists/Old.m3u8").exists());
}

#[test]
fn playlists_from_folders_creates_only_missing_ones_and_undoes_as_one_change() {
  let dir = tempfile::tempdir().unwrap();
  let spec = soundhood_core::fixtures::FixtureSpec {
    tracks: 20,
    folders: 5,
    playlists: 0,
    messy: false,
  };
  soundhood_core::fixtures::generate(dir.path(), &spec).unwrap();
  let lib = lib_at(dir.path());
  // One folder already has a playlist of its name: it is never overwritten.
  std::fs::create_dir_all(lib.root.join("_Playlists")).unwrap();
  let mine = lib.root.join("_Playlists/ambient.m3u8");
  std::fs::write(&mine, "#EXTM3U\nmine.mp3\n").unwrap();

  let rep = one(&lib, Op::PlaylistsFromFolders);
  assert!(rep.failed.is_empty(), "{}", show(&rep));
  let labels: Vec<&str> = rep.applied.iter().map(|a| a.label.as_str()).collect();
  assert_eq!(
    labels,
    vec![
      "Created playlist Archive",
      "Created playlist Downloads",
      "Created playlist Evenings",
      "Created playlist Studio Takes"
    ]
  );
  assert_eq!(std::fs::read_to_string(&mine).unwrap(), "#EXTM3U\nmine.mp3\n");
  let evenings = playlist::read(&lib.root, "Evenings").unwrap().entries;
  assert!(!evenings.is_empty() && evenings.iter().all(|e| e.starts_with("Evenings/")));
  let last = undo::last_change(&lib).unwrap().unwrap();
  assert_eq!(last.label, "Made 4 playlists from folders");
  assert_eq!(last.count, 4);

  let again = one(&lib, Op::PlaylistsFromFolders);
  assert!(again.applied.is_empty());
  assert_eq!(again.skipped[0].reason, "every folder already has a playlist");

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied.len(), 4, "{}", show(&u));
  let left: Vec<String> = playlist::list(&lib.root).unwrap().into_iter().map(|p| p.name).collect();
  assert_eq!(left, vec!["ambient"]);
}

#[test]
fn undo_of_a_playlist_edit_is_refused_once_the_playlist_changed() {
  let (_d, lib, _) = fixture_lib(20, false);
  let picks = tracks_in(&lib, "Focus");
  let first = one(
    &lib,
    Op::PlaylistAdd {
      name: "Empty".into(),
      rels: vec![picks[0].clone()],
    },
  );
  let second = one(
    &lib,
    Op::PlaylistAdd {
      name: "Empty".into(),
      rels: vec![picks[1].clone()],
    },
  );
  assert_eq!(second.applied.len(), 1);
  let bytes = std::fs::read(lib.root.join("_Playlists/Empty.m3u8")).unwrap();
  let u = undo::undo_batch(&lib, &first.batch).unwrap();
  assert!(u.applied.is_empty(), "{}", show(&u));
  assert_eq!(u.skipped[0].reason, "changed since, not undone");
  assert_eq!(std::fs::read(lib.root.join("_Playlists/Empty.m3u8")).unwrap(), bytes);
}

/// G06: a playlist another program wrote (a BOM, CRLF, `#PLAYLIST` and `#EXTINF` lines, a blank
/// line, a backslash path). The app writes only its own format, so any write would drop that
/// program's lines for good (undo journals the entries only). Adding, removing and deleting the
/// playlist, and moving or deleting a track it lists, are each refused whole with a plain reason;
/// the playlist stays byte-for-byte and the track stays where it is.
#[test]
fn a_playlist_another_program_wrote_is_never_rewritten() {
  let (_d, lib, report) = fixture_lib(10, false);
  let a = rel(&report.tracks[0].rel);
  let b = rel(&report.tracks[1].rel);
  let c = rel(&report.tracks[2].rel);
  let original = format!(
    "\u{feff}#EXTM3U\r\n#PLAYLIST:Foreign\r\n#EXTINF:123,Artist - First\r\n{}\r\n\r\n#EXTINF:200,Artist - Second\r\n{}\r\n",
    a.as_str().replace('/', "\\"),
    b.as_str()
  );
  let file = lib.root.join("_Playlists").join("Foreign.m3u8");
  std::fs::write(&file, &original).unwrap();
  let reason = "the playlist Foreign was written by another program; it was left as it is";
  let b_bytes = read_bytes(&lib, &b);

  let ops = [
    Op::PlaylistAdd {
      name: "Foreign".into(),
      rels: vec![c.clone()],
    },
    Op::PlaylistRemove {
      name: "Foreign".into(),
      rels: vec![a.clone()],
    },
    Op::PlaylistDelete { name: "Foreign".into() },
    Op::Move {
      rel: b.clone(),
      to_folder: "Elsewhere".into(),
    },
    Op::Delete { rel: b.clone() },
  ];
  for op in ops {
    let rep = one(&lib, op);
    assert!(rep.applied.is_empty(), "{}", show(&rep));
    assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
    assert_eq!(rep.failed[0].error, reason, "{}", show(&rep));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), original, "byte-for-byte");
  }
  assert_eq!(read_bytes(&lib, &b), b_bytes, "the track did not move");
  let create = one(&lib, Op::PlaylistCreate { name: "Foreign".into() });
  assert!(
    create.applied.is_empty() && create.failed.is_empty(),
    "{}",
    show(&create)
  );
  assert_eq!(std::fs::read_to_string(&file).unwrap(), original);
  assert!(undo::last_change(&lib).unwrap().is_none(), "nothing was changed");

  // Kept simple and safe: a BOM alone, or CRLF alone, is another program's file too.
  let canonical = playlist::render(&[a.to_string(), b.to_string()]);
  for variant in [format!("\u{feff}{canonical}"), canonical.replace('\n', "\r\n")] {
    std::fs::write(&file, &variant).unwrap();
    let rep = one(
      &lib,
      Op::PlaylistAdd {
        name: "Foreign".into(),
        rels: vec![c.clone()],
      },
    );
    assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), variant);
  }
  // The app's own format is written as before.
  std::fs::write(&file, &canonical).unwrap();
  let rep = one(
    &lib,
    Op::PlaylistAdd {
      name: "Foreign".into(),
      rels: vec![c.clone()],
    },
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
}

/// Undo leaves a playlist alone once another program has rewritten it in its own format, even
/// with the same tracks: it reports why instead of normalising it.
#[test]
fn undo_leaves_a_playlist_another_program_rewrote() {
  let (_d, lib, report) = fixture_lib(10, false);
  let a = rel(&report.tracks[0].rel);
  let add = one(
    &lib,
    Op::PlaylistAdd {
      name: "Mine".into(),
      rels: vec![a.clone()],
    },
  );
  assert_eq!(add.applied.len(), 1, "{}", show(&add));
  let file = lib.root.join("_Playlists").join("Mine.m3u8");
  let theirs = format!("#EXTM3U\r\n#EXTINF:1,x\r\n{a}\r\n");
  std::fs::write(&file, &theirs).unwrap();
  let u = undo::undo_batch(&lib, &add.batch).unwrap();
  assert!(u.applied.is_empty(), "{}", show(&u));
  assert_eq!(
    u.skipped[0].reason,
    "not undone: the playlist Mine was written by another program; it was left as it is"
  );
  assert_eq!(std::fs::read_to_string(&file).unwrap(), theirs);
}
