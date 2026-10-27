//! Tier 1 moves, renames and deletes: no-clobber, the playlist consistency rewrite inside the same
//! batch, lyrics files travelling with their track, the folder-name validator, undo.

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::fs::list_tmp_files;
use soundhood_core::ingest::tagwrite::{apply, ApplyOptions};
use soundhood_core::ingest::{undo, Kind, Op};
use soundhood_core::model::{Library, RelPath};
use soundhood_core::{manifest, playlist};
use std::collections::BTreeMap;
use support::*;

/// Every file under `_Playlists/`, by name, with its bytes.
fn playlist_bytes(lib: &Library) -> BTreeMap<String, Vec<u8>> {
  std::fs::read_dir(lib.root.join("_Playlists"))
    .unwrap()
    .map(|e| e.unwrap())
    .filter(|e| e.file_type().unwrap().is_file())
    .map(|e| {
      (
        e.file_name().to_string_lossy().to_string(),
        std::fs::read(e.path()).unwrap(),
      )
    })
    .collect()
}

/// A Favourites track inside a folder, a different first-level folder to move it to, and two
/// lyrics files next to it.
fn favourite_with_lyrics(lib: &Library) -> (RelPath, String) {
  let fav = playlist::read(&lib.root, "Favourites").unwrap();
  let r = fav
    .entries
    .iter()
    .map(|e| rel(e))
    .find(|r| r.parent().is_some())
    .unwrap();
  let target = ["Evenings", "Ambient"]
    .into_iter()
    .find(|f| r.top_folder() != Some(f))
    .unwrap()
    .to_string();
  let stem = r.file_name().rsplit_once('.').unwrap().0.to_string();
  let dir = lib.abs(&r.parent().unwrap());
  std::fs::write(dir.join(format!("{stem}.lrc")), "[00:01.00]la la\n").unwrap();
  std::fs::write(dir.join(format!("{stem}.txt")), "la la\n").unwrap();
  (r, target)
}

fn companion(r: &RelPath, ext: &str) -> RelPath {
  let stem = r.file_name().rsplit_once('.').unwrap().0;
  match r.parent() {
    Some(p) => p.join(&format!("{stem}.{ext}")).unwrap(),
    None => rel(&format!("{stem}.{ext}")),
  }
}

#[test]
fn a_move_carries_playlists_and_lyrics_and_undo_puts_everything_back() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, target) = favourite_with_lyrics(&lib);
  let lists_before = playlist_bytes(&lib);
  let manifest_before = manifest::build(&lib.root).unwrap();
  let fav_before = playlist::read(&lib.root, "Favourites").unwrap().entries;
  let pos = fav_before.iter().position(|e| e == r.as_str()).unwrap();
  let audio = read_bytes(&lib, &r);
  let lrc = read_bytes(&lib, &companion(&r, "lrc"));

  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: format!(" {target} "),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert!(rep.failed.is_empty() && rep.skipped.is_empty());
  let to = rel(&format!("{target}/{}", r.file_name()));
  assert_eq!(rep.applied[0].label, format!("Moved {} to {target}", r.file_name()));
  assert_eq!(rep.applied[0].path_after.as_deref(), Some(to.as_str()));
  assert!(!lib.abs(&r).exists());
  assert_eq!(read_bytes(&lib, &to), audio);
  assert_eq!(read_bytes(&lib, &companion(&to, "lrc")), lrc, "lyrics followed");
  assert!(lib.abs(&companion(&to, "txt")).is_file());
  assert!(!lib.abs(&companion(&r, "lrc")).exists());
  let fav_after = playlist::read(&lib.root, "Favourites").unwrap().entries;
  assert_eq!(fav_after[pos], to.as_str(), "replaced in place");
  assert_eq!(fav_after.len(), fav_before.len());
  for pl in playlist::list(&lib.root).unwrap() {
    assert!(
      !pl.entries.iter().any(|e| e == r.as_str()),
      "{} still names the old path",
      pl.name
    );
  }
  assert!(list_tmp_files(&lib.root).unwrap().is_empty());

  let journal = entries(&lib);
  let moved = journal.iter().find(|e| e.path_before.as_ref() == Some(&r)).unwrap();
  assert_eq!(moved.kind, Kind::Move);
  assert!(moved.committed);
  assert!(moved.playlists_touched.iter().any(|p| p.name == "Favourites"));
  assert!(moved.playlists_touched.iter().all(|p| p.after_hash.is_some()));
  assert_eq!(
    journal.iter().filter(|e| e.batch == rep.batch && e.committed).count(),
    3,
    "the track and its two lyrics files"
  );
  let last = undo::last_change(&lib).unwrap().unwrap();
  assert_eq!(last.label, format!("Moved {} to {target}", r.file_name()));
  assert_eq!(last.count, 1, "lyrics files are not counted as changes of their own");

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
  assert!(u
    .applied
    .iter()
    .any(|a| a.label.starts_with(&format!("Moved {} back to", r.file_name()))));
  assert_eq!(read_bytes(&lib, &r), audio);
  assert_eq!(read_bytes(&lib, &companion(&r, "lrc")), lrc);
  assert!(lib.abs(&companion(&r, "txt")).is_file());
  assert!(!lib.abs(&to).exists());
  assert_eq!(playlist_bytes(&lib), lists_before, "every playlist byte-identical");
  assert!(manifest::diff(&manifest_before, &manifest::build(&lib.root).unwrap()).is_empty());
}

