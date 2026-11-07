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

/// The library's first-level folders, by name, without the app's own `_Soundhood/` (the first
/// change made creates it, for its journal).
fn top_folders(lib: &Library) -> Vec<String> {
  let mut names: Vec<String> = std::fs::read_dir(&lib.root)
    .unwrap()
    .map(|e| e.unwrap())
    .filter(|e| e.file_type().unwrap().is_dir())
    .map(|e| e.file_name().to_string_lossy().to_string())
    .filter(|name| name != "_Soundhood")
    .collect();
  names.sort();
  names
}

/// A folder typed in another case or Unicode form is the folder that is there, on any disk: the
/// track goes into it and no second folder appears beside it; a move into its own folder spelled
/// another way is refused before anything is written down.
#[test]
fn a_move_goes_into_the_folder_that_is_there_however_it_is_spelled() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, target) = favourite_with_lyrics(&lib);
  let own = r.top_folder().unwrap().to_string();
  assert_ne!(own.to_uppercase(), own);
  let folders = top_folders(&lib);

  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: own.to_uppercase(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert_eq!(
    rep.failed[0].error,
    format!("{} already exists in {own}", r.file_name())
  );
  assert!(lib.abs(&r).is_file());
  assert!(entries(&lib).is_empty(), "nothing journaled");
  assert_eq!(top_folders(&lib), folders);

  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: target.to_lowercase(),
    }],
    &ApplyOptions::default(),
  );
  assert!(rep.failed.is_empty() && rep.skipped.is_empty(), "{}", show(&rep));
  assert_eq!(rep.applied[0].label, format!("Moved {} to {target}", r.file_name()));
  let moved = rel(&format!("{target}/{}", r.file_name()));
  assert!(lib.abs(&moved).is_file());
  assert!(lib.abs(&companion(&moved, "lrc")).is_file(), "the lyrics follow");
  assert_eq!(top_folders(&lib), folders, "no second folder");

  // A folder named in NFD (as one made on a Mac arrives), asked for in NFC.
  let nfd = "Beyonce\u{301}";
  std::fs::create_dir_all(lib.root.join(nfd)).unwrap();
  let folders = top_folders(&lib);
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: moved.clone(),
      to_folder: "Beyonc\u{e9}".into(),
    }],
    &ApplyOptions::default(),
  );
  assert!(rep.failed.is_empty() && rep.skipped.is_empty(), "{}", show(&rep));
  assert!(lib.abs(&rel(&format!("{nfd}/{}", r.file_name()))).is_file());
  assert_eq!(top_folders(&lib), folders, "no NFC twin beside it");

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
  assert!(lib.abs(&moved).is_file(), "undone into the folder it came from");
}

/// Where the disk keeps two folders apart whose names differ only in Unicode form (NTFS, Linux) or
/// case (Linux), they are two folders: a move from one into the other is a move, and a rename that
/// changes only the file name's case stays in place. Where the disk folds them, there is one folder.
#[test]
fn twin_folders_that_exist_side_by_side_are_two_folders() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite_with_lyrics(&lib);
  let (nfd, nfc) = ("Beyonce\u{301}", "Beyonc\u{e9}");
  std::fs::create_dir_all(lib.root.join(nfd)).unwrap();
  std::fs::create_dir_all(lib.root.join(nfc)).unwrap();
  let opts = ApplyOptions::default();
  let mv = |rel: &RelPath, to: &str| {
    apply(
      &lib,
      vec![Op::Move {
        rel: rel.clone(),
        to_folder: to.into(),
      }],
      &opts,
    )
  };
  let rep = mv(&r, nfd);
  assert!(rep.failed.is_empty(), "{}", show(&rep));
  let in_nfd = rel(&format!("{nfd}/{}", r.file_name()));
  assert!(lib.abs(&in_nfd).is_file());

  if top_folders(&lib).iter().filter(|f| f.starts_with("Beyonc")).count() == 2 {
    let rep = mv(&in_nfd, nfc);
    assert!(rep.failed.is_empty() && rep.skipped.is_empty(), "{}", show(&rep));
    assert_eq!(rep.applied[0].label, format!("Moved {} to {nfc}", r.file_name()));
    let in_nfc = rel(&format!("{nfc}/{}", r.file_name()));
    assert!(lib.abs(&in_nfc).is_file() && !lib.abs(&in_nfd).exists());
    assert!(lib.abs(&companion(&in_nfc, "lrc")).is_file(), "the lyrics follow");
    let u = undo::undo_batch(&lib, &rep.batch).unwrap();
    assert!(u.failed.is_empty() && u.skipped.is_empty(), "{}", show(&u));
    assert!(lib.abs(&in_nfd).is_file());

    // Moved over again and the emptied folder deleted: undo would make the twin folder again, so
    // it is skipped (nothing forced), naming what is there, and the track stays where it is.
    let rep = mv(&in_nfd, nfc);
    assert!(rep.failed.is_empty(), "{}", show(&rep));
    std::fs::remove_dir(lib.root.join(nfd)).unwrap();
    let u = undo::undo_batch(&lib, &rep.batch).unwrap();
    assert!(u.failed.is_empty(), "{}", show(&u));
    assert!(
      u.skipped.iter().any(|s| s.reason.starts_with("not undone: ")),
      "{}",
      show(&u)
    );
    assert!(lib.abs(&in_nfc).is_file());
    assert!(!lib.root.join(nfd).exists(), "the twin folder is not made again");
  } else {
    // One folder: into "its own folder" in the other spelling, refused before anything is written.
    let journaled = entries(&lib).len();
    let rep = mv(&in_nfd, nfc);
    assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
    assert_eq!(entries(&lib).len(), journaled);
  }
}

