//! A file or playlist that changes while the write path works on it: the sync client landing the
//! other device's version between the write path's read and its rename. The newer version must
//! never be overwritten; the op is skipped "changed since" instead. Also the 10 s settle rule and
//! the plain, path-free reasons a refusal shows.

#[path = "writepath_support.rs"]
mod support;

use soundhood_core::ingest::tagwrite::{apply, ApplyOptions};
use soundhood_core::ingest::{undo, Op};
use soundhood_core::model::{Library, TagSet};
#[cfg(feature = "fault-injection")]
use soundhood_core::playlist;
use soundhood_core::tags;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use support::*;

fn title(t: &str) -> TagSet {
  TagSet {
    title: Some(t.to_string()),
    ..TagSet::default()
  }
}

fn one(lib: &Library, op: Op) -> soundhood_core::ingest::BatchReport {
  apply(lib, vec![op], &ApplyOptions::default())
}

/// A watcher that runs `swap` once, as soon as a write-path temp appears in `dir` (what a sync
/// client does when the other device's version arrives mid-write). `stop` ends it unfired.
struct Swapper {
  stop: Arc<AtomicBool>,
  fired: Arc<AtomicBool>,
  handle: Option<JoinHandle<()>>,
}

impl Swapper {
  fn arm(dir: PathBuf, swap: impl FnOnce() + Send + 'static) -> Swapper {
    let stop = Arc::new(AtomicBool::new(false));
    let fired = Arc::new(AtomicBool::new(false));
    let (s, f) = (stop.clone(), fired.clone());
    let handle = std::thread::spawn(move || {
      while !s.load(Ordering::SeqCst) {
        let has_tmp = std::fs::read_dir(&dir)
          .map(|rd| {
            rd.flatten()
              .any(|e| e.file_name().to_string_lossy().starts_with(".soundhood-tmp-"))
          })
          .unwrap_or(false);
        if has_tmp {
          swap();
          f.store(true, Ordering::SeqCst);
          return;
        }
      }
    });
    Swapper {
      stop,
      fired,
      handle: Some(handle),
    }
  }

  /// Stops the watcher; true when it swapped.
  fn finish(mut self) -> bool {
    self.stop.store(true, Ordering::SeqCst);
    self.handle.take().unwrap().join().unwrap();
    self.fired.load(Ordering::SeqCst)
  }
}

/// G03: a newer version of the track is renamed over it while its tags are being written (the
/// hidden temp is there, the rename not yet), by a thread watching for the temp the way a sync
/// client lands a file. Before the fix the rename replaced it: the newer version was gone and the
/// journal named only the old one. Now the original is checked again right before the rename: the
/// op is skipped "changed since, not changed" and the newer version stays. (The exact-moment
/// version of this, for every op, is `a_track_replaced_right_before_the_rename_...`.)
#[test]
fn a_newer_version_landing_mid_tag_write_is_never_overwritten() {
  for ext in ["m4a", "mp3", "flac"] {
    // The watcher can miss a short-lived temp when the scheduler is busy; such a run proves
    // nothing, so it is run again.
    let fired = (0..20).any(|_| newer_version_mid_tag_write(ext));
    assert!(fired, "{ext}: the newer version never arrived mid-write");
  }
}

/// One G03 run; false when the watcher never saw the temp.
fn newer_version_mid_tag_write(ext: &str) -> bool {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, ext);
  let abs = lib.abs(&r);
  let other = report
    .tracks
    .iter()
    .map(|t| rel(&t.rel))
    .find(|o| *o != r && o.as_str().ends_with(ext))
    .unwrap();
  let newer = read_bytes(&lib, &other);
  let staged = lib.root.join("newer.bin");
  std::fs::write(&staged, &newer).unwrap();
  let (abs2, staged2) = (abs.clone(), staged.clone());
  let swapper = Swapper::arm(abs.parent().unwrap().to_path_buf(), move || {
    std::fs::rename(&staged2, &abs2).unwrap();
  });
  let rep = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("Edited On This Device"),
    },
  );
  if !swapper.finish() {
    return false;
  }
  // Whenever it landed, it survived: the property the fix is for.
  assert_eq!(std::fs::read(&abs).unwrap(), newer, "{ext}: the newer version survived");
  assert!(rep.failed.is_empty(), "{ext}: {}", show(&rep));
  assert!(temps(&lib.root).is_empty(), "{ext}: the temp is gone");
  // The usual order (it lands while the temp is rewritten and checked, which takes milliseconds):
  // the write is skipped and its pre-image is closed as given up, so the next start does not take
  // it for an interrupted write. A watcher thread scheduled late lands after the rename instead,
  // over our edit, which also loses nothing.
  if rep.applied.is_empty() {
    assert_eq!(rep.skipped[0].reason, "changed since, not changed", "{ext}");
    assert!(
      undo::last_change(&lib).unwrap().is_none(),
      "{ext}: nothing happened to undo"
    );
    let e = entries(&lib).pop().unwrap();
    assert!(!e.committed);
    assert!(
      e.note.as_deref().is_some_and(|n| n.starts_with("not applied: ")),
      "{e:?}"
    );
  }
  true
}

