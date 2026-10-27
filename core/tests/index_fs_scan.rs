//! The scan the index runs: one unreadable folder costs that folder, not the whole library.

use soundhood_core::fs;
use std::path::Path;

fn touch(root: &Path, rel: &str) {
  let p = root.join(rel);
  std::fs::create_dir_all(p.parent().unwrap()).unwrap();
  std::fs::write(p, b"x").unwrap();
}

/// Makes `dir` unlistable for the current user; the guard gives the permission back so the
/// tempdir can be removed. `None` when this account can read it anyway (root on Unix).
struct Locked<'a>(&'a Path);

impl<'a> Locked<'a> {
  #[cfg(windows)]
  fn new(dir: &'a Path) -> Option<Locked<'a>> {
    // Deny "list folder" to Everyone (S-1-1-0); the owner can always take the deny back.
    let ok = std::process::Command::new("icacls")
      .arg(dir)
      .args(["/deny", "*S-1-1-0:(RD)"])
      .output()
      .is_ok_and(|o| o.status.success());
    let locked = Locked(dir);
    (ok && std::fs::read_dir(dir).is_err()).then_some(locked)
  }

  #[cfg(unix)]
  fn new(dir: &'a Path) -> Option<Locked<'a>> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o000)).unwrap();
    let locked = Locked(dir);
    std::fs::read_dir(dir).is_err().then_some(locked)
  }
}

impl Drop for Locked<'_> {
  fn drop(&mut self) {
    #[cfg(windows)]
    let _ = std::process::Command::new("icacls")
      .arg(self.0)
      .args(["/remove:d", "*S-1-1-0"])
      .output();
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let _ = std::fs::set_permissions(self.0, std::fs::Permissions::from_mode(0o755));
    }
  }
}

#[test]
fn an_unreadable_folder_is_skipped_and_reported() {
  let d = tempfile::tempdir().unwrap();
  let r = d.path();
  touch(r, "A - Song.mp3");
  touch(r, "Chill/B - Song.m4a");
  touch(r, "System Volume Information/tracking.log");
  touch(r, "Zed/C - Song.flac");
  let protected = r.join("System Volume Information");
  let Some(_lock) = Locked::new(&protected) else {
    eprintln!("this account can read any folder; nothing to test");
    return;
  };

  let (stamps, skipped) = fs::scan_report(r).unwrap();
  let rels: Vec<&str> = stamps.iter().map(|s| s.rel.as_str()).collect();
  assert_eq!(rels, ["A - Song.mp3", "Chill/B - Song.m4a", "Zed/C - Song.flac"]);
  assert_eq!(skipped.len(), 1, "{skipped:?}");
  assert!(skipped[0].starts_with("System Volume Information: "), "{skipped:?}");
  // The root-relative form only: no absolute path in what gets logged.
  assert!(!skipped[0].contains(&*r.to_string_lossy()), "{skipped:?}");
  // scan() is the same list without the report.
  assert_eq!(fs::scan(r).unwrap(), stamps);
}

#[test]
fn only_the_root_itself_is_an_error() {
  let d = tempfile::tempdir().unwrap();
  assert!(fs::scan_report(&d.path().join("missing")).is_err());
  let file = d.path().join("song.mp3");
  std::fs::write(&file, b"x").unwrap();
  let err = fs::scan_report(&file).unwrap_err();
  assert!(err.to_string().contains("not a folder"), "{err}");

  let root = d.path().join("root");
  std::fs::create_dir(&root).unwrap();
  touch(&root, "a.mp3");
  if let Some(_lock) = Locked::new(&root) {
    assert!(
      fs::scan_report(&root).is_err(),
      "an unreadable root has no partial result"
    );
  };
}
