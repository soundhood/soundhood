//! Tier 1 tag writes through the one write path: journal pair, verify, skips, the abort rule, undo.

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::tagwrite::{apply, ApplyOptions};
use soundhood_core::ingest::{undo, Kind, Op};
use soundhood_core::model::TagSet;
use soundhood_core::tags::{self, TagRead};
use soundhood_core::Error;
use support::*;

fn title(t: &str) -> TagSet {
  TagSet {
    title: Some(t.to_string()),
    ..TagSet::default()
  }
}

/// The fields undo must bring back, plus the audio facts a rewrite must not change.
fn essence(t: &TagRead) -> TagRead {
  TagRead {
    bitrate: None,
    sample_rate: None,
    ..t.clone()
  }
}

#[test]
fn a_tag_edit_writes_a_journal_pair_and_undoes_cleanly() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "m4a");
  let abs = lib.abs(&r);
  let original = std::fs::read(&abs).unwrap();
  let before = tags::read(&abs).unwrap();

  let changes = TagSet {
    title: Some("New Title".into()),
    artist: Some(before.artist.clone()), // unchanged: not part of the write
    ..TagSet::default()
  };
  let rep = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes,
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(rep.applied[0].label, format!("Edited tags of {}", r.file_name()));
  assert!(rep.skipped.is_empty() && rep.failed.is_empty() && !rep.aborted);
  let after = tags::read(&abs).unwrap();
  assert_eq!(after.title, "New Title");
  assert_eq!(after.artist, before.artist);
  assert!(temps(&lib.root).is_empty(), "no temp left behind");

  // Three lines, one id: the pre-image before the file was touched; the ready line with the
  // checked copy's hash, right before the rename (what startup recovery needs to tell a crash
  // after the rename from one before it); then the commit.
  let dir = lib.root.join("_Soundhood/journal").join(DEVICE);
  let files: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
  assert_eq!(files.len(), 1);
  let text = std::fs::read_to_string(&files[0]).unwrap();
  let lines: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
  assert_eq!(lines.len(), 3);
  assert!(lines.iter().all(|l| l["id"] == lines[0]["id"]));
  assert_eq!(lines[0]["committed"], false);
  assert_eq!(lines[1]["committed"], false);
  assert_eq!(lines[2]["committed"], true);
  assert_eq!(lines[0]["kind"], "tags");
  assert!(lines[0]["file_hash_after"].is_null());
  assert_eq!(lines[1]["note"], "ready: the checked copy goes in place next");
  assert_eq!(lines[1]["file_hash_after"], lines[2]["file_hash_after"]);
  let e = &entries(&lib)[0];
  assert_eq!(e.kind, Kind::Tags);
  assert_eq!(e.source, "user");
  assert_eq!(e.batch, rep.batch);
  assert_eq!(
    e.file_hash_before.as_deref(),
    Some(blake3::hash(&original).to_hex().as_str())
  );
  assert_eq!(
    e.file_hash_after.as_deref(),
    Some(soundhood_core::fs::file_hash(&abs).unwrap().as_str())
  );
  assert_eq!(e.tags_after, Some(title("New Title")), "only what changed");
  assert_eq!(e.tags_before, Some(tags::tagset_of(&before)), "the full pre-image");

  let last = undo::last_change(&lib).unwrap().expect("a change to undo");
  assert_eq!(last.batch, rep.batch);
  assert_eq!(last.label, format!("Edited tags of {}", r.file_name()));
  assert_eq!(last.count, 1);

  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  assert_eq!(u.applied[0].label, format!("Restored tags of {}", r.file_name()));
  assert_eq!(essence(&tags::read(&abs).unwrap()), essence(&before));
  let undo_entry = entries(&lib).pop().unwrap();
  assert_eq!(undo_entry.source, format!("undo:{}", rep.batch));
  assert!(undo_entry.committed);
  assert!(
    undo::last_change(&lib).unwrap().is_none(),
    "undone, and an undo is not offered"
  );
  assert!(matches!(undo::undo_batch(&lib, &rep.batch), Err(Error::Refused(_))));
}

