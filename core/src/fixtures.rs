//! The fixture library generator (tests, soundhood-tools, the "Use fixture root" switch).
//! Zone: tools. Contract: core/CONTRACT.md.
//!
//! Builds a small, made-up library from the template audio in `core/fixtures/audio`: tagged tracks
//! in five formats, square aqua / purple / greyscale covers, first-level folders, house-format
//! playlists and a handful of deliberately messy names. Deterministic: the same spec yields the
//! same bytes on every run (no randomness, no clock). This is fixture *creation*, not a write into
//! a user library: it refuses any non-empty folder that lacks the `.soundhood-fixture` marker it
//! leaves behind, and only ever writes into such a folder.

use crate::error::{Error, Result};
use crate::ingest::tagwrite::{self, ApplyOptions};
use crate::ingest::{undo, BatchReport, Op};
use crate::model::{DeviceId, Library, Platform, PlaylistFile, RelPath, TagSet, Track};
use crate::{manifest, playlist, tags, ytdlp};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, Rgb, RgbImage};
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::id3::v2::{Frame, Id3v2Tag};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, ItemKey, Tag, TagExt, TagType};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// File the generator leaves in the fixture root; its presence is what allows a re-generation.
pub const MARKER: &str = ".soundhood-fixture";

/// The neutral absolute root `export_json` reports track paths under.
pub const JSON_ROOT: &str = "C:/Music";

/// Template audio: 3 s, 440 Hz, untagged (see `core/fixtures/audio/README.md`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
  M4a,
  Mp3,
  Flac,
  Opus,
  Ogg,
}

const FORMATS: [Format; 5] = [Format::M4a, Format::Mp3, Format::Flac, Format::Opus, Format::Ogg];

impl Format {
  pub fn ext(self) -> &'static str {
    match self {
      Format::M4a => "m4a",
      Format::Mp3 => "mp3",
      Format::Flac => "flac",
      Format::Opus => "opus",
      Format::Ogg => "ogg",
    }
  }

  fn template(self) -> &'static [u8] {
    match self {
      Format::M4a => include_bytes!("../fixtures/audio/tone.m4a"),
      Format::Mp3 => include_bytes!("../fixtures/audio/tone.mp3"),
      Format::Flac => include_bytes!("../fixtures/audio/tone.flac"),
      Format::Opus => include_bytes!("../fixtures/audio/tone.opus"),
      Format::Ogg => include_bytes!("../fixtures/audio/tone.ogg"),
    }
  }
}

/// Embedded cover colour. Purple is only ever PNG: JPEG chroma noise around `#8c19ff` can drift
/// into the blue band the UI blue-scan rejects.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Cover {
  /// `#00ffbf`
  Aqua,
  /// `#8c19ff`
  Purple,
  /// A neutral grey of this level.
  Grey(u8),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ImageKind {
  Png,
  Jpeg,
}

/// Cover per track index, cycling; `None` = no art (the "Missing art" view needs some).
const COVERS: [Option<(Cover, ImageKind)>; 7] = [
  Some((Cover::Aqua, ImageKind::Png)),
  Some((Cover::Purple, ImageKind::Png)),
  Some((Cover::Grey(0x3a), ImageKind::Png)),
  None,
  Some((Cover::Aqua, ImageKind::Jpeg)),
  Some((Cover::Grey(0x70), ImageKind::Jpeg)),
  Some((Cover::Grey(0xb4), ImageKind::Png)),
];

// Every name below is invented for the fixture library.
const TITLE_A: [&str; 10] = [
  "Glass", "Paper", "Velvet", "Neon", "Quiet", "Silver", "Hollow", "Amber", "Static", "Lunar",
];
const TITLE_B: [&str; 10] = [
  "Tide", "Comets", "Engine", "Harbor", "Orchard", "Bloom", "Signal", "Ferry", "Garden", "Lanterns",
];
const ARTISTS: [&str; 12] = [
  "Orla Paperwind",
  "Mira Velloux",
  "Orrin Tal",
  "The Quiet Engines",
  "Sola Brakke",
  "Neon Pilgrim",
  "Ilse Marrow",
  "Teodor Fenn",
  "Velvet Ferry",
  "Kestrel Nine",
  "Anouk Lirr",
  "Glasshouse Tide",
];
const ALBUMS: [&str; 7] = [
  "Night Ferry Sessions",
  "Paper Weather",
  "Harbor Lights",
  "Signal & Noise",
  "Lantern Season",
  "Low Orchard",
  "Amber Tapes",
];
const GENRES: [&str; 5] = ["Ambient", "Electronic", "Indie", "Jazz", "Synthpop"];
const FOLDERS: [&str; 8] = [
  "Ambient",
  "Archive",
  "Downloads",
  "Evenings",
  "Studio Takes",
  "Live",
  "Singles",
  "Workbench",
];
const PLAYLISTS: [&str; 5] = ["Favourites", "Focus", "Late Night", "Mixed Formats", "Empty"];
/// A made-up 11-character video id for the "[id]" junk name.
const FAKE_VIDEO_ID: &str = "Xk3vQ9pLm2A";

/// What to generate. `Default` is the library the Playwright harness and the evidence screenshots
/// use: 50 tracks, 5 folders, 5 playlists, messy names on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FixtureSpec {
  pub tracks: usize,
  /// First-level folders (1..=8). Tracks 0 and 1 always sit in the root.
  pub folders: usize,
  /// Playlists (0..=5), in the order Favourites, Focus, Late Night, Mixed Formats, Empty.
  pub playlists: usize,
  /// Messy names: YouTube junk, `[id]`, ALL CAPS, missing artist, NFD, untagged, a duplicate pair,
  /// a nested folder.
  pub messy: bool,
}