#[test]
fn a_move_never_overwrites_and_refuses_bad_folder_names() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, target) = favourite_with_lyrics(&lib);
  let lists = playlist_bytes(&lib);
  let check_nothing_changed = |why: &str| {
    assert!(lib.abs(&r).is_file(), "{why}");
    assert_eq!(playlist_bytes(&lib), lists, "{why}");
    assert!(entries(&lib).is_empty(), "{why}: nothing journaled");
  };

  // A file of that name (in another case) is already there.
  let taken = lib.root.join(&target).join(r.file_name().to_uppercase());
  std::fs::write(&taken, b"someone else").unwrap();
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: target.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert_eq!(
    rep.failed[0].error,
    format!("{} already exists in {target}", r.file_name())
  );
  assert_eq!(std::fs::read(&taken).unwrap(), b"someone else");
  check_nothing_changed("taken name");
  std::fs::remove_file(&taken).unwrap();

  // Only its lyrics file's name is taken: the track does not move without it.
  let lrc_there = lib.root.join(&target).join(companion(&r, "lrc").file_name());
  std::fs::write(&lrc_there, b"other lyrics").unwrap();
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: target.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert!(rep.failed[0].error.contains(".lrc already exists"), "{}", show(&rep));
  check_nothing_changed("taken lyrics name");
  std::fs::remove_file(&lrc_there).unwrap();

  // Into the folder it is already in (the old host's answer: already exists there).
  let own = r.top_folder().unwrap().to_string();
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: own.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(
    rep.failed[0].error,
    format!("{} already exists in {own}", r.file_name())
  );
  check_nothing_changed("same folder");

  for bad in [
    "",
    "..",
    ".",
    ".hidden",
    "a/b",
    "a\\b",
    "CON",
    "nul.txt",
    "Rock.",
    "_Playlists",
    "_soundhood",
    "x?",
  ] {
    let rep = apply(
      &lib,
      vec![Op::Move {
        rel: r.clone(),
        to_folder: bad.to_string(),
      }],
      &ApplyOptions::default(),
    );
    assert_eq!(rep.failed.len(), 1, "{bad:?}: {}", show(&rep));
    check_nothing_changed(bad);
  }
  assert!(!lib.root.join("CON").exists() && !lib.root.join(".hidden").exists());
}

#[test]
fn a_move_is_refused_while_a_playlist_cannot_be_read() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, target) = favourite_with_lyrics(&lib);
  let bad = lib.root.join("_Playlists/Latin.m3u8");
  std::fs::write(&bad, b"#EXTM3U\nCaf\xe9.mp3\n").unwrap();
  let lists = playlist_bytes(&lib);
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: target,
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert!(
    rep.failed[0].error.contains("playlists could not be read"),
    "{}",
    show(&rep)
  );
  assert!(lib.abs(&r).is_file(), "not moved");
  assert_eq!(
    playlist_bytes(&lib),
    lists,
    "no playlist written, the unreadable one least of all"
  );
}