#[test]
fn every_container_round_trips_through_write_and_undo() {
  let (_d, lib, report) = fixture_lib(10, false);
  for ext in ["m4a", "mp3", "flac", "opus", "ogg"] {
    let r = track_with_ext(&report, ext);
    let abs = lib.abs(&r);
    let before = tags::read(&abs).unwrap();
    let changes = TagSet {
      title: Some("Título Nuevo".into()),
      artist: Some("Someone, Someone Else".into()),
      album: Some(String::new()),
      album_artist: Some("Various".into()),
      genre: Some("Ambient".into()),
      year: Some("1999".into()),
      comment: Some("https://example.invalid/x".into()),
    };
    let rep = apply(
      &lib,
      vec![Op::WriteTags {
        rel: r.clone(),
        changes,
      }],
      &ApplyOptions::default(),
    );
    assert_eq!(rep.applied.len(), 1, "{ext}: {}", show(&rep));
    let after = tags::read(&abs).unwrap();
    assert_eq!(
      (after.title.as_str(), after.artist.as_str(), after.album.as_str()),
      ("Título Nuevo", "Someone, Someone Else", ""),
      "{ext}"
    );
    assert_eq!(after.album_artist, "Various", "{ext}");
    assert_eq!(after.year, "1999", "{ext}");
    assert_eq!(after.art_hash, before.art_hash, "{ext}: the cover survives");
    let note = entries(&lib).pop().unwrap().note;
    if ext == "opus" {
      assert!(note.is_some_and(|n| n.contains("decode check skipped")), "{ext}");
    } else {
      assert_eq!(note, None, "{ext}: symphonia decoded the rewrite");
    }
    let u = undo::undo_batch(&lib, &rep.batch).unwrap();
    assert_eq!(u.applied.len(), 1, "{ext}: {}", show(&u));
    assert_eq!(essence(&tags::read(&abs).unwrap()), essence(&before), "{ext}");
  }
  assert!(temps(&lib.root).is_empty());
}

#[test]
fn unchanged_values_are_no_change_and_write_nothing() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "mp3");
  let bytes = read_bytes(&lib, &r);
  let current = tags::read(&lib.abs(&r)).unwrap();
  let rep = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: title(&format!("  {}  ", current.title)),
    }],
    &ApplyOptions::default(),
  );
  assert!(rep.applied.is_empty() && rep.failed.is_empty());
  assert_eq!(rep.skipped.len(), 1);
  assert_eq!(rep.skipped[0].reason, "no change");
  assert_eq!(read_bytes(&lib, &r), bytes);
  assert!(entries(&lib).is_empty(), "nothing journaled");
  assert!(undo::last_change(&lib).unwrap().is_none());
}

#[test]
fn the_track_playing_now_and_non_tracks_are_refused() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "flac");
  let bytes = read_bytes(&lib, &r);
  let opts = ApplyOptions {
    source: "user".into(),
    protected: vec![rel(&r.as_str().to_uppercase())],
  };
  let rep = apply(
    &lib,
    vec![
      Op::WriteTags {
        rel: r.clone(),
        changes: title("x"),
      },
      Op::WriteTags {
        rel: rel("_Playlists/Favourites.m3u8"),
        changes: title("x"),
      },
      Op::WriteTags {
        rel: rel(".soundhood-fixture"),
        changes: title("x"),
      },
    ],
    &opts,
  );
  assert_eq!(rep.skipped.len(), 1, "{}", show(&rep));
  assert_eq!(rep.skipped[0].reason, "playing now");
  assert_eq!(rep.failed.len(), 2, "{}", show(&rep));
  assert!(!rep.aborted, "refusals do not count toward the abort rule");
  assert_eq!(read_bytes(&lib, &r), bytes);
  assert!(entries(&lib).is_empty());
}

/// lofty stores a title containing NUL as two values and reads back the first, so the verify step
/// sees a different title: a dependable way to make the check of a rewritten copy fail.
fn failing_write(r: &soundhood_core::RelPath) -> Op {
  Op::WriteTags {
    rel: r.clone(),
    changes: title("broken\u{0}title"),
  }
}

#[test]
fn three_failed_checks_in_a_row_abort_the_batch_and_leave_every_file_untouched() {
  let (_d, lib, report) = fixture_lib(30, false);
  let mp3s: Vec<_> = report
    .tracks
    .iter()
    .filter(|t| t.rel.ends_with(".mp3"))
    .map(|t| rel(&t.rel))
    .collect();
  assert!(mp3s.len() >= 5);
  let before: Vec<Vec<u8>> = mp3s.iter().map(|r| read_bytes(&lib, r)).collect();

  let ops = vec![
    failing_write(&mp3s[0]),
    failing_write(&mp3s[1]),
    failing_write(&mp3s[2]),
    Op::WriteTags {
      rel: mp3s[3].clone(),
      changes: title("Never Written"),
    },
  ];
  let rep = apply(&lib, ops, &ApplyOptions::default());
  assert!(rep.aborted, "{}", show(&rep));
  assert_eq!(rep.failed.len(), 3, "{}", show(&rep));
  assert!(
    rep.failed.iter().all(|f| f.error.starts_with("not changed")),
    "{}",
    show(&rep)
  );
  assert!(rep.applied.is_empty());
  assert_eq!(rep.skipped.len(), 1);
  assert!(rep.skipped[0].reason.starts_with("not attempted"));
  for (r, b) in mp3s.iter().zip(&before) {
    assert_eq!(&read_bytes(&lib, r), b, "{r} untouched");
  }
  assert!(temps(&lib.root).is_empty(), "every failed temp was removed");

  // A success between failures resets the count.
  let ops = vec![
    failing_write(&mp3s[0]),
    failing_write(&mp3s[1]),
    Op::WriteTags {
      rel: mp3s[3].clone(),
      changes: title("Written"),
    },
    failing_write(&mp3s[2]),
    failing_write(&mp3s[4]),
  ];
  let rep = apply(&lib, ops, &ApplyOptions::default());
  assert!(!rep.aborted, "{}", show(&rep));
  assert_eq!(rep.failed.len(), 4);
  assert_eq!(rep.applied.len(), 1);
}