/// The phone's edit arriving through sync: Favourites with one more line, renamed into place.
#[cfg(feature = "fault-injection")]
fn phone_adds_a_line(file: &Path) {
  let mut text = std::fs::read_to_string(file).unwrap();
  text.push_str("Phone/Added On The Phone - Someone.m4a\n");
  let side = file.with_extension("m3u8.proton");
  std::fs::write(&side, text).unwrap();
  std::fs::rename(&side, file).unwrap();
}

/// G04, made exact: the other device's edit of a playlist (one more line) lands between the write
/// path's read and its rename (the `before_replace` hook runs it at that moment). Before the fix
/// the phone's line was lost in 30 of 30 runs. Now the add is skipped "changed since, not changed"
/// and the playlist is exactly the phone's version. (A thread racing the real write cannot make
/// this a stable test: what is left of the window, between the last check and the rename itself,
/// is a few microseconds, and a thread lands in it now and then.)
#[cfg(feature = "fault-injection")]
#[test]
fn a_playlist_edited_meanwhile_is_never_written_over() {
  use soundhood_core::ingest::fault;
  let (_d, lib, report) = fixture_lib(20, false);
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  let newcomer = report
    .tracks
    .iter()
    .map(|t| rel(&t.rel))
    .find(|r| !fav.contains(&r.as_str().to_string()))
    .unwrap();
  let file = lib.root.join("_Playlists").join("Favourites.m3u8");
  let f2 = file.clone();
  fault::once_at("before_replace", &file, move || phone_adds_a_line(&f2));
  let rep = one(
    &lib,
    Op::PlaylistAdd {
      name: "Favourites".into(),
      rels: vec![newcomer.clone()],
    },
  );
  let text = std::fs::read_to_string(&file).unwrap();
  assert!(
    text.contains("Added On The Phone"),
    "the phone's line is kept: {text:?}"
  );
  assert!(
    !text.contains(newcomer.as_str()),
    "nothing of ours was written: {text:?}"
  );
  assert!(rep.applied.is_empty(), "{}", show(&rep));
  assert_eq!(
    (rep.skipped[0].path.as_str(), rep.skipped[0].reason.as_str()),
    ("Favourites", "changed since, not changed")
  );
  assert!(temps(&lib.root).is_empty());
  assert!(undo::last_change(&lib).unwrap().is_none());
}

/// The same inside a move: the playlists naming the track are rewritten after the rename, and one
/// of them changes in between. The move is rolled back (the track goes back, no playlist keeps our
/// line) and reported as skipped; the phone's line is kept.
#[cfg(feature = "fault-injection")]
#[test]
fn a_move_whose_playlist_changes_meanwhile_is_rolled_back() {
  use soundhood_core::ingest::fault;
  let (_d, lib, _) = fixture_lib(20, false);
  let fav = playlist::read(&lib.root, "Favourites").unwrap().entries;
  let r = fav
    .iter()
    .map(|e| rel(e))
    .find(|x| x.top_folder().is_some_and(|f| f != "Evenings"))
    .unwrap();
  let audio = read_bytes(&lib, &r);
  let file = lib.root.join("_Playlists").join("Favourites.m3u8");
  let f2 = file.clone();
  fault::once_at("before_replace", &file, move || phone_adds_a_line(&f2));
  let rep = one(
    &lib,
    Op::Move {
      rel: r.clone(),
      to_folder: "Evenings".into(),
    },
  );
  let text = std::fs::read_to_string(&file).unwrap();
  assert!(text.contains("Added On The Phone"), "{text:?}");
  assert!(
    text.contains(r.as_str()),
    "the line still names the old place: {text:?}"
  );
  assert!(rep.applied.is_empty(), "{}", show(&rep));
  assert_eq!(rep.skipped.len(), 1, "{}", show(&rep));
  assert_eq!(
    rep.skipped[0].reason,
    "the playlist Favourites changed since it was read, so nothing was moved"
  );
  assert_eq!(read_bytes(&lib, &r), audio, "the track is back where it was");
  assert!(!lib.abs(&rel(&format!("Evenings/{}", r.file_name()))).exists());
  assert!(undo::last_change(&lib).unwrap().is_none());
}

