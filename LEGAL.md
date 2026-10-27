# Legal

## What Soundhood is

A local music player. It plays files you already have, in a folder you choose. It never hosts, streams
or redistributes music, never gets around DRM or any other access control, and has no accounts and no
servers of its own.

## The download helper

Getting audio from YouTube is a separate, optional module. It is off until you enable it, and it acts
only on a link you give it.

- **DRM stays respected.** yt-dlp skips formats marked as DRM-protected, and Soundhood never passes
  `--allow-unplayable-formats`.
- **No cookie harvesting.** Soundhood never reads cookies from a browser (`--cookies-from-browser` is
  never used). A cookie file is optional, exported by the user, kept in the app's private data, never
  inside the library and never synced.
- **Rate-limited by design.** Pauses between requests, a per-device download archive so nothing is
  fetched twice, one download at a time.
- **No "download a whole channel".** A playlist link is the most it takes.

**The honest framing.** The helper is meant for personal, non-commercial use, started by the user for
each link, with no redistribution. Soundhood does **not** claim that such downloads are covered by a
private-copy exception: private-copy rules in several countries exclude works offered on demand under
contract terms, and YouTube's Terms of Service forbid downloading except where YouTube itself offers
it. Whether a particular download is allowed is a matter between the user, the rights holder and the
platform; the user is responsible for what they download.

## How the desktop download helper is verified

On the PC, yt-dlp and deno (the JavaScript runtime yt-dlp needs) are **not shipped in the installer**.
The app fetches them from their upstream GitHub releases when the user enables the downloader, and
checks every byte:

- `core/src/ytdlp/pins.rs` pins the **deno** release hash, a **minimum yt-dlp version** and the hash of
  the **bootstrap yt-dlp build**. The pin table is a floor, not a ceiling: newer releases are allowed,
  older ones never.
- **Update helper** fetches the chosen yt-dlp release asset **and that release's published
  `SHA2-256SUMS`** over TLS, verifies the SHA-256, refuses on a mismatch, refuses a downgrade below the
  pinned minimum, and logs both hashes. deno updates are verified the same way against the release's
  `.sha256sum` files.
- The fetch, verification and unpacking live in the Rust desktop host (the sidecar manager), the same
  code on Windows, Linux and macOS. `scripts/fetch-sidecars.ps1` is a Windows developer convenience
  that calls the same entry point (`soundhood.exe --fetch-sidecars`).
- The helper is fetched or updated only on a user action: enabling the downloader, **Update download
  helper** or **Repair helper**. With **Keep download helper updated** switched on (it is off by
  default), a version check runs inside a download the user started, never when the app starts.
- **ffmpeg** is bundled with the desktop app as a separate program, in an LGPL build.

## On the phone

The Android download library, youtubedl-android, carries yt-dlp inside the app (together with Python,
ffmpeg and QuickJS). Soundhood accepts that and says so here. Its yt-dlp is updated only by **Update
helper**, or, with **Keep download helper updated** switched on, inside a download the user started.

## When Soundhood uses the network

Only for:

- downloads the user started;
- **Update download helper**, **Repair helper**, and the version check described above;
- online lookups, behind the **Online lookups** switch (off on first run, each service with its own
  switch): AcoustID, MusicBrainz, Cover Art Archive, iTunes Search and LRCLIB, as later versions add
  them;
- Proton Drive sync on the phone, when the user runs it. rclone identifies itself as a third-party
  client, never as an official Proton app.

Nothing else: no analytics, no telemetry, no crash reports, no update pings. Fonts are bundled, not
loaded from a font service.

## Third-party components

| Component | Role | Where |
|---|---|---|
| yt-dlp | downloads audio from a link | PC (fetched, verified), phone (inside youtubedl-android) |
| deno | JavaScript runtime yt-dlp needs | PC (fetched, verified) |
| QuickJS | JavaScript runtime yt-dlp needs | phone (inside youtubedl-android) |
| ffmpeg | audio extraction and tagging | PC (bundled, LGPL build), phone (inside youtubedl-android) |
| youtubedl-android | runs yt-dlp on Android | phone |
| rclone | Proton Drive sync | phone |
| Tauri, React, SQLite, lofty | the app itself | both |
| Inter | the typeface (from Phase 1) | both (bundled) |

Each component keeps its own licence. The About section of the settings (Phase 1) lists them with
their licence notices.