#[test]
fn undo_refuses_a_file_changed_since() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "ogg");
  let rep = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: title("Edited"),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1);
  // Someone else edits the file afterwards (a tag editor, a sync from the other device).
  let other = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: title("Edited Again"),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(other.applied.len(), 1);
  let bytes = read_bytes(&lib, &r);
  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert!(u.applied.is_empty(), "{}", show(&u));
  assert_eq!(u.skipped.len(), 1);
  assert_eq!(u.skipped[0].reason, "changed since, not undone");
  assert_eq!(read_bytes(&lib, &r), bytes, "nothing forced");
  assert_eq!(tags::read(&lib.abs(&r)).unwrap().title, "Edited Again");
}

/// The ARTIST values of a FLAC file, every one of them.
fn flac_artists(path: &std::path::Path) -> Vec<String> {
  use lofty::config::ParseOptions;
  use lofty::file::AudioFile;
  let flac = lofty::flac::FlacFile::read_from(&mut std::fs::File::open(path).unwrap(), ParseOptions::new()).unwrap();
  flac
    .vorbis_comments()
    .map(|vc| vc.get_all("ARTIST").map(str::to_string).collect())
    .unwrap_or_default()
}

/// A FLAC with two ARTIST comments (a Picard-tagged library): editing the artist would keep one
/// value, and the journal's one-string pre-image could not bring the second back on undo. So the
/// edit is skipped with a plain reason and the file is untouched; editing the title still works,
/// keeps both artists, and undoes cleanly.
#[test]
fn an_edit_of_a_field_with_several_values_is_refused_whole() {
  use lofty::config::{ParseOptions, WriteOptions};
  use lofty::file::AudioFile;
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "flac");
  let path = lib.abs(&r);
  let mut flac =
    lofty::flac::FlacFile::read_from(&mut std::fs::File::open(&path).unwrap(), ParseOptions::new()).unwrap();
  let mut vc = flac.vorbis_comments().cloned().unwrap_or_default();
  let _ = vc.remove("ARTIST").count();
  vc.push("ARTIST".into(), "First Artist".into());
  vc.push("ARTIST".into(), "Second Artist".into());
  let _ = flac.set_vorbis_comments(vc);
  let mut f = std::fs::OpenOptions::new().read(true).write(true).open(&path).unwrap();
  flac.save_to(&mut f, WriteOptions::default()).unwrap();
  drop(f);
  age(&path);
  let both = vec!["First Artist".to_string(), "Second Artist".to_string()];
  assert_eq!(flac_artists(&path), both);
  let original = read_bytes(&lib, &r);
  let title_before = tags::read(&path).unwrap().title;

  let rep = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: TagSet {
        artist: Some("Edited Artist".into()),
        ..TagSet::default()
      },
    }],
    &ApplyOptions::default(),
  );
  assert!(rep.applied.is_empty() && rep.failed.is_empty(), "{}", show(&rep));
  assert_eq!(rep.skipped.len(), 1, "{}", show(&rep));
  assert_eq!(
    rep.skipped[0].reason,
    "this file has several artist values; edit it in a tag editor so nothing is lost"
  );
  assert_eq!(read_bytes(&lib, &r), original, "untouched");
  assert!(temps(&lib.root).is_empty());
  assert!(undo::last_change(&lib).unwrap().is_none(), "nothing to undo");

  let rep = apply(
    &lib,
    vec![Op::WriteTags {
      rel: r.clone(),
      changes: title("Only The Title"),
    }],
    &ApplyOptions::default(),
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
  assert_eq!(flac_artists(&path), both, "both artists kept");
  let u = undo::undo_batch(&lib, &rep.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  assert_eq!(flac_artists(&path), both);
  assert_eq!(tags::read(&path).unwrap().title, title_before);
}
