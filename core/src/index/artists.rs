//! Splitting an artist tag into credited artists, and folding names for matching.
//!
//! House rule (DECISIONS, Phase 0, `meta.artist_convention = "comma-all"`): credited artists are
//! joined with `", "`; `;` and `/` also separate; `feat.` / `ft.` (and `feat` / `ft` /
//! `featuring`) start the featured artists. `&`, `and` and `x` are part of names, never joiners
//! (`Harlow & Pine` is one artist).

use std::collections::HashSet;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// How an artist is credited on a track (`track_artists.role`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
  Main,
  Featured,
}

impl Role {
  /// The `track_artists.role` value.
  pub fn as_str(self) -> &'static str {
    match self {
      Role::Main => "main",
      Role::Featured => "featured",
    }
  }
}

/// The credited artists of one artist tag, in order, main artists first. Names are trimmed and
/// keep their spelling; a name that folds equal to an earlier one is dropped.
pub fn split_artists(tag: &str) -> Vec<(String, Role)> {
  let (main, featured) = split_featured(tag);
  let mut seen = HashSet::new();
  let mut out = Vec::new();
  for (part, role) in [(main, Role::Main), (featured, Role::Featured)] {
    for name in split_names(part) {
      if seen.insert(fold_name(name)) {
        out.push((name.to_string(), role));
      }
    }
  }
  out
}

/// The matching form of a name: NFC, lower-case, diacritics removed (`Beyoncé` -> `beyonce`).
/// Unique per artist in the index (`artists.name_folded`).
pub fn fold_name(name: &str) -> String {
  name
    .trim()
    .to_lowercase()
    .nfd()
    .filter(|c| !is_combining_mark(*c))
    .nfc()
    .collect()
}

const FEAT_WORDS: [&str; 5] = ["featuring", "feat.", "feat", "ft.", "ft"];

/// `("A, B", "C")` for `"A, B feat. C"`. A marker counts only as a whole word after a space or an
/// opening bracket and before whitespace; a bracketed credit (`"A (feat. B)"`) loses its brackets.
fn split_featured(tag: &str) -> (&str, &str) {
  let bytes = tag.as_bytes();
  for (i, &b) in bytes.iter().enumerate() {
    let opener = match b {
      b' ' => None,
      b'(' => Some(b')'),
      b'[' => Some(b']'),
      _ => continue,
    };
    let start = i + 1;
    for word in FEAT_WORDS {
      let end = start + word.len();
      // markers are ASCII, so a match starts and ends on char boundaries
      let hit = bytes
        .get(start..end)
        .is_some_and(|w| w.eq_ignore_ascii_case(word.as_bytes()));
      if !hit || !bytes.get(end).is_some_and(|c| c.is_ascii_whitespace()) {
        continue;
      }
      let main = tag[..i].trim();
      let mut featured = tag[end..].trim();
      if let Some(close) = opener {
        if let Some(j) = featured.bytes().position(|c| c == close) {
          featured = featured[..j].trim();
        }
      }
      return (main, featured);
    }
  }
  (tag, "")
}

/// `", "`, `;` and `/` separate names; a comma not followed by whitespace does not (`10,000 Maniacs`).
fn split_names(part: &str) -> Vec<&str> {
  let mut out = Vec::new();
  let mut from = 0;
  let bytes = part.as_bytes();
  for (i, &b) in bytes.iter().enumerate() {
    let sep = match b {
      b';' | b'/' => true,
      b',' => bytes.get(i + 1).is_none_or(|c| c.is_ascii_whitespace()),
      _ => false,
    };
    if sep {
      out.push(&part[from..i]);
      from = i + 1;
    }
  }
  out.push(&part[from..]);
  out.into_iter().map(str::trim).filter(|s| !s.is_empty()).collect()
}

/// The pre-rebuild host's `split_artists`, kept only to reproduce its "known artist" set for the
/// filename fallback exactly: splits on every `,` `/` `;`, then on the first of ` feat. `, ` feat `,
/// ` ft. `, ` ft ` per part (featured name first). Ported char-boundary-safe: the old code applied
/// a byte offset from the lower-cased copy to the original and could panic on names like "ẞ feat. B".
pub(crate) fn legacy_split(artist: &str) -> Vec<String> {
  let mut out = Vec::new();
  for part in artist.split([',', '/', ';']) {
    let mut piece = part.trim();
    for marker in [" feat. ", " feat ", " ft. ", " ft "] {
      let found = piece
        .as_bytes()
        .windows(marker.len())
        .position(|w| w.eq_ignore_ascii_case(marker.as_bytes()));
      if let Some(i) = found {
        let featured = piece[i + marker.len()..].trim();
        piece = piece[..i].trim();
        if !featured.is_empty() {
          out.push(featured.to_string());
        }
        break;
      }
    }
    if !piece.is_empty() {
      out.push(piece.to_string());
    }
  }
  out
}

