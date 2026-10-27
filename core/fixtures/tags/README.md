Container layouts the tag-write tests need beyond `core/fixtures/audio` (same 3 s, 440 Hz tone).
Generated once with ffmpeg 8.0.1:

    ffmpeg -i ../audio/tone.m4a -c copy -map_metadata -1 -movflags +faststart tone-faststart.m4a

tone-faststart.m4a: `moov` before `mdat` (the iTunes layout), so a growing tag moves the audio and
the writer must rewrite every chunk offset. Tests copy it into a temp dir; never modify it in place.
