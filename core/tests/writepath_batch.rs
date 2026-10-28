//! Whole batches: the 50-file batch and its undo against a manifest, skips that never abort,
//! orphan cleanup, landing a file from outside the library, undo across devices.

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::tagwrite::{apply, cleanup_orphans, land, ApplyOptions};
use soundhood_core::ingest::{journal, undo, JournalEntry, Kind, Op};
use soundhood_core::model::{DeviceId, Library, RelPath, TagSet};
use soundhood_core::tags::{self, TagRead};
use soundhood_core::{manifest, playlist};
use std::collections::BTreeMap;
use support::*;

/// `Folder/Name.ext` -> `Folder/Name (renamed).ext`.
fn renamed(r: &RelPath) -> RelPath {
  let (stem, ext) = r.file_name().rsplit_once('.').unwrap();
  let name = format!("{stem} (renamed).{ext}");
  match r.parent() {
    Some(p) => p.join(&name).unwrap(),
    None => rel(&name),
  }
}

/// What a tag edit and its undo must leave equal: every editable field and the audio facts.
fn essence(t: &TagRead) -> TagRead {
  TagRead {
    bitrate: None,
    sample_rate: None,
    ..t.clone()
  }
}

/// Every playlist line resolves to a file on disk.
fn assert_playlists_resolve(lib: &Library) {
  for pl in playlist::list(&lib.root).unwrap() {
    for e in &pl.entries {
      assert!(lib.abs(&rel(e)).is_file(), "{}: {e} is missing", pl.name);
    }
  }
}

/// The acceptance batch: 50 changes (tag writes and renames, half each) over a 50-track fixture
/// library with messy names (NFD, all caps, untagged, a duplicate pair, a nested folder), then
/// Undo. Renamed files and every playlist must come back byte-identical, and the manifest may
/// differ only in the files whose tags were rewritten: a tag edit is undone by writing the old
/// values back through the same verified path, and lofty does not reproduce another writer's
/// exact bytes. For those, every tag field and the audio facts must equal the originals.
#[test]
fn fifty_tag_writes_and_renames_then_undo_restore_the_library() {
  let (_d, lib, report) = fixture_lib(50, true);
  let before = manifest::build(&lib.root).unwrap();
  let tracks: Vec<RelPath> = report.tracks.iter().map(|t| rel(&t.rel)).collect();
  assert_eq!(tracks.len(), 50);
  let tags_before: BTreeMap<RelPath, TagRead> = tracks
    .iter()
    .map(|r| (r.clone(), tags::read(&lib.abs(r)).unwrap()))
    .collect();

  let mut ops = Vec::new();
  let mut tagged = Vec::new();
  for (i, r) in tracks.iter().enumerate() {
    if i % 2 == 0 {
      let t = &tags_before[r];
      ops.push(Op::WriteTags {
        rel: r.clone(),
        changes: TagSet {
          title: Some(format!("{} (edited)", t.title)),
          artist: Some(format!("{}, Guest", t.artist)),
          ..TagSet::default()
        },
      });
      tagged.push(r.clone());
    } else {
      ops.push(Op::Rename {
        rel: r.clone(),
        to: renamed(r),
      });
    }
  }
  let rep = apply(&lib, ops, &ApplyOptions::default());
  assert_eq!(rep.applied.len(), 50, "{}", show(&rep));
  assert!(
    rep.failed.is_empty() && rep.skipped.is_empty() && !rep.aborted,
    "{}",
    show(&rep)
  );
  assert!(temps(&lib.root).is_empty());
  assert_playlists_resolve(&lib);
  let during = manifest::build(&lib.root).unwrap();
  let renamed_in_lists = report
    .playlists
    .iter()
    .filter(|p| p.entries.iter().any(|e| !tagged.contains(&rel(e))))
    .count();
  assert_eq!(
    manifest::diff(&before, &during).len(),
    25 + 25 * 2 + renamed_in_lists,
    "25 retagged, 25 renamed (removed + added), every playlist naming a renamed track rewritten"
  );
  let last = undo::last_change(&lib).unwrap().unwrap();
  assert_eq!(last.count, 50);
  assert!(last.label.ends_with(" and 49 more"), "{}", last.label);

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied.len(), 50, "{}", show(&u));
  assert!(
    u.failed.is_empty() && u.skipped.is_empty() && !u.aborted,
    "{}",
    show(&u)
  );
  assert!(temps(&lib.root).is_empty());
  assert_playlists_resolve(&lib);

  let after = manifest::build(&lib.root).unwrap();
  let allowed: Vec<String> = tagged.iter().map(|r| format!("changed: {r}")).collect();
  let diff = manifest::diff(&before, &after);
  let unexpected: Vec<&String> = diff.iter().filter(|d| !allowed.contains(d)).collect();
  assert!(
    unexpected.is_empty(),
    "only tag-rewritten files may differ: {unexpected:?}"
  );
  for r in &tracks {
    assert_eq!(
      essence(&tags::read(&lib.abs(r)).unwrap()),
      essence(&tags_before[r]),
      "{r}: tags and audio facts restored"
    );
  }
  assert!(undo::last_change(&lib).unwrap().is_none());
}

