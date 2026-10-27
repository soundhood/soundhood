//! soundhood-tools end to end: fixture library -> manifest -> diff, usage errors, self-test.
#![cfg(feature = "tools")]

use std::path::Path;
use std::process::{Command, Output};

fn tools(args: &[&Path]) -> Output {
  Command::new(env!("CARGO_BIN_EXE_soundhood-tools"))
    .args(args)
    .output()
    .unwrap()
}

fn s(args: &[&str]) -> Output {
  Command::new(env!("CARGO_BIN_EXE_soundhood-tools"))
    .args(args)
    .output()
    .unwrap()
}

fn stdout(o: &Output) -> String {
  String::from_utf8_lossy(&o.stdout).to_string()
}

#[test]
fn fixture_library_manifest_and_diff_round_trip() {
  let t = tempfile::tempdir().unwrap();
  let lib = t.path().join("lib");
  let json = t.path().join("fixture.json");
  let o = tools(&[Path::new("fixture-lib"), &lib, Path::new("--json"), &json]);
  assert_eq!(o.status.code(), Some(0), "{}", String::from_utf8_lossy(&o.stderr));
  assert!(stdout(&o).starts_with("Fixture library: 50 tracks, 5 playlists in "));
  let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
  assert_eq!(v["tracks"].as_array().unwrap().len(), 50);

  let (a, b) = (t.path().join("a.json"), t.path().join("b.json"));
  assert_eq!(tools(&[Path::new("manifest"), &lib, &a]).status.code(), Some(0));
  assert_eq!(tools(&[Path::new("manifest"), &lib, &b]).status.code(), Some(0));
  let o = tools(&[Path::new("diff"), &a, &b]);
  assert_eq!(o.status.code(), Some(0));
  assert_eq!(stdout(&o), "Identical\n");

  let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&a).unwrap()).unwrap();
  assert_eq!(m["files"].as_array().unwrap().len(), 55, "50 tracks + 5 playlists");
  let first = m["files"][0]["rel"].as_str().unwrap().to_string();
  let mut bytes = std::fs::read(lib.join(&first)).unwrap();
  bytes.push(0);
  std::fs::write(lib.join(&first), bytes).unwrap();
  std::fs::remove_file(lib.join("_Playlists").join("Empty.m3u8")).unwrap();
  let c = t.path().join("c.json");
  assert_eq!(tools(&[Path::new("manifest"), &lib, &c]).status.code(), Some(0));
  let o = tools(&[Path::new("diff"), &a, &c]);
  assert_eq!(o.status.code(), Some(1));
  assert_eq!(
    stdout(&o),
    format!("2 files changed:\nchanged: {first}\nremoved: _Playlists/Empty.m3u8\n")
  );
}

#[test]
fn fixture_lib_refuses_a_folder_that_is_not_a_fixture() {
  let t = tempfile::tempdir().unwrap();
  std::fs::write(t.path().join("Song - Artist.mp3"), b"keep me").unwrap();
  let o = tools(&[Path::new("fixture-lib"), t.path()]);
  assert_eq!(o.status.code(), Some(1));
  assert_eq!(std::fs::read(t.path().join("Song - Artist.mp3")).unwrap(), b"keep me");
}

#[test]
fn usage_errors_exit_2() {
  assert_eq!(s(&[]).status.code(), Some(2));
  assert_eq!(s(&["frobnicate"]).status.code(), Some(2));
  assert_eq!(s(&["diff", "only-one.json"]).status.code(), Some(2));
  assert_eq!(s(&["manifest", "a", "b", "--json", "x"]).status.code(), Some(2));
  assert_eq!(s(&["fixture-lib", "dir", "--json"]).status.code(), Some(2));
}

#[test]
fn missing_manifest_file_is_a_failure_not_a_usage_error() {
  let t = tempfile::tempdir().unwrap();
  let o = tools(&[Path::new("diff"), &t.path().join("a.json"), &t.path().join("b.json")]);
  assert_eq!(o.status.code(), Some(1));
}

#[test]
fn self_test_passes() {
  let o = s(&["self-test"]);
  let out = stdout(&o);
  assert_eq!(o.status.code(), Some(0), "{out}");
  assert!(out.lines().all(|l| !l.starts_with("FAIL")), "{out}");
  assert!(out.trim_end().ends_with(" 0 failed"), "{out}");
}
