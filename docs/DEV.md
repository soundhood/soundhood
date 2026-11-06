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
| ffmpeg | any recent build, on `PATH` | desktop downloads (yt-dlp finds it on `PATH`; not bundled until Phase 2) and regenerating `core/fixtures/audio/` ([its README](../core/fixtures/audio/README.md)) |

## After a fresh clone

Git does not carry two things the desktop host needs to compile: the UI bundle (`app/dist/`, embedded
at compile time) and the helper programs listed under `bundle.externalBin` in
`app/src-tauri/tauri.conf.json` (`app/src-tauri/bin/<name>-<target triple>[.exe]` for yt-dlp, deno
and soundhood-tools). Until they exist, `npm run tauri dev`, `cargo clippy --workspace` and
`cargo check -p soundhood` stop with "resource path ... doesn't exist".

For a working desktop build, from `app/`:

```powershell
npm ci
npm run build:tools     # builds soundhood-tools in release mode into src-tauri/bin
npm run build           # app/dist
```

then, from the repository root, fetch the pinned yt-dlp and deno, verified against their published
checksums and `core/src/ytdlp/pins.rs` (`scripts/fetch-sidecars.ps1` does the same on Windows):

```powershell
cargo run -p soundhood-core --release --features tools --bin soundhood-tools -- fetch-sidecars app/src-tauri/bin
```

For lint-only work (clippy, `cargo check`, the host tests), empty placeholders do instead, as in CI:
`node .github/scripts/sidecars.mjs stub` from the repository root, plus `npm run build` in `app/` (or
any `app/dist/index.html`). A tree with placeholders compiles but must never be shipped;
`node .github/scripts/sidecars.mjs check` refuses them.

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