/// Brief 5.2 (b): a 50-file rename batch and its Undo leave the manifest identical.
#[test]
fn fifty_renames_then_undo_leave_the_manifest_identical() {
  let (_d, lib, report) = fixture_lib(50, true);
  let before = manifest::build(&lib.root).unwrap();
  let ops = report
    .tracks
    .iter()
    .map(|t| Op::Rename {
      rel: rel(&t.rel),
      to: renamed(&rel(&t.rel)),
    })
    .collect();
  let rep = apply(&lib, ops, &ApplyOptions::default());
  assert_eq!(rep.applied.len(), 50, "{}", show(&rep));
  assert_ne!(manifest::build(&lib.root).unwrap(), before);
  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied.len(), 50, "{}", show(&u));
  let after = manifest::build(&lib.root).unwrap();
  assert_eq!(manifest::diff(&before, &after), Vec::<String>::new());
  assert_eq!(after, before);
}

/// Brief 5.2 (d): a read-only file and a file another program holds are skipped and reported,
/// not corrupted, and do not abort the batch.
#[test]
fn read_only_and_held_open_files_are_skipped_without_aborting() {
  let (_d, lib, report) = fixture_lib(20, false);
  let rels: Vec<RelPath> = report.tracks.iter().skip(2).take(6).map(|t| rel(&t.rel)).collect();
  let read_only = &rels[0];
  let mut perm = std::fs::metadata(lib.abs(read_only)).unwrap().permissions();
  perm.set_readonly(true);
  std::fs::set_permissions(lib.abs(read_only), perm.clone()).unwrap();
  let ro_bytes = read_bytes(&lib, read_only);

  #[cfg(windows)]
  let held = {
    use std::os::windows::fs::OpenOptionsExt;
    // A player or the Proton client: read access, no FILE_SHARE_DELETE, so no rename over it.
    let f = std::fs::OpenOptions::new()
      .read(true)
      .share_mode(1 /* FILE_SHARE_READ */)
      .open(lib.abs(&rels[1]))
      .unwrap();
    Some((rels[1].clone(), read_bytes(&lib, &rels[1]), f))
  };
  #[cfg(not(windows))]
  let held: Option<(RelPath, Vec<u8>, std::fs::File)> = None;

  let ops = rels
    .iter()
    .map(|r| Op::WriteTags {
      rel: r.clone(),
      changes: TagSet {
        comment: Some("checked".into()),
        ..TagSet::default()
      },
    })
    .collect();
  let rep = apply(&lib, ops, &ApplyOptions::default());
  assert!(!rep.aborted, "{}", show(&rep));
  assert!(rep.failed.is_empty(), "{}", show(&rep));
  let skipped: Vec<(&str, &str)> = rep
    .skipped
    .iter()
    .map(|s| (s.path.as_str(), s.reason.as_str()))
    .collect();
  assert!(skipped.contains(&(read_only.as_str(), "read-only file")), "{skipped:?}");
  assert_eq!(read_bytes(&lib, read_only), ro_bytes);
  if let Some((r, bytes, f)) = held {
    assert!(skipped.contains(&(r.as_str(), "file in use")), "{skipped:?}");
    drop(f);
    assert_eq!(read_bytes(&lib, &r), bytes, "untouched");
    assert_eq!(rep.applied.len(), rels.len() - 2);
  } else {
    assert_eq!(rep.applied.len(), rels.len() - 1);
  }
  assert!(temps(&lib.root).is_empty(), "the in-use temp was removed");
  #[allow(clippy::permissions_set_readonly_false)]
  perm.set_readonly(false);
  std::fs::set_permissions(lib.abs(read_only), perm).unwrap();
}

