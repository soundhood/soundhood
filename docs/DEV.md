# Development

How to build and run Soundhood on the PC and the phone, the traps the dev loop has already hit, the
signing rule and the CI gates. Background: [ARCHITECTURE](ARCHITECTURE.md). On-disk formats:
[LIBRARY_FORMAT](LIBRARY_FORMAT.md). Tests: [TESTING](TESTING.md). Why things are the way they are:
[DECISIONS](DECISIONS.md). Not verified yet: [OPEN](OPEN.md).

## Tools

| Tool | Version | Used for |
|---|---|---|
| Rust (rustup) | 1.92 (the CI pin lives in `.github/actions/rust/action.yml`; the core's minimum is 1.89) | everything Rust |
| Node.js + npm | 24 | the UI (`app/`) and the tooling (`tools/`) |
| Windows | WebView2 (built into Windows 11), Visual Studio C++ build tools | desktop builds |
| Linux | the packages in `.github/actions/linux-deps/action.yml` (ubuntu-24.04) | desktop builds |
| Android SDK | platform 36, build-tools, `adb` on `PATH`, `ANDROID_HOME` set | phone builds |
| Android NDK | r27 or newer, `NDK_HOME` set | phone builds, the core's Android check |
| JDK | 17 (Android Studio's bundled runtime works), `JAVA_HOME` set | Gradle |
| Rust Android target | `rustup target add aarch64-linux-android` | phone builds |
| cargo-ndk | `cargo install cargo-ndk --locked` | the core's Android check |
| ffmpeg | any recent build | only to regenerate `core/fixtures/audio/` ([its README](../core/fixtures/audio/README.md)) |

## The Cargo workspace

The root `Cargo.toml` is a workspace with three members: `core` (soundhood-core, no Tauri),
`app/src-tauri` (the Tauri host) and `app/src-tauri/plugins/soundhood-ytdl` (the Android plugin).
All Rust output now goes to **`<repo>/target/`**, no longer `app/src-tauri/target/`.

| Artefact | Where |
|---|---|
| Windows installer | `target/release/bundle/nsis/Soundhood_<version>_x64-setup.exe` |
| Linux AppImage / .deb | `target/release/bundle/appimage/`, `target/release/bundle/deb/` |
| Android Rust library | `target/aarch64-linux-android/<debug or release>/libsoundhood_lib.so` |
| Android APK | under `app/src-tauri/gen/android/app/build/outputs/apk/`; the build prints the exact path |
| Web UI bundle | `app/dist/` |

Core work, from the repository root:

```powershell
cargo test -p soundhood-core                         # unit tests
cargo test -p soundhood-core --all-features          # plus kill-mid-write tests, sidecar manager, CLI
cargo fmt -p soundhood-core                          # 2-space house style (rustfmt.toml)
cargo clippy --workspace -- -D warnings
cargo ndk -t arm64-v8a check -p soundhood-core       # does the core build for the phone?
cargo run -p soundhood-core --features tools --bin soundhood-tools -- manifest <root> <out.json>
cargo run -p soundhood-core --features tools --bin soundhood-tools -- fixture-lib <dir>
```

Core features: `online` (network lookups, off unless a host enables it), `sidecars` (the desktop
sidecar manager), `tools` (the `soundhood-tools` CLI), `fault-injection` (test-only crash points).
Formatting is checked for the core; the host code takes the house style as it is ported into the core.

**Why cargo-ndk.** `cargo check --target aarch64-linux-android` on its own fails: rusqlite's bundled
SQLite is compiled by a build script that needs the NDK's clang. cargo-ndk sets that up the same way
`tauri android build` does locally.

## Desktop

From `app/`:

```powershell
npm ci
npm run tauri dev       # a dev window that reloads on UI changes
npm run tauri build     # the NSIS installer (see the artefact table)
```

The owner-facing wrapper `scripts/build-windows.ps1` (planned) runs the same build.

**Download helpers on the desktop.** `app/src-tauri/tauri.conf.json` still lists `bin/yt-dlp` and
`bin/deno` under `bundle.externalBin`, so a desktop build needs
`app/src-tauri/bin/yt-dlp-<target triple>.exe` and `deno-<target triple>.exe` (git-ignored, never
committed). Phase 0 replaces this with the sidecar manager: on first enable the app fetches yt-dlp and
deno from their upstream releases and verifies them against the published checksums
([LEGAL](../LEGAL.md#how-the-desktop-download-helper-is-verified)); `scripts/fetch-sidecars.ps1` is a
Windows dev convenience that calls the same host entry point (`soundhood.exe --fetch-sidecars`).
ffmpeg (an LGPL build) is bundled. CI compiles with empty placeholders (`.github/scripts/sidecars.mjs`);
release builds refuse placeholders.

Where the installed app keeps its files on Windows: the program in `%LOCALAPPDATA%\Soundhood\`; its
own files (settings in `music-hood.json`, `cookies.txt`, the device id, the index, caches, logs) in the
per-user app data and cache folders named after the app identifier (`identifier` in
`app/src-tauri/tauri.conf.json`). None of them is inside the library root.

## Phone (Android)

**Dev loop** (phone on USB with USB debugging on, PC and phone on the same Wi-Fi), from `app/`:

```powershell
npm run tauri android dev
```

The app is built and installed on the phone, and its UI is loaded from the PC's Vite dev server.

**Standalone APK** (runs without the PC), from `app/`:

```powershell
npm run tauri android build -- --apk --target aarch64 --config src-tauri/tauri.standalone.conf.json
```

The `tauri.standalone.conf.json` overlay removes the dev-server address, so nothing in the APK points
at the PC. The owner-facing wrapper `scripts/build-android.ps1` (planned) picks this config.

**Installing.** Check the signer first (next section), then:

```powershell
adb install -r <path to the .apk>
```

`Success` is the only good answer. On `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, stop: the APK is signed
with a different key, and the only way past it is an uninstall, which wipes the app's data.

**Never `tauri android init` without a plan.** It regenerates `app/src-tauri/gen/android/` from the
template. Anything that can live in a plugin's own `AndroidManifest.xml` goes there; the rest is
re-applied by `python scripts/patch-android.py`. Diff `gen/android` after running both.

`librclone.so` (the phone's sync engine) is not in git: it is dropped by hand into
`app/src-tauri/plugins/soundhood-ytdl/android/src/main/jniLibs/arm64-v8a/`. Without it the APK builds
and the Proton box says the sync engine is not bundled.

## Signing

**One signing key for every APK that is installed on the phone. The keystore lives outside the
repository.** Android refuses to update an app with an APK signed by another key
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), and uninstalling wipes the app's data: the index, the Proton
Drive session, the cookie file, settings and downloaded models. The music on shared storage survives,
everything else has to be set up again.

- The release signing config in `app/src-tauri/gen/android/app/build.gradle.kts` reads a
  `keystore.properties` file **outside the repository**. Its path comes from the environment variable
  `SOUNDHOOD_KEYSTORE_PROPERTIES` and defaults to `%USERPROFILE%\.soundhood\keystore.properties`.
  `scripts/patch-android.py` re-applies the signing block after `tauri android init`.
- The file holds `storeFile` (absolute path of the keystore, also outside the repository), `keyAlias`
  and `password`, in the form Tauri's Android signing guide uses:

  ```properties
  storeFile=<absolute path of the .jks file>
  keyAlias=<alias>
  password=<keystore password>
  ```

- The keystore, its password and this file never enter git, CI, a log or a chat. Only the owner types
  the password. `*.jks`, `*.keystore` and `keystore.properties` are git-ignored as a second line of
  defence.
- CI builds a **debug** APK for build health only. It is signed with the runner's throwaway debug key
  and is never installed on the phone.
- Which keystore is "the" key (the one that signed the APKs already on the phone, or a new release key
  adopted with one deliberate reinstall) is recorded in [DECISIONS](DECISIONS.md) and tracked in
  [OPEN](OPEN.md) until done.

**Check the signer before every `adb install -r`.** Run from the repository root with the phone
attached; both lines printed at the end must be identical:

```powershell
$id = (Get-Content app\src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).identifier
$apksigner = Get-ChildItem "$env:ANDROID_HOME\build-tools\*\apksigner.bat" | Sort-Object FullName | Select-Object -Last 1
$newApk = "<path to the new .apk>"
adb pull ((adb shell pm path $id | Select-Object -First 1) -replace '^package:', '') installed.apk
& $apksigner verify --print-certs installed.apk | Select-String 'SHA-256'
& $apksigner verify --print-certs $newApk | Select-String 'SHA-256'
```

## Dev-loop traps

Each of these cost a debugging session once. The fix is encoded in the file named; keep it when you
touch that file.

| Trap | Fix | Encoded in |
|---|---|---|
| Tauri picks the VPN's network interface for the phone's dev URL | `devUrl` is pinned to the PC's LAN address; if the PC's address changes, edit that one line | `app/src-tauri/tauri.android.conf.json` |
| The phone cannot reach the dev server | Vite listens on `0.0.0.0` when building for the phone | `app/vite.config.ts` (`server.host`) |
| Every phone unlock re-scanned the library (the WebView drops the live-reload socket in the background, Vite answers with a full reload) | no hot reload on mobile (`hmr: false`); changes reach the phone by reopening the app | `app/vite.config.ts` (`server.hmr`) |
| A standalone APK still points at the PC's dev server | build it with the overlay that removes `devUrl` | `app/src-tauri/tauri.standalone.conf.json`, `scripts/build-android.ps1` (planned) |
| The desktop helper binaries break the Android build | the Android overlay empties `externalBin` | `app/src-tauri/tauri.android.conf.json` |
| `addPluginListener` is denied by the ACL | `register_listener` and `remove_listener` are in every mobile plugin's `COMMANDS` and default permission set | `app/src-tauri/plugins/soundhood-ytdl/build.rs`, `.../permissions/default.toml` |
| `tauri android init` wipes manifest edits and `MainActivity` | declarations live in plugin manifests; the rest is re-applied by the patch script | `app/src-tauri/plugins/*/android/src/main/AndroidManifest.xml`, `scripts/patch-android.py` |
| The Android WebView refuses `asset://` file URLs | playback on the phone reads the file's bytes over IPC; artwork via the asset protocol is verified on the device | `app/src/App.tsx` (playback), `read_file_bytes` / `cover_art` in the host |
| Android draws pause, gear and bolt characters as colour emoji | icons are SVG only; the token lint rejects emoji ranges in TSX | `tools/token-lint.mjs` |
| Android 15 forces edge-to-edge; content slides under the system bars | `enableEdgeToEdge()` before `super.onCreate`, then padding by the system-bar and cutout insets from Kotlin (never `env(safe-area-inset-*)`) | `MainActivity.kt`, template in `scripts/patch-android.py` |
| The bottom block's height changes with the mini player and insets | a `ResizeObserver` publishes it as `--mBottomH` | `app/src/App.tsx` |
| Python on the phone cannot reach `::1` (`getLoopbackAddress()` is IPv6) | the in-app relay binds `127.0.0.1` explicitly | `LocalProxy.kt` (`start`) |
| Wi-Fi advertises IPv6 that does not route; connections hang | the relay tries IPv4 addresses first | `LocalProxy.kt` (`connectAny`) |
| Python's own DNS and TLS stall on the phone | every yt-dlp and rclone byte goes through the relay; never bypass it | `YtdlPlugin.kt` (`--proxy`), `Rclone.kt` (`HTTP_PROXY`) |
| Tauri plugin commands run on the main thread | long Kotlin work runs on its own thread and long Rust calls in `spawn_blocking` | `YtdlPlugin.kt`, `plugins/soundhood-ytdl/src/commands.rs` |
| python, ffmpeg and rclone must exist as files to run | legacy JNI packaging and `extractNativeLibs` | `gen/android/app/build.gradle.kts`, `AndroidManifest.xml`, both via `scripts/patch-android.py` |
| The All-files permission screen left the page blank (a backgrounded WebView is throttled mid-load) | the request is delayed 2.5 s | `MainActivity.kt` |
| An APK signed with another key will not install, and uninstalling wipes app data | one key for every APK on the phone | [Signing](#signing) |
| `cargo check --target aarch64-linux-android` fails in SQLite's build script | use cargo-ndk | [The Cargo workspace](#the-cargo-workspace) |
| Renaming the settings store loses every saved setting | the store file keeps its old name, `music-hood.json` | `app/src/App.tsx` (`Store.load`) |

Kotlin files named without a folder live under `app/src-tauri/plugins/soundhood-ytdl/android/src/main/java/`
(the plugin) and `app/src-tauri/gen/android/app/src/main/java/` (`MainActivity.kt`).

## CI gates

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`; the build-gate
agent runs the same list locally before any merge. Nothing merges while one is red.

| Gate | Local command | CI job |
|---|---|---|
| Core tests, Windows and Linux | `cargo test -p soundhood-core` and `cargo test -p soundhood-core --all-features` | `core-test` |
| Core formatting | `cargo fmt -p soundhood-core -- --check` | `clippy` (Linux) |
| Lints, Linux and Windows | `cargo clippy --workspace -- -D warnings` | `clippy` |
| Core builds for the phone | `cargo ndk -t arm64-v8a check -p soundhood-core` (NDK r27 or newer) | `android-core` |
| Tooling: types, lint, unit tests | in `tools/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test` | `web` |
| UI builds | in `app/`: `npm ci`, `npm run build` | `web` |
| Design tokens | `node tools/token-lint.mjs` | `web` |
| Repository hygiene | `node tools/hygiene-lint.mjs` | `web` |
| Documentation links resolve | `node .github/scripts/md-links.mjs` | `web` |
| Visual suite | in `tools/`: `npm run test:visual` (diff report uploaded when it fails) | `visual` |
| No blue | `node tools/blue-scan.mjs` (after the visual suite) | `visual` |
| Desktop installer builds | in `app/`: `npm run tauri build` | `desktop-build` |
| Phone app builds | in `app/`: `npm run tauri android build -- --debug` | `android-build` |

The core tests include the fault-injection kill tests and, as later phases land, the yt-dlp
output, LRCLIB and Proton HTTP fixtures; none of them touches the network ([TESTING](TESTING.md)).

## Versions and releases

Semantic versioning, by merge order: each phase merge to `main` bumps the minor version (0.2.0, 0.3.0,
...) in whatever order the phases land; only Phase 7 may set 1.0.0. The version lives in
`app/src-tauri/tauri.conf.json`, with `app/package.json` and `app/src-tauri/Cargo.toml` kept equal;
Tauri derives the Android version code from it (it must never go down). The merge commit is tagged
`v<version>` and [CHANGELOG](../CHANGELOG.md) records the phase that became that version.

A `v*` tag starts `.github/workflows/release.yml`: it checks that the tag matches the app version,
builds the Windows installer and the Linux AppImage and .deb, and attaches them to a draft release.
The phone APK is built locally with the owner's key, never in CI.

## Public repository hygiene

The repository is public. Never commit a real library path, a person's name, a device identifier or
serial, a LAN address, a screenshot of a real library, a keystore, `cookies.txt` or any token. Tests
use temporary folders and synthetic paths, never a real library. Committed screenshots come from the
fixture library ([TESTING](TESTING.md#evidence-rules)). `node tools/hygiene-lint.mjs` enforces this in
CI; terms specific to the owner are supplied outside the repository (the `HYGIENE_DENY` secret in CI).
