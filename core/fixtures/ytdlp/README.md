Synthetic yt-dlp console transcripts for `core/src/ytdlp/errors.rs` (classifier tests and the
in-app self-test). Every video id, title, playlist and path here is made up; the message wording
follows yt-dlp 2026.10.x. One file per outcome; the file name says what the classifier must report
for the transcript as a whole:

| File | Expected kind | Contains an `ERROR:` line |
|---|---|---|
| `bot_wall.txt` | bot_wall | yes |
| `bot_wall_ip_blocked.txt` | bot_wall | yes |
| `rate_limited_429.txt` | rate_limited_429 | yes |
| `rate_limited_session.txt` | rate_limited_429 | yes |
| `missing_js_runtime.txt` | missing_js_runtime | yes |
| `already_in_archive.txt` | already_in_archive | no |
| `site_wait.txt` | site_wait (6 s) | no |
| `transient_503.txt` | transient | yes |
| `transient_fragment.txt` | transient | yes |
| `drm.txt` | drm | yes |
| `unavailable_private.txt` | unavailable | yes |
| `unavailable_age.txt` | unavailable | yes |
| `unavailable_removed.txt` | unavailable | yes |
| `ok.txt` | other | no |