/// A handle that shares nothing (an exclusive lock) makes even reading the original fail: a tag
/// write, a move and a delete are each skipped as "file in use", the file untouched, nothing
/// counted toward the abort rule.
#[cfg(windows)]
#[test]
fn a_file_held_exclusively_is_skipped_as_in_use() {
  use std::os::windows::fs::OpenOptionsExt;
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "m4a");
  let bytes = read_bytes(&lib, &r);
  let holder = std::fs::OpenOptions::new()
    .read(true)
    .share_mode(0)
    .open(lib.abs(&r))
    .unwrap();
  let ops = [
    Op::WriteTags {
      rel: r.clone(),
      changes: TagSet {
        title: Some("Locked".into()),
        ..TagSet::default()
      },
    },
    Op::Move {
      rel: r.clone(),
      to_folder: "Evenings".into(),
    },
    Op::Delete { rel: r.clone() },
  ];
  for op in ops {
    let rep = apply(&lib, vec![op], &ApplyOptions::default());
    assert!(
      rep.applied.is_empty() && rep.failed.is_empty() && !rep.aborted,
      "{}",
      show(&rep)
    );
    assert_eq!(rep.skipped.len(), 1, "{}", show(&rep));
    assert_eq!(
      (rep.skipped[0].path.as_str(), rep.skipped[0].reason.as_str()),
      (r.as_str(), "file in use")
    );
  }
  drop(holder);
  assert_eq!(read_bytes(&lib, &r), bytes, "untouched");
  assert!(temps(&lib.root).is_empty());
}

fn fake_entry(lib: &Library, id: &str, committed: bool) -> JournalEntry {
  JournalEntry {
    id: id.into(),
    ts: 1_761_573_600_000,
    device: lib.device.clone(),
    kind: Kind::Tags,
    path_before: Some(rel("Ambient/x.m4a")),
    path_after: Some(rel("Ambient/x.m4a")),
    tags_before: None,
    tags_after: None,
    file_hash_before: Some("0".into()),
    file_hash_after: None,
    playlists_touched: vec![],
    bin: None,
    source: "user".into(),
    batch: "b-old".into(),
    label: "Edited tags of x.m4a".into(),
    committed,
    note: None,
  }
}