impl Default for FixtureSpec {
  fn default() -> Self {
    FixtureSpec {
      tracks: 50,
      folders: 5,
      playlists: 5,
      messy: true,
    }
  }
}

/// One generated track: what was written, not what a scanner would infer.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct FixtureTrack {
  /// Root-relative path exactly as on disk, forward slashes (NFD for the NFD fixture).
  pub rel: String,
  /// Tag values written ("" = not written).
  pub title: String,
  pub artist: String,
  pub album: String,
  pub format: Format,
  pub cover: Option<Cover>,
  /// Read back from the written file (truncated seconds, like the old host).
  pub duration_secs: u64,
  /// Why this track is unusual, or "" for an ordinary one.
  pub note: String,
}

/// The receipt of one generation.
#[derive(Serialize, Clone, Debug)]
pub struct FixtureReport {
  pub root: PathBuf,
  pub tracks: Vec<FixtureTrack>,
  pub playlists: Vec<PlaylistFile>,
}

/// One planned file (pure; `plan` has no I/O).
#[derive(Clone, Debug)]
struct Planned {
  rel: String,
  title: String,
  artist: String,
  album: String,
  genre: &'static str,
  year: String,
  track_no: u32,
  format: Format,
  cover: Option<(Cover, ImageKind)>,
  /// Cover inset margin in px, so covers of one colour still differ between tracks.
  inset: u32,
  tagged: bool,
  copy_of: Option<usize>,
  note: &'static str,
}

fn plan(spec: &FixtureSpec) -> Result<Vec<Planned>> {
  if spec.tracks == 0 || spec.tracks > 1000 {
    return Err(Error::Refused(format!(
      "fixture tracks must be 1..=1000, not {}",
      spec.tracks
    )));
  }
  if spec.folders == 0 || spec.folders > FOLDERS.len() {
    return Err(Error::Refused(format!(
      "fixture folders must be 1..={}, not {}",
      FOLDERS.len(),
      spec.folders
    )));
  }
  if spec.playlists > PLAYLISTS.len() {
    return Err(Error::Refused(format!(
      "fixture playlists must be 0..={}, not {}",
      PLAYLISTS.len(),
      spec.playlists
    )));
  }
  let mut out: Vec<Planned> = Vec::with_capacity(spec.tracks);
  for i in 0..spec.tracks {
    let mut title = format!("{} {}", TITLE_A[i % 10], TITLE_B[(i / 10 + i) % 10]);
    if i >= 100 {
      title = format!("{title} {}", i / 100 + 1);
    }
    let artist = match i {
      9 => "Mira Velloux feat. Orrin Tal".to_string(),
      13 => "Sola Brakke, Teodor Fenn".to_string(),
      _ => ARTISTS[(i * 5) % ARTISTS.len()].to_string(),
    };
    let format = FORMATS[i % FORMATS.len()];
    let folder = if i < 2 { None } else { Some(FOLDERS[i % spec.folders]) };
    let mut p = Planned {
      rel: String::new(),
      title: title.clone(),
      artist: artist.clone(),
      album: ALBUMS[(i / 4) % ALBUMS.len()].to_string(),
      genre: GENRES[i % GENRES.len()],
      year: (2015 + i % 10).to_string(),
      track_no: (i % 12) as u32 + 1,
      format,
      cover: COVERS[i % COVERS.len()],
      inset: [12, 20, 26][i % 3],
      tagged: true,
      copy_of: None,
      note: "",
    };
    let mut name = format!("{title} - {artist}");
    let mut folder = folder.map(str::to_string);
    if spec.messy {
      match i {
        3 => {
          name = format!("{artist} - {title} (Official Music Video)");
          p.title = format!("{title} (Official Music Video)");
          p.note = "YouTube junk, artist-first";
        }
        7 => {
          name = format!("{title} - {artist} [{FAKE_VIDEO_ID}]");
          p.title = format!("{title} [{FAKE_VIDEO_ID}]");
          p.note = "11-character video id in brackets";
        }
        11 => {
          name = name.to_uppercase();
          p.title = title.to_uppercase();
          p.artist = artist.to_uppercase();
          p.note = "ALL CAPS";
        }
        15 => {
          name = title.clone();
          p.artist = String::new();
          p.note = "no artist in name or tags";
        }
        19 => {
          p.title = "Café Lumière".into();
          p.artist = "Señora Nube".into();
          name = format!("{} - {}", p.title, p.artist).nfd().collect();
          p.note = "file name in NFD, tags in NFC";
        }
        23 => {
          p.tagged = false;
          p.note = "untagged";
        }
        27 if i < spec.tracks => {
          let original = &out[26];
          name = original.rel.rsplit('/').next().unwrap_or_default().to_string();
          name = name.rsplit_once('.').map(|(stem, _)| stem.to_string()).unwrap_or(name);
          p = Planned {
            copy_of: Some(26),
            note: "byte-identical duplicate of another track",
            ..original.clone()
          };
        }
        30 => {
          folder = Some(format!("{}/Old Tapes", FOLDERS[i % spec.folders]));
          p.note = "nested folder";
        }
        _ => {}
      }
    }
    let file = format!("{name}.{}", p.format.ext());
    p.rel = match folder {
      Some(f) => format!("{f}/{file}"),
      None => file,
    };
    out.push(p);
  }
  // The duplicate must sit in another folder than its original.
  if let Some(dup) = out.get(27).filter(|p| p.copy_of.is_some()) {
    if dup.rel == out[26].rel {
      return Err(Error::Refused("the duplicate pair needs at least 2 folders".into()));
    }
  }
  Ok(out)
}

