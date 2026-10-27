//! The change journal: `<root>/_Soundhood/journal/<device-id>/YYYY-MM.jsonl`. Append-only JSON
//! Lines, fsync after every line, one folder per device so two devices never write one file.
//! Readers fold lines by `id`: the last line for an id wins.

use super::JournalEntry;
use crate::error::{Error, Result};
use crate::fs::APP_DIR;
use crate::model::{DeviceId, Library};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// `<root>/_Soundhood/journal`.
fn journal_dir(root: &Path) -> PathBuf {
  root.join(APP_DIR).join("journal")
}

/// The device's own folder. The id becomes a folder name, so anything that could leave the
/// journal folder (a separator, a leading dot) is refused.
fn device_dir(root: &Path, device: &DeviceId) -> Result<PathBuf> {
  let id = device.0.as_str();
  if id.is_empty() || id.starts_with('.') || id.contains(['/', '\\', ':']) || id.chars().any(char::is_control) {
    return Err(Error::InvalidPath(format!("device id cannot name a folder: {id:?}")));
  }
  Ok(journal_dir(root).join(id))
}

/// `YYYY-MM` (UTC) of a unix-milliseconds time: the month file an entry goes to.
fn month_of(ts_ms: i64) -> Result<String> {
  let at = time::OffsetDateTime::from_unix_timestamp(ts_ms.div_euclid(1000)).map_err(Error::other)?;
  at.format(time::macros::format_description!("[year]-[month]"))
    .map_err(Error::other)
}

/// Appends `e` as one line to this device's file for the entry's month and fsyncs it. Only this
/// device's journal is ever written: an entry naming another device is refused.
pub fn append(lib: &Library, e: &JournalEntry) -> Result<()> {
  if e.device != lib.device {
    return Err(Error::Refused(format!(
      "journal entry of device {} written by device {}",
      e.device, lib.device
    )));
  }
  let dir = device_dir(&lib.root, &lib.device)?;
  std::fs::create_dir_all(&dir)?;
  let path = dir.join(format!("{}.jsonl", month_of(e.ts)?));
  let mut line = serde_json::to_string(e)?;
  line.push('\n');
  let mut file = OpenOptions::new().read(true).append(true).create(true).open(&path)?;
  let len = file.metadata()?.len();
  // A crash mid-append can leave a torn last line without its newline: start on a fresh line so
  // the torn bytes cannot swallow this entry too.
  if len > 0 && last_byte(&mut file, len)? != b'\n' {
    line.insert(0, '\n');
  }
  file.write_all(line.as_bytes())?;
  file.sync_all()?;
  if len == 0 {
    // A new month file: make its directory entry durable too (unix; a no-op on Windows).
    let _ = crate::fs::fsync(&dir);
  }
  Ok(())
}

fn last_byte(file: &mut File, len: u64) -> Result<u8> {
  file.seek(SeekFrom::Start(len - 1))?;
  let mut b = [0u8; 1];
  file.read_exact(&mut b)?;
  Ok(b[0])
}

/// This device's entries, folded by id, in the order they were first written (oldest first).
/// A device with no journal yet has no entries.
pub fn read_device(root: &Path, device: &DeviceId) -> Result<Vec<JournalEntry>> {
  let dir = device_dir(root, device)?;
  let mut files = match std::fs::read_dir(&dir) {
    Ok(rd) => rd
      .map(|e| e.map(|e| e.path()))
      .collect::<std::io::Result<Vec<PathBuf>>>()?,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(e) => return Err(e.into()),
  };
  files.retain(|p| p.is_file() && p.extension().is_some_and(|x| x == "jsonl"));
  // YYYY-MM names sort chronologically.
  files.sort();
  let mut lines = Vec::new();
  for f in files {
    lines.extend(read_lines(&f)?);
  }
  Ok(fold(lines))
}

/// Every device's entries (each device folded on its own), oldest first by time.
pub fn read_all(root: &Path) -> Result<Vec<JournalEntry>> {
  let rd = match std::fs::read_dir(journal_dir(root)) {
    Ok(rd) => rd,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(e) => return Err(e.into()),
  };
  let mut out = Vec::new();
  for entry in rd {
    let entry = entry?;
    if !entry.file_type()?.is_dir() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    let Ok(device) = device_dir(root, &DeviceId(name.clone())).map(|_| DeviceId(name)) else {
      continue; // not a folder this module would have written
    };
    out.extend(read_device(root, &device)?);
  }
  // Stable: entries of one device keep their order when times tie.
  out.sort_by_key(|e| e.ts);
  Ok(out)
}

/// The entries of one file. A line that does not parse is skipped: the only one the core can
/// produce is the torn tail of an append that a crash interrupted, which never committed.
fn read_lines(path: &Path) -> Result<Vec<JournalEntry>> {
  let bytes = std::fs::read(path)?;
  Ok(
    bytes
      .split(|b| *b == b'\n')
      .filter(|l| !l.iter().all(u8::is_ascii_whitespace))
      .filter_map(|l| serde_json::from_slice::<JournalEntry>(l).ok())
      .collect(),
  )
}