#[test]
fn startup_cleanup_removes_every_leftover_temp_and_nothing_else() {
  let (_d, lib, report) = fixture_lib(10, false);
  let (a, b, c) = (
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccccccccccc",
  );
  journal::append(&lib, &fake_entry(&lib, a, false)).unwrap();
  journal::append(&lib, &fake_entry(&lib, b, true)).unwrap();
  let put = |p: &str| {
    let abs = lib.abs(&rel(p));
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, b"x").unwrap();
  };
  let orphans = [
    format!("Ambient/.soundhood-tmp-{a}.m4a"),        // its write never committed
    format!("Archive/.soundhood-tmp-{b}.mp3"),        // its write committed: a leftover
    format!("Evenings/.soundhood-tmp-{c}.opus"),      // no entry names it
    format!("_Playlists/.soundhood-tmp-{a}-p0.m3u8"), // a playlist rewrite's temp
  ];
  let keep = [
    "Ambient/notes.soundhood-tmp-x.txt".to_string(),
    "Ambient/.soundhood-other".to_string(),
    format!(".stfolder/.soundhood-tmp-{}", "d".repeat(32)), // inside a dot-folder: never the core's
    // A user's own files that only start with the prefix: not the core's temps, never removed
    // (they used to be deleted for good on every start).
    "Ambient/.soundhood-tmp-My Favourite Song.m4a".to_string(),
    "Ambient/.soundhood-tmp-aaaa.m4a".to_string(),
    format!("Ambient/.soundhood-tmp-{a}-final.m4a"),
  ];
  let mine = read_bytes(&lib, &track_with_ext(&report, "m4a"));
  for p in orphans.iter().chain(keep.iter()) {
    put(p);
  }
  let user_song = lib.abs(&rel("Ambient/.soundhood-tmp-My Favourite Song.m4a"));
  std::fs::write(&user_song, &mine).unwrap();
  let removed = cleanup_orphans(&lib).unwrap();
  let mut removed: Vec<&str> = removed.iter().map(RelPath::as_str).collect();
  removed.sort();
  let mut want: Vec<&str> = orphans.iter().map(String::as_str).collect();
  want.sort();
  assert_eq!(removed, want);
  for p in &keep {
    assert!(lib.abs(&rel(p)).is_file(), "{p} kept");
  }
  assert_eq!(std::fs::read(&user_song).unwrap(), mine, "the user's song is untouched");
  let cleanups: Vec<JournalEntry> = entries(&lib).into_iter().filter(|e| e.kind == Kind::Cleanup).collect();
  assert_eq!(cleanups.len(), 4);
  assert!(cleanups.iter().all(|e| e.committed && e.source == "cleanup"));
  let note = |p: &str| {
    cleanups
      .iter()
      .find(|e| e.path_before.as_ref().map(RelPath::as_str) == Some(p))
      .and_then(|e| e.note.clone())
      .unwrap()
  };
  assert!(note(&orphans[0]).contains("never committed"));
  assert!(note(&orphans[1]).contains("had committed"));
  assert!(note(&orphans[2]).contains("no journal entry"));
  assert!(
    cleanup_orphans(&lib).unwrap().is_empty(),
    "nothing left the second time"
  );
  let last = undo::last_change(&lib).unwrap();
  assert_eq!(
    last.map(|l| l.batch),
    Some("b-old".to_string()),
    "a cleanup is not a change to undo"
  );
}

#[test]
fn landing_copies_checks_and_never_overwrites() {
  let (_d, lib, report) = fixture_lib(10, false);
  let staging = tempfile::tempdir().unwrap();
  let src = track_with_ext(&report, "m4a");
  let staged = staging.path().join("download.m4a");
  std::fs::copy(lib.abs(&src), &staged).unwrap();
  let bytes = std::fs::read(&staged).unwrap();
  let dest = rel("Downloads/New Song - Someone.m4a");

  let rep = land(&lib, &staged, &dest, &ApplyOptions::default());
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(rep.applied[0].label, "Saved New Song - Someone.m4a in Downloads");
  assert_eq!(read_bytes(&lib, &dest), bytes);
  assert!(!staged.exists(), "the staged copy is gone once landed");
  assert!(temps(&lib.root).is_empty());
  let e = entries(&lib).pop().unwrap();
  assert_eq!(e.kind, Kind::Ingest);
  assert_eq!(
    e.file_hash_after.as_deref(),
    Some(blake3::hash(&bytes).to_hex().as_str())
  );

  std::fs::write(&staged, b"another download").unwrap();
  let again = land(
    &lib,
    &staged,
    &rel("downloads/new song - someone.M4A"),
    &ApplyOptions::default(),
  );
  assert_eq!(again.failed.len(), 1, "{}", show(&again));
  assert!(again.failed[0].error.contains("already exists"));
  assert_eq!(read_bytes(&lib, &dest), bytes);
  assert!(staged.exists(), "kept for a retry");
  let bad = land(&lib, &staged, &rel("_Soundhood/x.m4a"), &ApplyOptions::default());
  assert_eq!(bad.failed.len(), 1);

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied[0].label, "Deleted New Song - Someone.m4a (in the bin)");
  assert!(!lib.abs(&dest).exists());
}

