# Legal

What each statement below covers: a statement with no mark holds from version 0.2.0 (Phase 0) on; a
statement marked "from Phase N" describes a later phase of the rebuild ([PROJECT](PROJECT.md#phases))
and is not true of earlier versions. What is not verified yet is listed in [OPEN](docs/OPEN.md).

## What Soundhood is

A local music player. It plays files you already have, in a folder you choose. It never hosts, streams
or redistributes music, never gets around DRM or any other access control, and has no accounts and no
servers of its own.

## The download helper

Getting audio from YouTube is a separate, optional part of the app, and it acts only on a link you
give it. In Phase 0 the download box is there as before and nothing happens until you paste or share
a link; from Phase 2 the helper is off until you enable it.

- **DRM stays respected.** yt-dlp skips formats marked as DRM-protected, and Soundhood never passes
  `--allow-unplayable-formats`.
- **No cookie harvesting.** Soundhood never reads cookies from a browser (`--cookies-from-browser` is
  never used). A cookie file is optional, exported by the user, kept in the app's private data on the
  PC, never inside the library and never synced.
- **One download at a time.** Queued links are fetched one after another, never in parallel. From
  Phase 2: pauses between requests and a per-device download archive, so nothing is fetched twice.
- **No "download a whole channel".** A link to a whole channel, or to one of its tabs (videos,
  shorts, streams, releases), is refused. A playlist link is the most it takes.

**The honest framing.** The helper is meant for personal, non-commercial use, started by the user for
each link, with no redistribution. Soundhood does **not** claim that such downloads are covered by a
private-copy exception: private-copy rules in several countries exclude works offered on demand under
contract terms, and YouTube's Terms of Service forbid downloading except where YouTube itself offers
it. Whether a particular download is allowed is a matter between the user, the rights holder and the
platform; the user is responsible for what they download.

## How the desktop download helper is verified

On the PC the helper is yt-dlp plus deno (the JavaScript runtime yt-dlp needs).

- **Phase 0: the installer still carries yt-dlp and deno**, as the app did before the rebuild (the
  migration rule in [DECISIONS](docs/DECISIONS.md)). What it carries is the pinned release: the build
  script (`scripts/build-windows.ps1`) and the release workflow fetch the pinned versions and verify
  them, as described below, before they build.
- **From Phase 2 the installer no longer carries them.** The app fetches them from their upstream
  GitHub releases when the user enables the downloader, with the same verification.
- `core/src/ytdlp/pins.rs` pins the **deno** release hash, a **minimum yt-dlp version** and the hash of
  the **bootstrap yt-dlp build**. The pin table is a floor, not a ceiling: newer releases are allowed,
  older ones never.
- The fetch downloads each file over HTTPS **and the checksum file its release publishes**
  (`SHA2-256SUMS` for yt-dlp, `.sha256sum` for deno), checks the SHA-256 against both that file and the
  pin, refuses on any mismatch, refuses a yt-dlp below the pinned minimum before downloading anything,
  and logs both hashes.
- The fetch, verification and unpacking live in Soundhood's Rust core (the sidecar manager), the same
  code on Windows, Linux and macOS. Its command-line entry point is `soundhood-tools fetch-sidecars`;
  `scripts/fetch-sidecars.ps1` is a Windows developer convenience that calls it.
- From Phase 2: **Update download helper** fetches a newer yt-dlp release and **Repair helper**
  fetches the pinned ones again, both verified the same way, and only when the user presses them. With
  **Keep download helper updated** switched on (off by default), a version check runs inside a
  download the user started, never when the app starts.
- **ffmpeg** is not bundled in Phase 0: on the PC yt-dlp uses an ffmpeg found on the system `PATH`.
  From Phase 2 an LGPL build is bundled with the desktop app as a separate program.

## On the phone

The Android download library, youtubedl-android, carries yt-dlp inside the app (together with Python,
ffmpeg and QuickJS). Soundhood accepts that and says so here. Its yt-dlp changes only when the user
taps **Update yt-dlp** in the settings sheet. That update is youtubedl-android's own: it downloads the
newest yt-dlp release from GitHub over HTTPS and checks no checksum, so it rests on TLS alone. From
Phase 2 the downloaded version is also checked against the pinned minimum.

## When Soundhood uses the network

Only for:

- downloads the user started;
- on the phone, **Update yt-dlp** when tapped; on the PC from Phase 2, **Update download helper**,
  **Repair helper** and the version check described above;
- on the phone, **Network check** when tapped: a diagnostic that looks up and connects to YouTube, to
  Cloudflare's public test hosts (`1.1.1.1`, `one.one.one.one`) and to one fixed Google address, partly
  outside the app's own relay, to tell a network problem from a YouTube one;
- Proton Drive on the phone (log in, Sync now, Get new, Send new), when the user runs it. From Phase 6
  rclone identifies itself to Proton as a third-party client (`--protondrive-app-version`); until then
  it sends rclone's built-in default identification;
- from Phases 4 and 5, online lookups behind the **Online lookups** switch (off on first run, each
  service with its own switch): AcoustID, MusicBrainz, Cover Art Archive, iTunes Search and LRCLIB.

Nothing else: no analytics, no telemetry, no crash reports, no update pings. The interface loads
nothing from the internet: it uses the system's fonts, and from Phase 1 the bundled Inter typeface.

**Windows' WebView2 runtime.** On Windows the app's window is drawn by Microsoft's WebView2 runtime,
which is part of Windows. Left at its defaults, that runtime contacts Microsoft by itself (a
configuration service, component update checks, proxy auto-detection). Soundhood starts it with
browser flags that switch this traffic off; the flags, and any connection they cannot stop, are
recorded in [DECISIONS](docs/DECISIONS.md) and tracked in [OPEN](docs/OPEN.md).

Building Soundhood from source also uses the network: npm and Cargo download their packages, and the
build script and the release workflow download yt-dlp and deno as described above.

## Third-party components

| Component | Role | Where |
|---|---|---|
| yt-dlp | downloads audio from a link | PC: carried in the installer, pinned and verified when the installer is built (Phase 0); fetched and verified on first enable (from Phase 2). Phone: inside youtubedl-android |
| deno | JavaScript runtime yt-dlp needs | PC: as yt-dlp |
| QuickJS | JavaScript runtime yt-dlp needs | phone (inside youtubedl-android) |
| ffmpeg | audio extraction and tagging | PC: the system's own on `PATH` (Phase 0), a bundled LGPL build (from Phase 2). Phone: inside youtubedl-android |
| youtubedl-android | runs yt-dlp on Android | phone |
| rclone | Proton Drive sync | phone |
| WebView2 | draws the window | PC (Windows), part of Windows |
| Tauri, React, SQLite, lofty | the app itself | both |
| Inter | the typeface (from Phase 1) | both (bundled) |

Each component keeps its own licence. From Phase 1 the About section of the settings lists them with
their licence notices.