/// Last line per id wins; ids keep the position of their first line.
fn fold(lines: Vec<JournalEntry>) -> Vec<JournalEntry> {
  let mut at: HashMap<String, usize> = HashMap::new();
  let mut out: Vec<JournalEntry> = Vec::new();
  for e in lines {
    match at.get(&e.id) {
      Some(&i) => out[i] = e,
      None => {
        at.insert(e.id.clone(), out.len());
        out.push(e);
      }
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::ingest::Kind;
  use crate::model::{Platform, RelPath};

  fn lib(root: &Path, device: &str) -> Library {
    Library {
      root: root.to_path_buf(),
      device: DeviceId(device.into()),
      platform: Platform::Android,
    }
  }

  fn entry(l: &Library, id: &str, ts: i64, committed: bool) -> JournalEntry {
    JournalEntry {
      id: id.into(),
      ts,
      device: l.device.clone(),
      kind: Kind::Tags,
      path_before: Some(RelPath::new("a.mp3").unwrap()),
      path_after: Some(RelPath::new("a.mp3").unwrap()),
      tags_before: None,
      tags_after: None,
      file_hash_before: Some("h0".into()),
      file_hash_after: committed.then(|| "h1".to_string()),
      playlists_touched: vec![],
      bin: None,
      source: "user".into(),
      batch: "b".into(),
      label: format!("entry {id}"),
      committed,
      note: None,
    }
  }

  #[test]
  fn append_then_fold_last_line_wins() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path(), "dev-1");
    let ts = 1_761_573_600_000; // 2025-10-27
    append(&l, &entry(&l, "e1", ts, false)).unwrap();
    append(&l, &entry(&l, "e2", ts + 1, false)).unwrap();
    append(&l, &entry(&l, "e1", ts + 2, true)).unwrap();
    let file = d.path().join("_Soundhood/journal/dev-1/2025-10.jsonl");
    let text = std::fs::read_to_string(&file).unwrap();
    assert_eq!(text.lines().count(), 3);
    assert!(text.ends_with('\n'));
    let got = read_device(d.path(), &l.device).unwrap();
    assert_eq!(got.len(), 2);
    assert_eq!(got[0].id, "e1");
    assert!(got[0].committed, "the commit line wins");
    assert_eq!(got[0].file_hash_after.as_deref(), Some("h1"));
    assert_eq!(got[1].id, "e2");
    assert!(!got[1].committed);
  }

  #[test]
  fn a_torn_last_line_is_skipped_and_does_not_swallow_the_next() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path(), "dev-1");
    let ts = 1_761_573_600_000;
    append(&l, &entry(&l, "e1", ts, true)).unwrap();
    let file = d.path().join("_Soundhood/journal/dev-1/2025-10.jsonl");
    let mut f = OpenOptions::new().append(true).open(&file).unwrap();
    f.write_all(b"{\"id\":\"torn\",\"ts\":1").unwrap();
    drop(f);
    append(&l, &entry(&l, "e2", ts + 1, true)).unwrap();
    let ids: Vec<String> = read_device(d.path(), &l.device)
      .unwrap()
      .into_iter()
      .map(|e| e.id)
      .collect();
    assert_eq!(ids, vec!["e1", "e2"]);
  }

  #[test]
  fn months_split_files_and_read_all_merges_devices() {
    let d = tempfile::tempdir().unwrap();
    let pc = lib(d.path(), "pc");
    let phone = lib(d.path(), "phone");
    let oct = 1_761_573_600_000; // 2025-10-27
    let nov = oct + 10 * 24 * 3600 * 1000; // 2025-11-06
    append(&pc, &entry(&pc, "p1", oct, true)).unwrap();
    append(&phone, &entry(&phone, "f1", oct + 5, true)).unwrap();
    append(&pc, &entry(&pc, "p2", nov, true)).unwrap();
    assert!(d.path().join("_Soundhood/journal/pc/2025-11.jsonl").is_file());
    let pc_ids: Vec<String> = read_device(d.path(), &pc.device)
      .unwrap()
      .into_iter()
      .map(|e| e.id)
      .collect();
    assert_eq!(pc_ids, vec!["p1", "p2"]);
    let all: Vec<String> = read_all(d.path()).unwrap().into_iter().map(|e| e.id).collect();
    assert_eq!(all, vec!["p1", "f1", "p2"]);
    assert!(read_device(d.path(), &DeviceId("nobody".into())).unwrap().is_empty());
  }

  #[test]
  fn refuses_another_devices_entry_and_unsafe_ids() {
    let d = tempfile::tempdir().unwrap();
    let l = lib(d.path(), "pc");
    let other = lib(d.path(), "phone");
    assert!(matches!(
      append(&l, &entry(&other, "x", 1, true)),
      Err(Error::Refused(_))
    ));
    let bad = lib(d.path(), "../escape");
    assert!(append(&bad, &entry(&bad, "x", 1, true)).is_err());
    assert!(!d.path().join("_Soundhood").exists());
  }
}