#[test]
fn last_change_walks_back_and_counts_an_undo_from_another_device() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "flac");
  let first = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: TagSet {
        title: Some("One".into()),
        ..TagSet::default()
      },
    }],
    &ApplyOptions::default(),
  );
  let second = apply(
    &lib,
    vec![Op::PlaylistCreate { name: "Two".into() }],
    &ApplyOptions::default(),
  );
  assert_eq!(undo::last_change(&lib).unwrap().unwrap().batch, second.batch);

  // The phone (same library, its own journal) undoes the newest batch.
  let phone = Library {
    device: DeviceId("phone".into()),
    ..lib.clone()
  };
  let u = undo::undo_batch(&phone, &second.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  assert!(
    lib.root.join("_Soundhood/journal/phone").is_dir(),
    "written to the phone's own journal"
  );
  assert_eq!(
    undo::last_change(&lib).unwrap().unwrap().batch,
    first.batch,
    "this device sees that its newest change was undone elsewhere"
  );
  assert!(
    undo::last_change(&phone).unwrap().is_none(),
    "the phone made no change of its own"
  );
}

/// Startup recovery looks only at this device's last entry, and never at one the write path gave
/// up on. Each case below is an open tag edit whose journaled checked-copy hash (its ready line)
/// is exactly what the file holds now: only the one that is the last entry and was not given up is
/// finished on record. The same last entry without a ready line never got to its rename, so it is
/// closed as not applied instead, whatever the file shows.
#[test]
fn startup_recovery_finishes_only_an_open_last_entry() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "m4a");
  let edit = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: TagSet {
        title: Some("Edited".into()),
        ..TagSet::default()
      },
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(edit.applied.len(), 1, "{}", show(&edit));
  let template = entries(&lib).pop().unwrap();
  let now = soundhood_core::fs::file_hash(&lib.abs(&r)).unwrap();
  let open = |id: char, note: Option<&str>, ready: Option<&str>| JournalEntry {
    id: id.to_string().repeat(32),
    batch: format!("b-{id}"),
    committed: false,
    file_hash_before: Some("0".repeat(64)),
    file_hash_after: ready.map(str::to_string),
    note: note.map(str::to_string),
    ..template.clone()
  };
  let state = |lib: &Library, id: char| {
    let e = entries(lib)
      .into_iter()
      .find(|e| e.id == id.to_string().repeat(32))
      .unwrap();
    (e.committed, e.source, e.note)
  };
  let ready = Some("ready: the checked copy goes in place next");

  // Given up (its last line says "not applied"): never finished, even as the last entry.
  journal::append(
    &lib,
    &open('a', Some("not applied: changed since, not changed"), Some(&now)),
  )
  .unwrap();
  cleanup_orphans(&lib).unwrap();
  assert!(!state(&lib, 'a').0);

  // Open, but not the last entry: a later change was made after it, so it was not in flight.
  journal::append(&lib, &open('b', ready, Some(&now))).unwrap();
  let later = apply(
    &lib,
    vec![Op::PlaylistCreate { name: "Later".into() }],
    &ApplyOptions::default(),
  );
  assert_eq!(later.applied.len(), 1);
  cleanup_orphans(&lib).unwrap();
  assert!(!state(&lib, 'b').0);

  // Open and last: what a crash right after the rename leaves. Finished, and undoable.
  journal::append(&lib, &open('c', ready, Some(&now))).unwrap();
  cleanup_orphans(&lib).unwrap();
  let (committed, source, _) = state(&lib, 'c');
  assert_eq!((committed, source.as_str()), (true, "recovery"));
  assert_eq!(undo::last_change(&lib).unwrap().unwrap().batch, "b-c");

  // Open and last, but only its pre-image: the crash came before the rename. Closed, once.
  journal::append(&lib, &open('d', None, None)).unwrap();
  cleanup_orphans(&lib).unwrap();
  let (committed, _, note) = state(&lib, 'd');
  assert!(!committed);
  assert_eq!(note.as_deref(), Some("not applied: interrupted before the change"));
  assert_eq!(undo::last_change(&lib).unwrap().unwrap().batch, "b-c");
}