/// A rename that changes only a file name's case or form, onto a spelling a second file in the
/// folder already has (NFC and NFD side by side, on NTFS or Linux), is refused before anything is
/// written down.
#[test]
fn a_case_only_rename_onto_a_twin_file_is_refused_before_the_journal() {
  let (_d, lib, report) = fixture_lib(10, false);
  let src = track_with_ext(&report, "m4a");
  let folder = src.parent().unwrap();
  let (nfc, nfd) = (
    folder.join("Caf\u{e9}.m4a").unwrap(),
    folder.join("Cafe\u{301}.m4a").unwrap(),
  );
  std::fs::copy(lib.abs(&src), lib.abs(&nfc)).unwrap();
  std::fs::copy(lib.abs(&src), lib.abs(&nfd)).unwrap();
  age(&lib.abs(&nfc));
  age(&lib.abs(&nfd));
  let twins = std::fs::read_dir(lib.abs(&folder))
    .unwrap()
    .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("Caf"))
    .count();
  if twins < 2 {
    return; // a disk that normalises names holds one file, so there is no twin
  }
  let rep = apply(
    &lib,
    vec![Op::Rename {
      rel: nfc.clone(),
      to: folder.join("CAF\u{c9}.m4a").unwrap(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.failed.len(), 1, "{}", show(&rep));
  assert!(rep.failed[0].error.contains("already exists"), "{}", show(&rep));
  assert!(entries(&lib).is_empty(), "nothing journaled");
  assert!(lib.abs(&nfc).is_file() && lib.abs(&nfd).is_file());
}

/// Where the disk folds case, a path can name a folder in a spelling the disk no longer uses (it
/// was renamed in case outside the app). A rename of the file name's case alone through that path
/// happens in place: no refusal, no second folder.
#[test]
fn a_case_only_rename_through_another_spelling_of_its_folder_stays_in_place() {
  let (_d, lib, _) = fixture_lib(20, false);
  let (r, _) = favourite_with_lyrics(&lib);
  let folder = r.parent().unwrap().as_str().to_string();
  let stale = folder.to_lowercase();
  if stale == folder || !lib.root.join(&stale).is_dir() {
    return; // a disk that keeps case apart has no such path
  }
  let folders = top_folders(&lib);
  let upper = r.file_name().to_uppercase();
  let rep = apply(
    &lib,
    vec![Op::Rename {
      rel: rel(&format!("{stale}/{}", r.file_name())),
      to: rel(&format!("{stale}/{upper}")),
    }],
    &ApplyOptions::default(),
  );
  assert!(rep.failed.is_empty() && rep.skipped.is_empty(), "{}", show(&rep));
  let names: Vec<String> = std::fs::read_dir(lib.root.join(&folder))
    .unwrap()
    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
    .filter(|n| n.to_uppercase() == upper)
    .collect();
  assert_eq!(names, vec![upper], "renamed in place, no copy left");
  assert_eq!(top_folders(&lib), folders);
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
  // A copy keeps the source's modification time on Windows but not on Linux, where the write path
  // would leave the new file alone as changed a few seconds ago.
  age(&lib.abs(&hash));
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

/// Undo never forces: a move is not reversed over a file that took the old place (and its lyrics
/// stay with it rather than going back alone), and an edit of a file that is gone is skipped.
#[test]
fn undo_never_forces_a_move_back_or_touches_a_missing_file() {
  let (_d, lib, report) = fixture_lib(20, false);
  let (r, target) = favourite_with_lyrics(&lib);
  let rep = apply(
    &lib,
    vec![Op::Move {
      rel: r.clone(),
      to_folder: target.clone(),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  let to = rel(&format!("{target}/{}", r.file_name()));
  std::fs::write(lib.abs(&r), b"a new file in the old place").unwrap();
  let lists = playlist_bytes(&lib);

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.applied.is_empty() && u.failed.is_empty(), "{}", show(&u));
  assert_eq!(u.skipped.len(), 1, "{}", show(&u));
  assert_eq!(
    u.skipped[0].reason,
    format!(
      "not undone: {} already exists in {}",
      r.file_name(),
      r.parent().unwrap()
    )
  );
  assert_eq!(read_bytes(&lib, &r), b"a new file in the old place");
  assert!(lib.abs(&to).is_file());
  assert!(
    lib.abs(&companion(&to, "lrc")).is_file(),
    "the lyrics stay with their track"
  );
  assert!(!lib.abs(&companion(&r, "lrc")).exists());
  assert_eq!(playlist_bytes(&lib), lists);
  assert!(
    undo::last_change(&lib).unwrap().is_some(),
    "nothing was undone, so it is still offered"
  );

  let other = track_with_ext(&report, "flac");
  let edit = apply(
    &lib,
    vec![Op::WriteTags {
      rel: other.clone(),
      changes: soundhood_core::model::TagSet {
        title: Some("Edited".into()),
        ..Default::default()
      },
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(edit.applied.len(), 1);
  let gone = apply(&lib, vec![Op::Delete { rel: other.clone() }], &ApplyOptions::default());
  assert_eq!(gone.applied.len(), 1);
  let u = undo::undo_batch(&lib, &edit.batch).unwrap();
  assert!(u.applied.is_empty() && u.failed.is_empty(), "{}", show(&u));
  assert_eq!(u.skipped[0].reason, "changed since, not undone");
}