fn playlist_plan(spec: &FixtureSpec, tracks: &[Planned]) -> Vec<PlaylistFile> {
  let n = tracks.len();
  let entries = |pick: &dyn Fn(usize) -> bool| -> Vec<String> {
    (0..n).filter(|&i| pick(i)).map(|i| tracks[i].rel.clone()).collect()
  };
  let messy: HashSet<usize> = if spec.messy {
    [3, 7, 11, 15, 19, 23, 26, 27, 30].into_iter().collect()
  } else {
    HashSet::new()
  };
  PLAYLISTS
    .iter()
    .take(spec.playlists)
    .map(|&name| {
      let entries = match name {
        "Favourites" => entries(&|i| i % 4 == 0),
        // Every 7th track, so the playlist spans folders and formats.
        "Focus" => entries(&|i| i % 7 == 1),
        // Playlist order is not file order: this one runs backwards.
        "Late Night" => {
          let mut e = entries(&|i| i % 3 == 2);
          e.reverse();
          e
        }
        "Mixed Formats" => entries(&|i| i < 5 || messy.contains(&i)),
        _ => Vec::new(),
      };
      PlaylistFile {
        name: name.to_string(),
        entries,
      }
    })
    .collect()
}

/// The house m3u8 format: `#EXTM3U`, then one root-relative entry per line, LF, trailing LF.
fn render_m3u8(entries: &[String]) -> String {
  let mut out = String::from("#EXTM3U\n");
  for e in entries {
    out.push_str(e);
    out.push('\n');
  }
  out
}

/// A square cover: the colour with a darker inset square (same hue), PNG or JPEG.
fn cover_bytes(cover: Cover, kind: ImageKind, inset: u32) -> Result<(Vec<u8>, MimeType)> {
  let base: [u8; 3] = match cover {
    Cover::Aqua => [0x00, 0xff, 0xbf],
    Cover::Purple => [0x8c, 0x19, 0xff],
    Cover::Grey(v) => [v, v, v],
  };
  // Scaling all channels keeps hue and saturation; only lightness changes.
  let dark = base.map(|c| (c as u32 * 11 / 20) as u8);
  let size = match kind {
    ImageKind::Png => 64,
    ImageKind::Jpeg => 96,
  };
  let edge = inset * size / 64;
  let img = RgbImage::from_fn(size, size, |x, y| {
    let inside = (edge..size - edge).contains(&x) && (edge..size - edge).contains(&y);
    Rgb(if inside { dark } else { base })
  });
  let mut buf = Vec::new();
  let fail = |e: image::ImageError| Error::Other(format!("cover encode: {e}"));
  match kind {
    ImageKind::Png => {
      PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), size, size, ExtendedColorType::Rgb8)
        .map_err(fail)?;
      Ok((buf, MimeType::Png))
    }
    ImageKind::Jpeg => {
      JpegEncoder::new_with_quality(&mut buf, 90)
        .write_image(img.as_raw(), size, size, ExtendedColorType::Rgb8)
        .map_err(fail)?;
      Ok((buf, MimeType::Jpeg))
    }
  }
}

fn tag_error(path: &Path, e: impl std::fmt::Display) -> Error {
  Error::Tag(format!("{}: {e}", path.display()))
}

/// Writes a fresh primary tag (replacing the template's encoder tag) with the planned fields.
fn write_tags(path: &Path, p: &Planned) -> Result<()> {
  let mut file = lofty::read_from_path(path).map_err(|e| tag_error(path, e))?;
  let tag_type = file.primary_tag_type();
  let mut tag = Tag::new(tag_type);
  fill_tag(&mut tag, p)?;
  if tag_type == TagType::Id3v2 {
    // lofty converts a generic tag to ID3v2 through a HashMap, so the frame order would change
    // from run to run; re-inserting the frames in id order keeps the fixture bytes deterministic.
    let mut frames: Vec<Frame<'static>> = Id3v2Tag::from(tag).into_iter().collect();
    frames.sort_by(|a, b| a.id_str().cmp(b.id_str()));
    let mut id3 = Id3v2Tag::new();
    for frame in frames {
      id3.insert(frame);
    }
    id3
      .save_to_path(path, WriteOptions::default())
      .map_err(|e| tag_error(path, e))
  } else {
    file.insert_tag(tag);
    file
      .save_to_path(path, WriteOptions::default())
      .map_err(|e| tag_error(path, e))
  }
}

fn fill_tag(tag: &mut Tag, p: &Planned) -> Result<()> {
  tag.set_title(p.title.clone());
  if !p.artist.is_empty() {
    tag.set_artist(p.artist.clone());
  }
  tag.set_album(p.album.clone());
  tag.set_genre(p.genre.to_string());
  tag.insert_text(ItemKey::RecordingDate, p.year.clone());
  tag.set_track(p.track_no);
  if let Some((cover, kind)) = p.cover {
    let (data, mime) = cover_bytes(cover, kind, p.inset)?;
    tag.push_picture(
      Picture::unchecked(data)
        .pic_type(PictureType::CoverFront)
        .mime_type(mime)
        .build(),
    );
  }
  Ok(())
}

