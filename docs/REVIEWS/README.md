# Phase reviews

Every phase closes only when four adversarial reviewers sign `phase-N.md` in this folder.
Any reviewer can block. Owner-verified items are tracked in [OPEN](../OPEN.md), never faked here.

| Reviewer | Charter | Blocks on |
|---|---|---|
| **Break the library** | Rubric = the three write tiers in [ARCHITECTURE](../ARCHITECTURE.md#the-one-write-path). Hunts any path that writes, moves or deletes a user file (audio, `_Playlists/**/*.m3u8`) outside `core::ingest::tagwrite`; any delete not via a bin; any watcher write; any m3u8 write outside the sole-writer path or the two sanctioned automatic rewrites; any lost m3u8 line; any orphaned temp file; any sync pass that can overwrite or resurrect a file; any write to existing files on first scan. | a user-file write without a journal entry and a confirm (or the auto policy) |
| **Break the build** | Runs the full CI list locally, including `cargo ndk -t arm64-v8a check -p soundhood-core` and `tauri android build`; checks every dev-loop trap in [DEV](../DEV.md), plugin `COMMANDS` vs permissions, manifest-in-plugin, main-thread rules, the APK signer before any install. | a red gate, or `main` that does not build both targets |
| **Break the design** | Visual suite, token lint, blue scan (scoped), parity grid, hygiene lint, and the owner's dislike list (blue, native scrollbars/selects, emoji glyphs, J/K, shortcut legends, white margins, double-tap to play, component soup, files appearing that he did not ask for). | any rule in the design system broken |
| **Break the network** | Fault-injects yt-dlp stdout/stderr fixtures, LRCLIB 429/503, Proton 429, sync conflict/rename fixtures, VPN-on; verifies no network call exists outside the allowed list (user-started downloads, online lookups behind their switch, helper update/repair). | a network call nobody asked for, or a retry loop on a refusal |

Each `phase-N.md` holds, per reviewer: scope checked, commands run with their result, findings
(fixed / accepted with reason / blocking), and the sign-off line `Signed: <reviewer>, <date>, <commit>`.
