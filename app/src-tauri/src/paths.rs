//! Small pure path helpers: the library root as a map key, and the home-folder redaction every
//! log line and diagnostics field goes through.

use std::path::{Path, PathBuf};

/// The library root as the UI sent it, without surrounding blanks or trailing separators
/// (`D:\Music\` and `D:\Music` are the same library). A bare drive or `/` keeps its separator.
pub fn clean_root(dir: &str) -> PathBuf {
  let trimmed = dir.trim();
  let stripped = trimmed.trim_end_matches(['/', '\\']);
  if stripped.is_empty() || stripped.ends_with(':') {
    PathBuf::from(trimmed)
  } else {
    PathBuf::from(stripped)
  }
}

/// The key one library root is kept under. Windows paths compare case-insensitively and with
/// either separator, so two spellings of one folder never get two cores (two single writers).
pub fn root_key(root: &Path) -> String {
  let s = root.to_string_lossy();
  if cfg!(windows) {
    s.replace('\\', "/").to_lowercase()
  } else {
    s.into_owned()
  }
}

/// `path` with the user's home folder replaced by `~`, so logs, "Copy log" and diagnostics never
/// carry the account name. The prefix test is case-insensitive on Windows, like its file system.
pub fn tilde(path: &Path, home: Option<&Path>) -> String {
  let text = path.to_string_lossy().into_owned();
  let Some(home) = home else { return text };
  let home = home.to_string_lossy();
  let home = home.trim_end_matches(['/', '\\']);
  if home.is_empty() {
    return text;
  }
  let (Some(head), Some(rest)) = (text.get(..home.len()), text.get(home.len()..)) else {
    return text;
  };
  let same = if cfg!(windows) {
    head.eq_ignore_ascii_case(home)
  } else {
    head == home
  };
  // Only a whole segment counts: C:\Users\user must not turn C:\Users\username\x into ~name\x.
  if same && (rest.is_empty() || rest.starts_with(['/', '\\'])) {
    format!("~{rest}")
  } else {
    text
  }
}

/// `text` with every whole occurrence of the user's home folder replaced by `~`: yt-dlp prints
/// absolute paths ("Destination: ..."), and its output goes into "Copy log". Case-insensitive on
/// Windows (ASCII letters, like `tilde`); a longer folder name (`C:\Users\username` for home
/// `C:\Users\user`) is left alone.
pub fn tilde_in(text: &str, home: Option<&Path>) -> String {
  let Some(home) = home else { return text.to_string() };
  let home = home.to_string_lossy();
  let home = home.trim_end_matches(['/', '\\']);
  if home.is_empty() {
    return text.to_string();
  }
  // ASCII folding keeps byte offsets equal between `text` and `hay`.
  let fold = |s: &str| {
    if cfg!(windows) {
      s.to_ascii_lowercase()
    } else {
      s.to_string()
    }
  };
  let (hay, needle) = (fold(text), fold(home));
  let mut out = String::with_capacity(text.len());
  let mut from = 0;
  while let Some(found) = hay[from..].find(&needle) {
    let start = from + found;
    let end = start + needle.len();
    let whole = matches!(text[end..].chars().next(), None | Some('/' | '\\' | '"' | '\''));
    out.push_str(&text[from..start]);
    out.push_str(if whole { "~" } else { &text[start..end] });
    from = end;
  }
  out.push_str(&text[from..]);
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tilde_in_masks_every_whole_home_folder_in_a_line() {
    let home = Path::new("/home/user");
    assert_eq!(
      tilde_in("[download] Destination: /home/user/Music/a.m4a", Some(home)),
      "[download] Destination: ~/Music/a.m4a"
    );
    assert_eq!(
      tilde_in("Moving \"/home/user/x.webm\" to \"/home/user/x.m4a\"", Some(home)),
      "Moving \"~/x.webm\" to \"~/x.m4a\""
    );
    assert_eq!(tilde_in("/home/username/a", Some(home)), "/home/username/a");
    assert_eq!(tilde_in("no path here", Some(home)), "no path here");
    assert_eq!(tilde_in("/home/user/a", None), "/home/user/a");
  }

  #[cfg(windows)]
  #[test]
  fn tilde_in_ignores_case_on_windows() {
    let home = Path::new(r"C:\Users\User");
    assert_eq!(
      tilde_in(
        r"[ExtractAudio] Destination: c:\users\user\AppData\Roaming\x\Downloads\Ünï.m4a",
        Some(home)
      ),
      r"[ExtractAudio] Destination: ~\AppData\Roaming\x\Downloads\Ünï.m4a"
    );
  }

  #[test]
  fn clean_root_strips_blanks_and_trailing_separators() {
    assert_eq!(clean_root("  /lib/Music/ "), PathBuf::from("/lib/Music"));
    assert_eq!(clean_root("D:\\Music\\\\"), PathBuf::from("D:\\Music"));
    assert_eq!(clean_root("/"), PathBuf::from("/"));
    assert_eq!(clean_root("C:\\"), PathBuf::from("C:\\"));
  }

  #[test]
  fn root_key_folds_spellings_on_windows_only() {
    let a = root_key(Path::new("D:\\Music"));
    let b = root_key(Path::new("d:/music"));
    assert_eq!(a == b, cfg!(windows));
  }

  #[test]
  fn tilde_replaces_only_a_whole_home_prefix() {
    let home = Path::new("/home/user");
    assert_eq!(
      tilde(Path::new("/home/user/.local/x.sqlite"), Some(home)),
      "~/.local/x.sqlite"
    );
    assert_eq!(tilde(Path::new("/home/user"), Some(home)), "~");
    assert_eq!(tilde(Path::new("/home/username/x"), Some(home)), "/home/username/x");
    assert_eq!(tilde(Path::new("/srv/music"), Some(home)), "/srv/music");
    assert_eq!(tilde(Path::new("/home/user/x"), None), "/home/user/x");
    assert_eq!(tilde(Path::new("/home/user/x"), Some(Path::new("/home/user/"))), "~/x");
  }

  #[cfg(windows)]
  #[test]
  fn tilde_ignores_case_on_windows() {
    let home = Path::new(r"C:\Users\User");
    assert_eq!(
      tilde(Path::new(r"c:\users\user\AppData\Roaming\x"), Some(home)),
      r"~\AppData\Roaming\x"
    );
  }
}