/// A newer version arriving between the write path's hash of a track and the rename that edits,
/// moves or bins it (the `before_replace` hook lands it at exactly that moment): every op is
/// skipped "changed since, not changed", the newer version stays where it is and nothing goes to
/// the bin. An undo whose file changed that way says "changed since, not undone".
#[cfg(feature = "fault-injection")]
#[test]
fn a_track_replaced_right_before_the_rename_is_left_alone_by_every_op() {
  use soundhood_core::ingest::fault;
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "ogg");
  let abs = lib.abs(&r);
  let original = read_bytes(&lib, &r);
  let other = report
    .tracks
    .iter()
    .map(|t| rel(&t.rel))
    .find(|o| *o != r && o.as_str().ends_with(".ogg"))
    .unwrap();
  let newer = read_bytes(&lib, &other);
  let land_newer = |lib: &Library| {
    let staged = lib.root.join("newer.bin");
    std::fs::write(&staged, &newer).unwrap();
    let dest = lib.abs(&r);
    let to = dest.clone();
    fault::once_at("before_replace", &dest, move || std::fs::rename(&staged, &to).unwrap());
  };
  for op in [
    Op::WriteTags {
      rel: r.clone(),
      changes: title("Edited On This Device"),
    },
    Op::Move {
      rel: r.clone(),
      to_folder: "Evenings".into(),
    },
    Op::Delete { rel: r.clone() },
  ] {
    std::fs::write(&abs, &original).unwrap();
    age(&abs);
    land_newer(&lib);
    let rep = one(&lib, op);
    assert!(rep.applied.is_empty() && rep.failed.is_empty(), "{}", show(&rep));
    assert_eq!(rep.skipped[0].reason, "changed since, not changed", "{}", show(&rep));
    assert_eq!(std::fs::read(&abs).unwrap(), newer, "the newer version stays");
    assert!(!lib.root.join("_Soundhood/.bin").exists(), "nothing was binned");
    assert!(!lib.abs(&rel(&format!("Evenings/{}", r.file_name()))).exists());
  }
  assert!(temps(&lib.root).is_empty());
  assert!(undo::last_change(&lib).unwrap().is_none(), "nothing happened");

  // Undo: an edit is made, then a newer version lands just as the undo is about to put it back.
  std::fs::write(&abs, &original).unwrap();
  age(&abs);
  let edit = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("Edited On This Device"),
    },
  );
  assert_eq!(edit.applied.len(), 1, "{}", show(&edit));
  land_newer(&lib);
  let u = undo::undo_batch(&lib, &edit.batch).unwrap();
  assert!(u.applied.is_empty(), "{}", show(&u));
  assert_eq!(u.skipped[0].reason, "changed since, not undone");
  assert_eq!(std::fs::read(&abs).unwrap(), newer);
}

/// Brief §8.18: a file that changed in the last 10 s may still be arriving from the other device,
/// so it is left alone ("try again in a moment"). Bytes this device's write path put there itself
/// are not held back: an edit right after an edit works, and so does undo right after an edit.
#[test]
fn a_file_changed_seconds_ago_is_left_alone_unless_the_app_wrote_it() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "m4a");
  // Just arrived through sync: a fresh modification time.
  let fresh = read_bytes(&lib, &r);
  std::fs::write(lib.abs(&r), &fresh).unwrap();
  for op in [
    Op::WriteTags {
      rel: r.clone(),
      changes: title("Too Soon"),
    },
    Op::Move {
      rel: r.clone(),
      to_folder: "Evenings".into(),
    },
    Op::Delete { rel: r.clone() },
  ] {
    let rep = one(&lib, op);
    assert_eq!(rep.skipped.len(), 1, "{}", show(&rep));
    assert_eq!(
      rep.skipped[0].reason,
      "changed a few seconds ago, not changed; try again in a moment"
    );
  }
  assert_eq!(read_bytes(&lib, &r), fresh);

  // Once it has settled, it is edited; the app's own fresh write does not hold the next one back.
  age(&lib.abs(&r));
  let first = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("First"),
    },
  );
  assert_eq!(first.applied.len(), 1, "{}", show(&first));
  let second = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("Second"),
    },
  );
  assert_eq!(second.applied.len(), 1, "{}", show(&second));
  let moved = one(
    &lib,
    Op::Move {
      rel: r.clone(),
      to_folder: "Evenings".into(),
    },
  );
  assert_eq!(moved.applied.len(), 1, "{}", show(&moved));
  let u = undo::undo_batch(&lib, &moved.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  let u = undo::undo_batch(&lib, &second.batch).unwrap();
  assert_eq!(u.applied.len(), 1, "{}", show(&u));
  assert_eq!(tags::read(&lib.abs(&r)).unwrap().title, "First");
}