/// The pre-rebuild filename fallback for an untagged artist: of `"Song - Artist"` (checked first)
/// and `"Artist - Song"`, split on the last `" - "`, the side that is a known artist (lower-cased
/// in `known`), spelled as in the file name; `""` when neither side is.
pub(crate) fn artist_from_filename(name: &str, known: &HashSet<String>) -> String {
  let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
  let Some((left, right)) = stem.rsplit_once(" - ") else {
    return String::new();
  };
  [right.trim(), left.trim()]
    .into_iter()
    .find(|c| !c.is_empty() && known.contains(&c.to_lowercase()))
    .map(str::to_string)
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn names(tag: &str) -> Vec<(String, &'static str)> {
    split_artists(tag).into_iter().map(|(n, r)| (n, r.as_str())).collect()
  }

  fn main(ns: &[&str]) -> Vec<(String, &'static str)> {
    ns.iter().map(|n| (n.to_string(), "main")).collect()
  }

  #[test]
  fn house_split() {
    assert_eq!(names("A, B, C"), main(&["A", "B", "C"]));
    assert_eq!(names("A; B / C"), main(&["A", "B", "C"]));
    assert_eq!(
      names("Mira Velloux feat. Orrin Tal"),
      vec![("Mira Velloux".into(), "main"), ("Orrin Tal".into(), "featured")]
    );
    assert_eq!(
      names("A, B ft. C, D"),
      vec![
        ("A".into(), "main"),
        ("B".into(), "main"),
        ("C".into(), "featured"),
        ("D".into(), "featured")
      ]
    );
    assert_eq!(
      names("A (feat. B) "),
      vec![("A".into(), "main"), ("B".into(), "featured")]
    );
    assert_eq!(names("A FEATURING B")[1], ("B".into(), "featured"));
    // never joiners
    assert_eq!(names("Harlow & Pine"), main(&["Harlow & Pine"]));
    assert_eq!(names("Earth and Fire"), main(&["Earth and Fire"]));
    assert_eq!(names("Kx x Lx"), main(&["Kx x Lx"]));
    // no space after the comma: one name; "Feat" inside a word is not a marker
    assert_eq!(names("10,000 Maniacs"), main(&["10,000 Maniacs"]));
    assert_eq!(names("Featherweight, Softcraft"), main(&["Featherweight", "Softcraft"]));
    assert_eq!(names("A ft"), main(&["A ft"]));
    // duplicates by folded name collapse, first spelling kept
    assert_eq!(names("Beyoncé, BEYONCE"), main(&["Beyoncé"]));
    assert!(names("").is_empty());
    assert!(names(" , ; ").is_empty());
    assert_eq!(names("ẞ feat. B"), vec![("ẞ".into(), "main"), ("B".into(), "featured")]);
  }

  #[test]
  fn folding() {
    assert_eq!(fold_name("Beyoncé"), "beyonce");
    assert_eq!(fold_name("Beyonce\u{301}"), "beyonce");
    assert_eq!(fold_name(" Señora Nube "), "senora nube");
    assert_eq!(fold_name("MÖTLEY CRÜE"), "motley crue");
    assert_eq!(fold_name("Sólveig Rán"), fold_name("solveig ran"));
  }

  #[test]
  fn legacy_split_matches_the_old_host() {
    // Old order: featured before main within a part; slash and bare comma split.
    assert_eq!(legacy_split("A, B / C feat. D"), ["A", "B", "D", "C"]);
    assert_eq!(legacy_split("AC/DC"), ["AC", "DC"]);
    assert_eq!(legacy_split("A (feat. B)"), ["A (feat. B)"]);
    assert_eq!(legacy_split("A feat."), ["A feat."]);
    assert_eq!(legacy_split("İ feat. B"), ["B", "İ"]);
    assert_eq!(legacy_split("ẞ feat. B"), ["B", "ẞ"]);
    assert_eq!(legacy_split("A & B"), ["A & B"]);
  }

  #[test]
  fn filename_fallback_matches_the_old_host() {
    let k = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<HashSet<_>>();
    let known = k(&["artist"]);
    assert_eq!(artist_from_filename("Song - Artist.mp3", &known), "Artist");
    assert_eq!(artist_from_filename("Artist - Song.mp3", &known), "Artist");
    assert_eq!(artist_from_filename("Song - ARTIST.m4a", &known), "ARTIST");
    assert_eq!(artist_from_filename("Song - Unknown.mp3", &known), "");
    assert_eq!(artist_from_filename("Song.mp3", &known), "");
    assert_eq!(artist_from_filename("Song -Artist.mp3", &known), "");
    assert_eq!(artist_from_filename("A - B - C.mp3", &k(&["c"])), "C");
    assert_eq!(artist_from_filename("A - B - C.mp3", &k(&["a - b"])), "A - B");
    assert_eq!(artist_from_filename("A - B - C.mp3", &k(&["a"])), "");
  }
}