fn abs_of(root: &Path, rel: &str) -> PathBuf {
  rel.split('/').fold(root.to_path_buf(), |p, seg| p.join(seg))
}

/// Generates the fixture library into `dest` (created if missing). Refuses a non-empty `dest`
/// without the marker. Re-generating into a marked folder overwrites the generated files and
/// leaves anything else there (an app's `_Soundhood/`, say) alone.
pub fn generate(dest: &Path, spec: &FixtureSpec) -> Result<FixtureReport> {
  let planned = plan(spec)?;
  if dest.exists() {
    if !dest.is_dir() {
      return Err(Error::Refused(format!("{} is not a folder", dest.display())));
    }
    let empty = std::fs::read_dir(dest)?.next().is_none();
    if !empty && !dest.join(MARKER).is_file() {
      return Err(Error::Refused(format!(
        "{} is not empty and is not a fixture library ({MARKER} missing); refusing to write into it",
        dest.display()
      )));
    }
  }
  std::fs::create_dir_all(dest)?;
  std::fs::write(
    dest.join(MARKER),
    "Soundhood fixture library (generated). Safe to delete this folder.\n",
  )?;

  let mut tracks = Vec::with_capacity(planned.len());
  for p in &planned {
    let abs = abs_of(dest, &p.rel);
    if let Some(parent) = abs.parent() {
      std::fs::create_dir_all(parent)?;
    }
    match p.copy_of {
      Some(src) => {
        std::fs::copy(abs_of(dest, &planned[src].rel), &abs)?;
      }
      None => {
        std::fs::write(&abs, p.format.template())?;
        if p.tagged {
          write_tags(&abs, p)?;
        }
      }
    }
    let duration_secs = lofty::read_from_path(&abs)
      .map_err(|e| tag_error(&abs, e))?
      .properties()
      .duration()
      .as_secs();
    tracks.push(FixtureTrack {
      rel: p.rel.clone(),
      title: if p.tagged { p.title.clone() } else { String::new() },
      artist: if p.tagged { p.artist.clone() } else { String::new() },
      album: if p.tagged { p.album.clone() } else { String::new() },
      format: p.format,
      cover: if p.tagged { p.cover.map(|(c, _)| c) } else { None },
      duration_secs,
      note: p.note.to_string(),
    });
  }

  let playlists = playlist_plan(spec, &planned);
  if !playlists.is_empty() {
    let dir = dest.join(crate::fs::PLAYLISTS_DIR);
    std::fs::create_dir_all(&dir)?;
    for pl in &playlists {
      std::fs::write(dir.join(format!("{}.m3u8", pl.name)), render_m3u8(&pl.entries))?;
    }
  }
  Ok(FixtureReport {
    root: dest.to_path_buf(),
    tracks,
    playlists,
  })
}

/// The library as the UI would receive it, for the Playwright harness: `{ tracks, playlists }`,
/// track paths under the neutral `JSON_ROOT`, sorted like the old scan (folder, then file name),
/// artist falling back to a filename side that names a known artist, like the old scan.
pub fn export_json(report: &FixtureReport) -> String {
  #[derive(Serialize)]
  struct Export<'a> {
    tracks: Vec<Track>,
    playlists: &'a [PlaylistFile],
  }
  let known: HashSet<String> = report
    .tracks
    .iter()
    .flat_map(|t| t.artist.split([',', '/', ';']))
    .flat_map(|a| {
      let lower = a.trim().to_lowercase();
      match lower.split_once(" feat. ") {
        Some((main, feat)) => vec![main.trim().to_string(), feat.trim().to_string()],
        None => vec![lower],
      }
    })
    .filter(|a| !a.is_empty())
    .collect();
  let mut tracks: Vec<Track> = report
    .tracks
    .iter()
    .map(|t| {
      let name = t.rel.rsplit('/').next().unwrap_or(&t.rel).to_string();
      let playlist = t
        .rel
        .split_once('/')
        .map(|(top, _)| top.to_string())
        .unwrap_or_else(|| "(root)".into());
      let artist = if t.artist.is_empty() {
        artist_from_filename(&name, &known)
      } else {
        t.artist.clone()
      };
      Track {
        path: format!("{JSON_ROOT}/{}", t.rel),
        name,
        playlist,
        title: t.title.clone(),
        artist,
        duration_secs: t.duration_secs,
      }
    })
    .collect();
  tracks.sort_by(|a, b| a.playlist.cmp(&b.playlist).then(a.name.cmp(&b.name)));
  serde_json::to_string_pretty(&Export {
    tracks,
    playlists: &report.playlists,
  })
  .unwrap_or_default()
}