Core work, from the repository root (the clippy, host-test and phone-clippy lines need the
[fresh-clone preparation](#after-a-fresh-clone) first):

```powershell
cargo test -p soundhood-core                         # unit tests
cargo test -p soundhood-core --all-features          # plus kill-mid-write tests, sidecar manager, CLI
cargo fmt -p soundhood-core                          # 2-space house style (rustfmt.toml)
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p soundhood -p tauri-plugin-soundhood-ytdl   # host and plugin unit tests
cargo ndk -t arm64-v8a check -p soundhood-core       # does the core build for the phone?
cargo ndk -t arm64-v8a clippy -p soundhood -p tauri-plugin-soundhood-ytdl -- -D warnings   # phone-only Rust
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

From `app/`, after the [fresh-clone preparation](#after-a-fresh-clone):

```powershell
npm run tauri dev       # a dev window that reloads on UI changes
npm run tauri build     # the NSIS installer (see the artefact table)
```

**The first `tauri dev` after a fresh clone may time out.** Its before-dev step builds a debug
soundhood-tools, which compiles the whole core from cold, while the Tauri CLI waits only about three
minutes for the dev server that starts after it. If it gives up, run `npm run tauri dev` again: the
build is cached by then. To avoid it, build the debug CLI once beforehand, from the repository root:
`cargo build -p soundhood-core --features tools --bin soundhood-tools` (`npm run build:tools` builds
the release one, which the dev start does not use).

The owner-facing wrapper `scripts/build-windows.ps1` runs the same installer build, after building
the release soundhood-tools and fetching and checking the pinned yt-dlp and deno with it.

**The dev window is the installed app.** `npm run tauri dev` runs under the production identifier
(`identifier` in `app/src-tauri/tauri.conf.json`), so it reads and writes the installed app's
settings, index, journal and cookie file, and opens its library folder. For experiments, give it a
test identity of its own; its data then lives in separate folders that can be deleted afterwards:

```powershell
'{"identifier":"com.mgmat.soundhood.dev","productName":"Soundhood Dev"}' | Set-Content -Encoding ascii "$env:TEMP\soundhood-dev.json"
npm run tauri dev -- --config "$env:TEMP\soundhood-dev.json"
```

**Download helpers on the desktop.** `bundle.externalBin` lists `bin/yt-dlp`, `bin/deno` and
`bin/soundhood-tools`, so a desktop build needs all three in `app/src-tauri/bin/` under their
target-triple names (git-ignored, never committed). In Phase 0 the installer therefore still carries
yt-dlp and deno, as the app did before the rebuild (the migration rule in [DECISIONS](DECISIONS.md)):
what it carries is the pinned release, fetched and verified before the build. From Phase 2 the app
fetches them itself on first enable instead
([LEGAL](../LEGAL.md#how-the-desktop-download-helper-is-verified)). The fetch is
`soundhood-tools fetch-sidecars <dir>` (the Rust sidecar manager in `core/src/sidecars.rs`): it
downloads the pinned yt-dlp and deno releases over HTTPS, checks each file against the SHA-256 the
release publishes and the pin in `core/src/ytdlp/pins.rs`, refuses anything that does not match, and
installs them under the names Tauri expects. `scripts/fetch-sidecars.ps1` is a Windows convenience
that calls it (it rebuilds this checkout's release soundhood-tools first, a no-op when up to date, or
runs the one `-Tools` names), `scripts/build-windows.ps1` builds soundhood-tools and then fetches
with that very build before building the app, and the release workflow runs it before its
placeholder check. `node .github/scripts/sidecars.mjs check` then holds yt-dlp to its pinned hash, and
deno to its executable hash when `pins.rs` carries one (`exe_sha256`), else to its version.

**ffmpeg is not bundled yet.** On the PC yt-dlp uses the ffmpeg it finds on `PATH` (diagnostics say
"ffmpeg: from PATH"); Phase 2 bundles an LGPL build. CI compiles with empty placeholders
(`.github/scripts/sidecars.mjs stub`); release builds refuse placeholders
(`.github/scripts/sidecars.mjs check`).

Where the installed app keeps its files on Windows: the program in `%LOCALAPPDATA%\Soundhood\`; its
own files (settings in `music-hood.json`, `cookies.txt`, the device id, the index, caches, logs) in the
per-user app data and cache folders named after the app identifier (`identifier` in
`app/src-tauri/tauri.conf.json`). None of them is inside the library root.

## Phone (Android)

**Dev loop** (phone on USB with USB debugging on, PC and phone on the same Wi-Fi), from `app/`:

```powershell
npm run tauri android dev -- --host <PC LAN IP>
```

The app is built and installed on the phone, and its UI is loaded from the PC's Vite dev server at
that address. Always pass `--host`: without it the Tauri CLI picks a network interface by itself and,
with Proton VPN up, can pick the VPN's, which the phone cannot reach. Instead of `--host`,
`--force-ip-prompt` lists the interfaces to choose from. No LAN address is committed anywhere (the
hygiene lint refuses one).

**The dev loop installs over the real app.** It uses the production app id and signs with this PC's
debug key, so on the phone it replaces the installed app and works on its data (settings, index,
Proton session, library folder). That is safe only while the app on the phone is signed with this
PC's debug key (the [signer check](#signing) tells; which key is "the" key is still in
[OPEN](OPEN.md)). Once a release key is adopted, the dev install is refused with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`: stop there, never uninstall to get past it.

**Standalone APK** (runs without the PC), from `app/`:

```powershell
npm run tauri android build -- --apk --target aarch64 --config src-tauri/tauri.standalone.conf.json
```

The `tauri.standalone.conf.json` overlay removes the dev-server address, so nothing in the APK points
at the PC. The owner-facing wrapper `scripts/build-android.ps1` picks this config, prints the signer
and installs only over an app signed with the same key.

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
- The file holds four keys, all required (Gradle stops with "... lacks storePassword, keyPassword"
  when one is missing):

  ```properties
  storeFile=C:/Users/<you>/.soundhood/soundhood.jks
  storePassword=<keystore password>
  keyAlias=<alias>
  keyPassword=<key password>
  ```

  `storeFile` is the keystore's path, also outside the repository; a relative path is relative to the
  `keystore.properties` file. Write it with forward slashes, or double every backslash
  (`C:\\Users\\<you>\\...`): in a `.properties` file a single backslash is an escape character, so
  `C:\Users\<you>\k.jks` is read as `C:Users<you>k.jks` and the keystore is not found.
- Without a `keystore.properties` the release APK is signed with this PC's Android debug key
  (`%USERPROFILE%\.android\debug.keystore`) and Gradle prints a note saying so.

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
adb pull ((adb shell pm path $id | Select-Object -First 1) -replace '^package:', '').Trim() "$env:TEMP\installed.apk"
(& $apksigner verify --print-certs "$env:TEMP\installed.apk" | Select-String 'SHA-256').Line
(& $apksigner verify --print-certs $newApk | Select-String 'SHA-256').Line
```

## Dev-loop traps

Each of these cost a debugging session once. The fix is encoded in the file named; keep it when you
touch that file.

| Trap | Fix | Encoded in |
|---|---|---|
| Tauri picks the VPN's network interface for the phone's dev URL | pass `--host <PC LAN IP>` (or `--force-ip-prompt`) to `tauri android dev`; no LAN address is committed (the hygiene lint refuses one) | `app/vite.config.ts` (comment on `server.host`), `scripts/build-android.ps1` (header) |
| The phone cannot reach the dev server | Vite listens on `0.0.0.0` when building for the phone | `app/vite.config.ts` (`server.host`) |
| Every phone unlock re-scanned the library (the WebView drops the live-reload socket in the background, Vite answers with a full reload) | no hot reload on mobile (`hmr: false`); changes reach the phone by reopening the app | `app/vite.config.ts` (`server.hmr`) |
| A standalone APK still points at the PC's dev server | build it with the overlay that removes `devUrl` | `app/src-tauri/tauri.standalone.conf.json`, `scripts/build-android.ps1` |
| The dev build works on the installed app's data | a test identifier on the desktop; on the phone, the dev loop only while the installed app is debug-signed | [Desktop](#desktop), [Phone](#phone-android) |
| A fresh clone does not compile the host ("resource path ... doesn't exist") | build soundhood-tools, fetch the helpers, build `app/dist` (or stub them for lint-only work) | [After a fresh clone](#after-a-fresh-clone) |
| A backslash path in `keystore.properties` is not found | forward slashes or doubled backslashes | [Signing](#signing) |
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
| Lints, Linux and Windows | `cargo clippy --workspace --all-targets -- -D warnings` (after [the preparation](#after-a-fresh-clone)) | `clippy` |
| Host and plugin unit tests, Linux and Windows | `cargo test -p soundhood -p tauri-plugin-soundhood-ytdl` | `clippy` |
| Core builds for the phone | `cargo ndk -t arm64-v8a check -p soundhood-core` (NDK r27 or newer) | `android-core` |
| Phone-only Rust is lint-clean | `cargo ndk -t arm64-v8a clippy -p soundhood -p tauri-plugin-soundhood-ytdl -- -D warnings` | `android-core` |
| Tooling: types, lint, unit tests | in `app/`: `npm ci` first (the typecheck reads `app/`), then in `tools/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test` | `web` |
| UI builds | in `app/`: `npm run build` | `web` |
| Design tokens | `node tools/token-lint.mjs` | `web` |
| Repository hygiene | `node tools/hygiene-lint.mjs` | `web` |
| Documentation links resolve | `node .github/scripts/md-links.mjs` | `web` |
| Visual suite | in `tools/`: `npm run test:visual` (the failing screenshots are uploaded when it fails) | `visual` |
| No blue | `node tools/blue-scan.mjs` (after the visual suite) | `visual` |
| Desktop installer builds | in `app/`: `npm run tauri build` | `desktop-build` |
| Phone app builds | in `app/`: `npm run tauri android build -- --debug --apk --target aarch64` | `android-build` |

The core tests include the fault-injection kill tests and, as later phases land, the yt-dlp
output, LRCLIB and Proton HTTP fixtures; none of them touches the network ([TESTING](TESTING.md)).

## Versions and releases

Semantic versioning, by merge order: each phase merge to `main` bumps the minor version (0.2.0, 0.3.0,
...) in whatever order the phases land; only Phase 7 may set 1.0.0. A fix merged between phases bumps
the patch version (0.2.1) and gets its own CHANGELOG entry. The version lives in
`app/src-tauri/tauri.conf.json`, with `app/package.json` and `app/src-tauri/Cargo.toml` kept equal;
Tauri derives the Android version code from it (it must never go down). The merge commit is tagged
`v<version>` and [CHANGELOG](../CHANGELOG.md) records the phase that became that version.

A `v*` tag starts `.github/workflows/release.yml`: it checks that the tag matches the app version in
`tauri.conf.json` and that `app/package.json` and `app/src-tauri/Cargo.toml` carry the same version,
then on Windows and Linux builds soundhood-tools, fetches the pinned yt-dlp and deno with it
(verified), refuses any placeholder, builds the Windows installer and the Linux AppImage and .deb, and
attaches them to a draft release. The phone APK is built locally with the owner's key, never in CI.

## Public repository hygiene

The repository is public. Never commit a real library path, a person's name, a device identifier or
serial, a LAN address, a screenshot of a real library, a keystore, `cookies.txt` or any token. Tests
use temporary folders and synthetic paths, never a real library. Committed screenshots come from the
fixture library ([TESTING](TESTING.md#evidence-rules)); the lint cannot see inside an image, so check
every screenshot by eye for a real path or name before committing it. `node tools/hygiene-lint.mjs`
enforces the rest in CI; exactly what it checks is in [TESTING](TESTING.md#lints). Terms specific to
the owner are supplied outside the repository, in the `HYGIENE_DENY` CI secret (comma- or
newline-separated words, terms or SHA-256 hashes); the lint reads it and never prints its entries.
