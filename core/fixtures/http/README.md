Fake upstream releases for the sidecar manager tests (`core/tests/tools_sidecars.rs`). The tests
serve this tree from an in-process HTTP server on 127.0.0.1 and point `sidecars::fetch` at it,
so the paths mirror GitHub's release download URLs:

- `yt-dlp/yt-dlp/releases/download/<version>/{yt-dlp.exe, yt-dlp_linux, yt-dlp_macos, SHA2-256SUMS}`
  for 2099.12.31 (above the pinned minimum) and 2020.01.01 (below it).
- `denoland/deno/releases/download/v9.9.9/deno-<triple>.zip` + `.zip.sha256sum`: the Windows
  checksum file is PowerShell `Get-FileHash` output (CRLF, upper-case hex), the Linux one is
  coreutils format, as deno publishes them.

Every "binary" is a one-line text file; nothing here is executable. The zips were written with
Python's `zipfile` (fixed timestamp, deflate); `.gitattributes` keeps every byte exact.
