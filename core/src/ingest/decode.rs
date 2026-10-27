//! The decode half of a write's verify step: the rewritten temp must still decode (symphonia,
//! at least 2 s, or the whole track when it is shorter). `tags::verify` checks fields, codec and
//! duration as read from the container; this proves the audio stream itself still plays.

use crate::error::{Error, Result};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// How much audio must decode.
const WANT_MS: u64 = 2000;
/// Packets the decoder may reject before the stream counts as damaged (some encoders emit a bad
/// first frame that every player skips).
const MAX_BAD_PACKETS: u32 = 3;

/// Checks that `tmp` decodes. When it does not and the untouched `original` does not decode with
/// symphonia either (Opus has no decoder in symphonia 0.6, HE-AAC fails), the check cannot judge
/// this file: returns `Ok(Some(note))` for the journal and the write relies on `tags::verify`.
/// `duration_ms` is the track's length as read before the write.
pub(crate) fn check(tmp: &Path, original: &Path, duration_ms: u64) -> Result<Option<String>> {
  let want = WANT_MS.min(duration_ms.saturating_sub(250)).max(1);
  match decodes(tmp, original, want) {
    Ok(()) => Ok(None),
    Err(after) => match decodes(original, original, want) {
      Err(before) => Ok(Some(format!(
        "decode check skipped: symphonia cannot decode the original either ({before})"
      ))),
      Ok(()) => Err(Error::Verify(format!(
        "{}: the audio no longer decodes after the tag write ({after})",
        original.display()
      ))),
    },
  }
}

/// Decodes `path` until `want_ms` of audio came out. `hint_from` names the real extension (the
/// temp keeps it, but be explicit). A panic inside symphonia is a failure, not a crash.
fn decodes(path: &Path, hint_from: &Path, want_ms: u64) -> std::result::Result<(), String> {
  catch_unwind(AssertUnwindSafe(|| decode_inner(path, hint_from, want_ms)))
    .unwrap_or_else(|_| Err("the decoder panicked".to_string()))
}

fn decode_inner(path: &Path, hint_from: &Path, want_ms: u64) -> std::result::Result<(), String> {
  let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
  let mss = MediaSourceStream::new(Box::new(file), Default::default());
  let mut hint = Hint::new();
  if let Some(ext) = hint_from.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }
  let mut format = symphonia::default::get_probe()
    .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
    .map_err(|e| format!("not a stream symphonia can read: {e}"))?;
  let track = format
    .default_track(TrackType::Audio)
    .ok_or_else(|| "no audio track".to_string())?;
  let track_id = track.id;
  let params = track
    .codec_params
    .as_ref()
    .and_then(|p| p.audio())
    .ok_or_else(|| "no audio codec parameters".to_string())?;
  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(params, &AudioDecoderOptions::default())
    .map_err(|e| format!("no decoder: {e}"))?;
  let mut decoded_ms: u64 = 0;
  let mut bad = 0u32;
  while decoded_ms < want_ms {
    let packet = match format.next_packet() {
      Ok(Some(p)) => p,
      Ok(None) => return Err(format!("the stream ends after {decoded_ms} ms")),
      Err(e) => return Err(format!("demux error after {decoded_ms} ms: {e}")),
    };
    if packet.track_id != track_id {
      continue;
    }
    match decoder.decode(&packet) {
      Ok(buf) => {
        let rate = u64::from(buf.spec().rate().max(1));
        decoded_ms += buf.frames() as u64 * 1000 / rate;
      }
      Err(SymError::DecodeError(_)) | Err(SymError::IoError(_)) if bad < MAX_BAD_PACKETS => bad += 1,
      Err(e) => return Err(format!("decode error after {decoded_ms} ms: {e}")),
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/audio").join(name)
  }

  #[test]
  fn fixture_audio_decodes_except_opus_which_is_skipped() {
    for f in ["tone.m4a", "tone.mp3", "tone.flac", "tone.ogg"] {
      let p = fixture(f);
      assert_eq!(check(&p, &p, 3000).unwrap(), None, "{f}");
    }
    let opus = fixture("tone.opus");
    let note = check(&opus, &opus, 3000).unwrap();
    assert!(note.is_some_and(|n| n.contains("decode check skipped")));
  }

  #[test]
  fn a_truncated_rewrite_of_a_decodable_original_fails() {
    let d = tempfile::tempdir().unwrap();
    let original = fixture("tone.mp3");
    let bytes = std::fs::read(&original).unwrap();
    let tmp = d.path().join(".soundhood-tmp-x.mp3");
    std::fs::write(&tmp, &bytes[..bytes.len() / 4]).unwrap();
    assert!(matches!(check(&tmp, &original, 3000), Err(Error::Verify(_))));
  }
}