/// A modification time in the future (a clock that was ahead) says nothing about a sync in
/// progress: the file is not held back forever.
#[test]
fn a_modification_time_in_the_future_does_not_hold_a_file_back() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "mp3");
  let f = std::fs::OpenOptions::new().write(true).open(lib.abs(&r)).unwrap();
  f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(3600))
    .unwrap();
  drop(f);
  let rep = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("From The Future"),
    },
  );
  assert_eq!(rep.applied.len(), 1, "{}", show(&rep));
}

/// A tag write the lossless writer refuses (an ID3v2.3 tag with an iTunes sort-order frame, which
/// lofty's 2.3 writer would drop): the reason is plain words built for this file, never the
/// hidden temp's absolute path or frame names; the technical detail is kept in the journal note of
/// the given-up entry instead.
#[test]
fn a_refused_tag_write_reads_in_plain_words_without_any_path() {
  use lofty::config::WriteOptions;
  use lofty::id3::v2::{Frame, FrameId, Id3v2Tag, TextInformationFrame};
  use lofty::tag::TagExt;
  use lofty::TextEncoding;
  use std::borrow::Cow;
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "mp3");
  let abs = lib.abs(&r);
  // Replace the fixture's tag with a 2.3 tag holding TIT2 and TSOP (written as 2.4 so lofty keeps
  // TSOP, then marked 2.3: below 128 bytes the frame layout is the same).
  let template = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/audio/tone.mp3");
  std::fs::copy(&template, &abs).unwrap();
  let mut tag = Id3v2Tag::new();
  for (id, v) in [("TIT2", "Old Title"), ("TSOP", "Artist, The")] {
    let _ = tag.insert(Frame::Text(TextInformationFrame::new(
      FrameId::Valid(Cow::Borrowed(id)),
      TextEncoding::Latin1,
      v.to_string(),
    )));
  }
  tag.save_to_path(&abs, WriteOptions::default()).unwrap();
  let mut bytes = std::fs::read(&abs).unwrap();
  bytes[3] = 3;
  std::fs::write(&abs, &bytes).unwrap();
  age(&abs);

  let rep = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("New Title"),
    },
  );
  assert!(rep.applied.is_empty() && rep.failed.is_empty(), "{}", show(&rep));
  let reason = &rep.skipped[0].reason;
  assert_eq!(
    reason,
    "some of this file's other tags cannot be kept exactly, so nothing was changed"
  );
  assert_eq!(std::fs::read(&abs).unwrap(), bytes, "untouched");
  let e = entries(&lib).pop().unwrap();
  let note = e.note.unwrap();
  assert!(note.starts_with("not applied: ") && note.contains("TSOP"), "{note}");
  let root = lib.root.to_string_lossy().to_string();
  assert!(!note.contains(&root) && !note.contains(".soundhood-tmp-"), "{note}");
}

/// Every reason and error a batch reports is scrubbed of the library's absolute path, whatever
/// produced it: a failure whose message carries the path shows the file's name instead.
#[test]
fn report_rows_never_carry_the_library_path() {
  let (_d, lib, report) = fixture_lib(10, false);
  let r = track_with_ext(&report, "flac");
  // A file whose tags lofty cannot read: the read error names the absolute path.
  std::fs::write(lib.abs(&r), b"not audio at all, just bytes").unwrap();
  age(&lib.abs(&r));
  let rep = one(
    &lib,
    Op::WriteTags {
      rel: r.clone(),
      changes: title("x"),
    },
  );
  let root = lib.root.to_string_lossy().to_string();
  let all: Vec<&str> = rep
    .failed
    .iter()
    .map(|f| f.error.as_str())
    .chain(rep.skipped.iter().map(|s| s.reason.as_str()))
    .collect();
  assert_eq!(all.len(), 1, "{}", show(&rep));
  assert!(!all[0].contains(&root), "{all:?}");
  assert_eq!(all[0], "its tags could not be read, so nothing was changed");
}