/// "Song - Artist" first, then "Artist - Song": the side that is a known artist (old host rule).
fn artist_from_filename(name: &str, known: &HashSet<String>) -> String {
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

/// The fixture checks of the in-app "Run self-test" and `soundhood-tools self-test`, run in a
/// scratch folder under the system temp dir. Each line: (passed, plain description). They cover
/// fixture generation, the write path on the scratch library (a tag write, check and undo per
/// container, a move and its undo, a delete to the app bin and its undo), manifests, and the
/// yt-dlp output classifier.
pub fn self_test_lines() -> Vec<(bool, String)> {
  self_test_lines_in(&std::env::temp_dir())
}

/// As `self_test_lines`, with the scratch folder under `scratch_parent` (Android passes its cache
/// dir: the system temp dir is not writable there).
pub fn self_test_lines_in(scratch_parent: &Path) -> Vec<(bool, String)> {
  use std::sync::atomic::{AtomicUsize, Ordering};
  static RUN: AtomicUsize = AtomicUsize::new(0);
  let scratch = scratch_parent.join(format!(
    "soundhood-selftest-{}-{}",
    std::process::id(),
    RUN.fetch_add(1, Ordering::SeqCst)
  ));
  let mut lines = Vec::new();
  let spec = FixtureSpec::default();
  match generate(&scratch, &spec) {
    Ok(report) => {
      lines.push((
        report.tracks.len() == spec.tracks && report.playlists.len() == spec.playlists,
        format!(
          "fixture library: {} tracks, {} playlists",
          report.tracks.len(),
          report.playlists.len()
        ),
      ));
      let unreadable: Vec<&str> = report
        .tracks
        .iter()
        .filter(|t| t.duration_secs < 2)
        .map(|t| t.rel.as_str())
        .collect();
      lines.push((
        unreadable.is_empty(),
        format!("every fixture track reads back with its duration {unreadable:?}"),
      ));
      // Before the manifest checks, which append a byte to the first track.
      lines.extend(write_path_checks(&scratch, &report));
      lines.extend(manifest_checks(&scratch, &report));
    }
    Err(e) => lines.push((false, format!("fixture library: {e}"))),
  }
  if scratch.join(MARKER).is_file() {
    let _ = std::fs::remove_dir_all(&scratch);
  }
  for (name, text, want) in ytdlp::errors::corpus() {
    let got = ytdlp::errors::classify_output(text);
    lines.push((
      got == want,
      format!("yt-dlp output '{name}' classified as {:?}", got.kind),
    ));
  }
  lines
}

/// The one write path on the scratch library, through `ingest` exactly as the app calls it: per
/// container a tag write that is checked and then undone, then a move and a delete, each undone
/// and compared with a manifest taken before. The library is opened as the phone sees it
/// (`Platform::Android`), so the delete goes to `_Soundhood/.bin` on every device and never to
/// this computer's recycle bin.
fn write_path_checks(root: &Path, report: &FixtureReport) -> Vec<(bool, String)> {
  let lib = Library {
    root: root.to_path_buf(),
    device: DeviceId("self-test".into()),
    platform: Platform::Android,
  };
  let line = |label: String, r: std::result::Result<(), String>| match r {
    Ok(()) => (true, label),
    Err(why) => (false, format!("{label}: {why}")),
  };
  let mut lines = Vec::new();
  for format in FORMATS {
    let label = format!("{}: tag write, check and undo", format.ext());
    let track = report
      .tracks
      .iter()
      .find(|t| t.format == format && t.note.is_empty() && !t.title.is_empty());
    lines.push(match track {
      Some(t) => line(label, tag_round_trip(&lib, &t.rel)),
      None => (false, format!("{label}: no fixture track of this kind")),
    });
  }
  // Ordinary tracks in a first-level folder that a playlist names: the move and delete must
  // carry the playlist lines with them.
  let in_playlists: Vec<&FixtureTrack> = report
    .tracks
    .iter()
    .filter(|t| t.note.is_empty() && t.rel.contains('/'))
    .filter(|t| report.playlists.iter().any(|p| p.entries.contains(&t.rel)))
    .collect();
  lines.push(line(
    "move to another folder, playlists follow, undo puts it back".into(),
    match in_playlists.first() {
      Some(t) => move_round_trip(&lib, &t.rel, report),
      None => Err("no fixture track in a folder and a playlist".into()),
    },
  ));
  lines.push(line(
    "delete to the app bin, playlists follow, undo brings it back".into(),
    match in_playlists.get(1) {
      Some(t) => delete_round_trip(&lib, &t.rel),
      None => Err("no second fixture track in a folder and a playlist".into()),
    },
  ));
  lines
}

type Check = std::result::Result<(), String>;

/// A batch that changed something and skipped or failed nothing.
fn clean(r: &BatchReport, what: &str) -> Check {
  if !r.applied.is_empty() && r.skipped.is_empty() && r.failed.is_empty() && !r.aborted {
    return Ok(());
  }
  let skipped: Vec<&str> = r.skipped.iter().map(|s| s.reason.as_str()).collect();
  let failed: Vec<&str> = r.failed.iter().map(|f| f.error.as_str()).collect();
  Err(format!(
    "{what}: {} applied, skipped {skipped:?}, failed {failed:?}",
    r.applied.len()
  ))
}

fn err(e: Error) -> String {
  e.reason()
}

/// Retitles one track through the write path, reads it back, undoes it, and checks every
/// editable field, the duration and the cover are what they were.
fn tag_round_trip(lib: &Library, rel: &str) -> Check {
  let rel = RelPath::new(rel).map_err(err)?;
  let abs = lib.abs(&rel);
  let before = tags::read(&abs).map_err(err)?;
  let title = format!("{} (self-test)", before.title);
  let op = Op::WriteTags {
    rel: rel.clone(),
    changes: TagSet {
      title: Some(title.clone()),
      ..TagSet::default()
    },
  };
  let written = tagwrite::apply(lib, vec![op], &ApplyOptions::default());
  clean(&written, "the tag write")?;
  let after = tags::read(&abs).map_err(err)?;
  let want = TagSet {
    title: Some(title),
    ..tags::tagset_of(&before)
  };
  if tags::tagset_of(&after) != want || after.art_hash != before.art_hash {
    return Err(format!("the file reads back as {:?}", tags::tagset_of(&after)));
  }
  if after.duration_ms.abs_diff(before.duration_ms) > 1000 || after.codec != before.codec {
    return Err(format!(
      "the audio changed: {} ms {} became {} ms {}",
      before.duration_ms, before.codec, after.duration_ms, after.codec
    ));
  }
  clean(&undo::undo_batch(lib, &written.batch).map_err(err)?, "the undo")?;
  let restored = tags::read(&abs).map_err(err)?;
  if tags::tagset_of(&restored) != tags::tagset_of(&before) || restored.art_hash != before.art_hash {
    return Err(format!("after the undo it reads {:?}", tags::tagset_of(&restored)));
  }
  Ok(())
}

/// A manifest of the library, for "nothing else changed" comparisons.
fn snapshot(lib: &Library) -> std::result::Result<manifest::Manifest, String> {
  manifest::build(&lib.root).map_err(err)
}

/// After an undo the library must compare identical to the manifest taken before the change.
fn identical_to(lib: &Library, before: &manifest::Manifest) -> Check {
  match manifest::diff(before, &snapshot(lib)?) {
    d if d.is_empty() => Ok(()),
    d => Err(format!("after the undo the library differs: {d:?}")),
  }
}

/// Whether every playlist line naming `old` now names `new` instead (`None` after a delete).
fn playlists_follow(lib: &Library, old: &RelPath, new: Option<&RelPath>) -> Check {
  let still = playlist::containing(&lib.root, old).map_err(err)?;
  if !still.is_empty() {
    return Err(format!("{} still names the old place", still[0].name));
  }
  if let Some(new) = new {
    if playlist::containing(&lib.root, new).map_err(err)?.is_empty() {
      return Err("no playlist names the new place".into());
    }
  }
  Ok(())
}

fn move_round_trip(lib: &Library, rel: &str, report: &FixtureReport) -> Check {
  let rel = RelPath::new(rel).map_err(err)?;
  let (folder, name) = rel.as_str().split_once('/').ok_or("not in a folder")?;
  let name = name.rsplit('/').next().unwrap_or(name);
  // Another first-level folder of the fixture library without a file of that name.
  let to_folder = report
    .tracks
    .iter()
    .filter_map(|t| t.rel.split_once('/').map(|(f, _)| f))
    .find(|&f| f != folder && !abs_of(&lib.root, &format!("{f}/{name}")).exists())
    .ok_or("no other folder to move into")?
    .to_string();
  let to = RelPath::new(&format!("{to_folder}/{name}")).map_err(err)?;
  let before = snapshot(lib)?;
  let moved = tagwrite::apply(
    lib,
    vec![Op::Move {
      rel: rel.clone(),
      to_folder,
    }],
    &ApplyOptions::default(),
  );
  clean(&moved, "the move")?;
  if lib.abs(&rel).exists() || !lib.abs(&to).is_file() {
    return Err(format!("after the move the file is not at {to} only"));
  }
  playlists_follow(lib, &rel, Some(&to))?;
  clean(&undo::undo_batch(lib, &moved.batch).map_err(err)?, "the undo")?;
  identical_to(lib, &before)
}

fn delete_round_trip(lib: &Library, rel: &str) -> Check {
  let rel = RelPath::new(rel).map_err(err)?;
  let before = snapshot(lib)?;
  let deleted = tagwrite::apply(lib, vec![Op::Delete { rel: rel.clone() }], &ApplyOptions::default());
  clean(&deleted, "the delete")?;
  if lib.abs(&rel).exists() {
    return Err("the file is still there".into());
  }
  let bin = lib.root.join(crate::fs::APP_DIR).join(".bin");
  let name = lib.abs(&rel).file_name().map(|n| n.to_os_string());
  let in_bin = walkdir::WalkDir::new(&bin)
    .into_iter()
    .filter_map(|e| e.ok())
    .any(|e| e.file_type().is_file() && Some(e.file_name().to_os_string()) == name);
  if !in_bin {
    return Err("the file did not arrive in the app bin".into());
  }
  playlists_follow(lib, &rel, None)?;
  clean(&undo::undo_batch(lib, &deleted.batch).map_err(err)?, "the undo")?;
  identical_to(lib, &before)
}

fn manifest_checks(root: &Path, report: &FixtureReport) -> Vec<(bool, String)> {
  let mut lines = Vec::new();
  let (a, b) = match (manifest::build(root), manifest::build(root)) {
    (Ok(a), Ok(b)) => (a, b),
    (Err(e), _) | (_, Err(e)) => return vec![(false, format!("manifest: {e}"))],
  };
  let expected = report.tracks.len() + report.playlists.len();
  lines.push((
    a == b && manifest::diff(&a, &b).is_empty() && a.files.len() == expected,
    format!("manifest built twice is identical ({} files)", a.files.len()),
  ));
  // A one-byte append to one track must show up as exactly that one change.
  let Some(first) = report.tracks.first() else {
    return lines;
  };
  let target = abs_of(root, &first.rel);
  let appended = std::fs::OpenOptions::new()
    .append(true)
    .open(&target)
    .and_then(|mut f| std::io::Write::write_all(&mut f, b"\0"));
  let changed = appended.is_ok()
    && manifest::build(root).map(|c| manifest::diff(&a, &c)).ok()
      == Some(vec![format!(
        "changed: {}",
        crate::model::RelPath::new(&first.rel)
          .map(|r| r.to_string())
          .unwrap_or_default()
      )]);
  lines.push((changed, "manifest diff names a one-byte change and nothing else".into()));
  lines
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_library_shape_and_messy_names() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    assert_eq!(r.tracks.len(), 50);
    assert_eq!(r.playlists.len(), 5);
    let folders: HashSet<&str> = r
      .tracks
      .iter()
      .filter_map(|t| t.rel.split_once('/').map(|(f, _)| f))
      .collect();
    assert_eq!(folders.len(), 5);
    assert_eq!(
      r.tracks.iter().filter(|t| !t.rel.contains('/')).count(),
      2,
      "two tracks in the root"
    );
    // Ten per format, except that the duplicate copies its original's format (mp3, not flac).
    for (f, n) in FORMATS.into_iter().zip([10, 11, 9, 10, 10]) {
      assert_eq!(r.tracks.iter().filter(|t| t.format == f).count(), n, "{f:?}");
    }
    let rels: Vec<&str> = r.tracks.iter().map(|t| t.rel.as_str()).collect();
    assert!(rels.iter().any(|p| p.contains(" (Official Music Video).")), "{rels:?}");
    assert!(rels.iter().any(|p| p.contains(&format!("[{FAKE_VIDEO_ID}]"))));
    let all_caps = |p: &&str| {
      let stem = p.rsplit('/').next().unwrap().rsplit_once('.').unwrap().0;
      stem.len() > 8 && stem == stem.to_uppercase()
    };
    assert!(rels.iter().any(all_caps), "ALL CAPS");
    assert!(rels.iter().any(|p| p.contains("e\u{301}")), "NFD on disk");
    assert!(rels.iter().any(|p| p.contains("/Old Tapes/")));
    let (a, b) = (&r.tracks[26], &r.tracks[27]);
    assert_eq!(a.rel.rsplit('/').next(), b.rel.rsplit('/').next());
    assert_ne!(a.rel, b.rel);
    assert_eq!(
      std::fs::read(t.path().join(&a.rel)).unwrap(),
      std::fs::read(t.path().join(&b.rel)).unwrap()
    );
    assert!(r.tracks.iter().all(|t| t.duration_secs >= 2), "every file parses");
    assert!(t.path().join(MARKER).is_file());
  }

  #[test]
  fn tags_and_covers_read_back() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    let mut seen = HashSet::new();
    for track in &r.tracks {
      let file = lofty::read_from_path(t.path().join(&track.rel)).unwrap();
      let tag = file.primary_tag().or_else(|| file.first_tag());
      let title = tag.and_then(|t| t.title().map(|s| s.to_string())).unwrap_or_default();
      assert_eq!(title, track.title, "{}", track.rel);
      let artist = tag.and_then(|t| t.artist().map(|s| s.to_string())).unwrap_or_default();
      assert_eq!(artist, track.artist, "{}", track.rel);
      let pic = tag.and_then(|t| t.pictures().first().cloned());
      assert_eq!(pic.is_some(), track.cover.is_some(), "{}", track.rel);
      if let (Some(pic), Some(cover)) = (pic, track.cover) {
        let img = image::load_from_memory(pic.data()).unwrap().to_rgb8();
        assert_eq!(img.width(), img.height(), "square");
        let px = img.get_pixel(0, 0).0;
        let want = match cover {
          Cover::Aqua => [0x00, 0xff, 0xbf],
          Cover::Purple => [0x8c, 0x19, 0xff],
          Cover::Grey(v) => [v, v, v],
        };
        let close = px.iter().zip(want).all(|(a, b)| a.abs_diff(b) <= 6);
        assert!(close, "{}: corner {px:?} vs {want:?}", track.rel);
        seen.insert(format!("{cover:?}"));
      }
    }
    assert!(seen.contains("Aqua") && seen.contains("Purple") && seen.iter().any(|s| s.starts_with("Grey")));
  }

  #[test]
  fn playlists_are_house_format_and_point_at_real_files() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    for pl in &r.playlists {
      let bytes = std::fs::read(t.path().join("_Playlists").join(format!("{}.m3u8", pl.name))).unwrap();
      let text = String::from_utf8(bytes).unwrap();
      assert!(text.starts_with("#EXTM3U\n") && text.ends_with('\n') && !text.contains('\r'));
      assert!(!text.contains('\\'));
      assert_eq!(text, render_m3u8(&pl.entries));
      for e in &pl.entries {
        assert!(t.path().join(e).is_file(), "{}: {e}", pl.name);
      }
    }
    let empty = std::fs::read(t.path().join("_Playlists/Empty.m3u8")).unwrap();
    assert_eq!(empty, b"#EXTM3U\n");
    let late = &r.playlists[2];
    assert!(late.entries.len() > 2);
    // "Late Night" runs backwards through the library.
    let pos = |e: &String| r.tracks.iter().position(|t| &t.rel == e).unwrap();
    assert!(pos(&late.entries[0]) > pos(&late.entries[1]));
  }

  #[test]
  fn generation_is_deterministic() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let ra = generate(a.path(), &FixtureSpec::default()).unwrap();
    let rb = generate(b.path(), &FixtureSpec::default()).unwrap();
    assert_eq!(ra.tracks, rb.tracks);
    let (ma, mb) = (manifest::build(a.path()).unwrap(), manifest::build(b.path()).unwrap());
    let d = manifest::diff(&ma, &mb);
    assert!(d.is_empty(), "{d:?}");
    assert_eq!(ma.files.len(), 55);
    // Regenerating over itself changes nothing either.
    generate(a.path(), &FixtureSpec::default()).unwrap();
    assert!(manifest::diff(&ma, &manifest::build(a.path()).unwrap()).is_empty());
  }

  #[test]
  fn refuses_a_non_empty_folder_without_the_marker() {
    let t = tempfile::tempdir().unwrap();
    std::fs::write(t.path().join("Song - Artist.mp3"), b"a user's file").unwrap();
    let err = generate(t.path(), &FixtureSpec::default()).unwrap_err();
    assert!(matches!(err, Error::Refused(_)), "{err}");
    assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 1, "nothing written");
    assert!(generate(&t.path().join("Song - Artist.mp3"), &FixtureSpec::default()).is_err());
  }

  #[test]
  fn small_and_clean_specs() {
    let t = tempfile::tempdir().unwrap();
    let spec = FixtureSpec {
      tracks: 6,
      folders: 1,
      playlists: 1,
      messy: false,
    };
    let r = generate(t.path(), &spec).unwrap();
    assert_eq!(r.tracks.len(), 6);
    assert!(r
      .tracks
      .iter()
      .all(|t| t.note.is_empty() && t.rel.ends_with(&format!(" - {}.{}", t.artist, t.format.ext()))));
    assert!(plan(&FixtureSpec {
      folders: 9,
      ..FixtureSpec::default()
    })
    .is_err());
    assert!(plan(&FixtureSpec {
      tracks: 0,
      ..FixtureSpec::default()
    })
    .is_err());
    assert!(plan(&FixtureSpec {
      playlists: 6,
      ..FixtureSpec::default()
    })
    .is_err());
    assert!(
      plan(&FixtureSpec {
        folders: 1,
        ..FixtureSpec::default()
      })
      .is_err(),
      "duplicate needs 2 folders"
    );
  }

  #[test]
  fn export_json_matches_the_ui_wire_shape() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&export_json(&r)).unwrap();
    let tracks = v["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 50);
    assert_eq!(v["playlists"].as_array().unwrap().len(), 5);
    let first = &tracks[0];
    assert_eq!(first["playlist"], "(root)");
    for key in ["path", "name", "playlist", "title", "artist", "duration_secs"] {
      assert!(first.get(key).is_some(), "{key}");
    }
    assert!(tracks
      .iter()
      .all(|t| t["path"].as_str().unwrap().starts_with("C:/Music/")));
    let playlists: Vec<&str> = tracks.iter().map(|t| t["playlist"].as_str().unwrap()).collect();
    let mut sorted = playlists.clone();
    sorted.sort();
    assert_eq!(playlists, sorted);
    // The untagged track gets its artist from the file name, like the old scan.
    let untagged = tracks.iter().find(|t| t["title"] == "").unwrap();
    assert!(!untagged["artist"].as_str().unwrap().is_empty(), "{untagged}");
  }

  #[test]
  fn self_test_passes() {
    let lines = self_test_lines();
    assert!(lines.len() >= 5);
    for (ok, line) in &lines {
      assert!(ok, "{line}");
    }
    // The write path is exercised: one round trip per container, a move and a delete.
    let has = |s: &str| lines.iter().filter(|(_, l)| l.contains(s)).count();
    assert_eq!(has(": tag write, check and undo"), FORMATS.len());
    for f in FORMATS {
      assert_eq!(has(&format!("{}: tag write", f.ext())), 1, "{f:?}");
    }
    assert_eq!(has("move to another folder"), 1);
    assert_eq!(has("delete to the app bin"), 1);
  }

  #[test]
  fn the_write_checks_leave_the_library_as_they_found_it() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    let before = manifest::build(t.path()).unwrap();
    for (ok, line) in write_path_checks(t.path(), &r) {
      assert!(ok, "{line}");
    }
    let after = manifest::build(t.path()).unwrap();
    // Tag write + undo restores the values, not necessarily the bytes; moves and deletes are exact.
    let rels = |m: &manifest::Manifest| m.files.iter().map(|f| f.rel.to_string()).collect::<Vec<_>>();
    assert_eq!(rels(&before), rels(&after));
    assert!(t.path().join("_Soundhood").join("journal").join("self-test").is_dir());
  }

  #[test]
  fn a_write_the_library_refuses_shows_as_a_failed_line() {
    let t = tempfile::tempdir().unwrap();
    let r = generate(t.path(), &FixtureSpec::default()).unwrap();
    let m4a = r
      .tracks
      .iter()
      .find(|t| t.format == Format::M4a && t.note.is_empty())
      .unwrap();
    let abs = t.path().join(&m4a.rel);
    let mut perms = std::fs::metadata(&abs).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&abs, perms.clone()).unwrap();
    let lines = write_path_checks(t.path(), &r);
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&abs, perms).unwrap();
    let (ok, line) = &lines[0];
    assert!(
      !ok && line.starts_with("m4a: tag write, check and undo: the tag write:"),
      "{line}"
    );
    assert!(lines[1..].iter().all(|(ok, _)| *ok), "{lines:?}");
  }
}
