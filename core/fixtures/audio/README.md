Template audio for tests and the fixture library: 3 s, 440 Hz sine, mono, 22.05 kHz, no tags.
Generated once with ffmpeg 8.0.1:

    ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=22050:duration=3" -ac 1 -map_metadata -1 <codec args> tone.<ext>

m4a: -c:a aac -b:a 32k · mp3: -c:a libmp3lame -b:a 32k · flac: -c:a flac · opus: -c:a libopus -b:a 24k · ogg: -c:a libvorbis -q:a 0
Tests copy these into a temp dir before writing tags; never modify them in place.