#[test]
fn renames_follow_playlists_and_allow_a_case_change() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite_with_lyrics(&lib);
  let dir = r.parent().unwrap();
  let ext = r.file_name().rsplit_once('.').unwrap().1;
  let to = dir.join(&format!("Renamed - Somebody.{ext}")).unwrap();
  let rep = apply(
    &lib,
    vec![Op::Rename {
      rel: r.clone(),
      to: to.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(
    rep.applied[0].label,
    format!("Renamed {} to {}", r.file_name(), to.file_name())
  );
  assert!(
    lib.abs(&companion(&to, "lrc")).is_file(),
    "lyrics renamed with the track"
  );
  assert!(playlist::read(&lib.root, "Favourites")
    .unwrap()
    .entries
    .iter()
    .any(|e| e == to.as_str()));

  // Only the case changes: allowed, the file keeps its bytes.
  let upper = dir.join(&to.file_name().to_uppercase()).unwrap();
  let rep = apply(
    &lib,
    vec![Op::Rename {
      rel: to.clone(),
      to: upper.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  let names: Vec<String> = std::fs::read_dir(lib.abs(&dir))
    .unwrap()
    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
    .collect();
  assert!(names.contains(&upper.file_name().to_string()), "{names:?}");

  // A target that would leave the library's tracks: not an audio name, or inside the app folders.
  for bad in ["x.lrc", "_Playlists/x.ogg", "a/.hidden/x.ogg", "CON.ogg"] {
    let rep = apply(
      &lib,
      vec![Op::Rename {
        rel: upper.clone(),
        to: rel(bad),
      }],
      &ApplyOptions::default(),
    );
    assert_eq!(rep.failed.len(), 1, "{bad}: {}", show(&rep));
  }
  assert!(lib.abs(&upper).is_file());

  // Undo both renames, newest first.
  for _ in 0..2 {
    let last = undo::last_change(&lib).unwrap().unwrap();
    let u = undo::undo_batch(&lib, &last.batch).unwrap();
    assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
  }
  assert!(lib.abs(&r).is_file());
  assert!(lib.abs(&companion(&r, "lrc")).is_file());
  assert!(playlist::read(&lib.root, "Favourites")
    .unwrap()
    .entries
    .iter()
    .any(|e| e == r.as_str()));
}

#[test]
fn a_delete_bins_the_track_its_lyrics_and_its_playlist_lines_and_undo_restores_them() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite_with_lyrics(&lib);
  let lists = playlist_bytes(&lib);
  let manifest_before = manifest::build(&lib.root).unwrap();
  let audio = read_bytes(&lib, &r);

  let rep = apply(&lib, vec![Op::Delete { rel: r.clone() }], &ApplyOptions::default());
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(rep.applied[0].label, format!("Deleted {} (in the bin)", r.file_name()));
  assert!(!lib.abs(&r).exists() && !lib.abs(&companion(&r, "lrc")).exists());
  let e = entries(&lib)
    .into_iter()
    .find(|e| e.path_before.as_ref() == Some(&r))
    .unwrap();
  assert_eq!(e.kind, Kind::Delete);
  let bin = e.bin.clone().expect("where it went");
  let bin_rel = bin.bin_rel.clone().unwrap();
  assert!(bin_rel.as_str().starts_with("_Soundhood/.bin/"));
  assert_eq!(read_bytes(&lib, &bin_rel), audio, "intact in the bin");
  for pl in playlist::list(&lib.root).unwrap() {
    assert!(!pl.entries.iter().any(|x| x == r.as_str()), "{}", pl.name);
  }
  assert_eq!(
    undo::last_change(&lib).unwrap().unwrap().label,
    format!("Deleted {} (in the bin)", r.file_name())
  );

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
  assert!(u
    .applied
    .iter()
    .any(|a| a.label == format!("Restored {} from the bin", r.file_name())));
  assert_eq!(read_bytes(&lib, &r), audio);
  assert!(lib.abs(&companion(&r, "lrc")).is_file());
  assert_eq!(playlist_bytes(&lib), lists, "lines back in place, byte-identical");
  assert!(manifest::diff(&manifest_before, &manifest::build(&lib.root).unwrap()).is_empty());
}

#[test]
fn undoing_a_delete_after_its_playlist_changed_appends_the_track_again() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite_with_lyrics(&lib);
  let rep = apply(&lib, vec![Op::Delete { rel: r.clone() }], &ApplyOptions::default());
  assert_eq!(rep.applied.len(), 1);
  // Favourites changes afterwards: the journaled lines no longer apply as they are.
  let other = rel(&playlist::read(&lib.root, "Focus").unwrap().entries[0]);
  let add = apply(
    &lib,
    vec![Op::PlaylistAdd {
      name: "Favourites".into(),
      rels: vec![other.clone()],
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(add.applied.len(), 1, "{}", show(&add));
  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.failed.is_empty(), "{}", show(&u));
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  assert_eq!(
    fav.last().map(String::as_str),
    Some(r.as_str()),
    "back as a member, at the end"
  );
  assert!(fav.iter().any(|e| e == other.as_str()), "the later change is kept");
}

#[test]
fn a_root_track_named_with_a_hash_keeps_its_playlist_line() {
  let (_d, lib, report) = fixture_lib(10, false);
  let src = track_with_ext(&report, "mp3");
  let hash = rel("#1 Crush - Someone.mp3");
  std::fs::copy(lib.abs(&src), lib.abs(&hash)).unwrap();
  let rep = apply(
    &lib,
    vec![Op::PlaylistAdd {
      name: "Hash Tags".into(),
      rels: vec![hash.clone()],
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  let file = lib.root.join("_Playlists/Hash Tags.m3u8");
  assert_eq!(std::fs::read(&file).unwrap(), b"#EXTM3U\n./#1 Crush - Someone.mp3\n");
  assert_eq!(
    playlist::read(&lib.root, "Hash Tags").unwrap().entries,
    vec![hash.as_str()]
  );

  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: hash.clone(),
      to_folder: "Ambient".into(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(
    std::fs::read(&file).unwrap(),
    b"#EXTM3U\nAmbient/#1 Crush - Someone.mp3\n"
  );
  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
  assert_eq!(std::fs::read(&file).unwrap(), b"#EXTM3U\n./#1 Crush - Someone.mp3\n");
}
