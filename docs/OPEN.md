# Open items

Everything not verified yet, so no gap is hidden. An item leaves this table when it is verified (by
the owner for owner-verified items, by a test, log or screenshot otherwise) or decided in
[DECISIONS](DECISIONS.md); the owner report names every open owner-verified item until it is ticked.
Owner tests are described in [OWNER_TESTS](OWNER_TESTS.md).

| Item | Why open | Owner-verified? | Since |
|---|---|---|---|
| Phase 0 owner test 1: the PC app looks and behaves as before | needs the owner's eyes on his own install | yes | 2026-10-27 |
| Phase 0 owner test 2: the phone app looks and behaves as before | needs the owner's eyes on his own phone | yes | 2026-10-27 |
| Phase 0 owner test 3: pasting a link still downloads on the PC | needs his network and a real download | yes | 2026-10-27 |
| Phase 0 owner test 4: "Undo last change" names a tag edit and reverts it | needs his own edit on his library | yes | 2026-10-27 |
| Phase 0 owner test 5: a track deleted on the phone comes back with Undo | needs his phone and library | yes | 2026-10-27 |
| Phase 0 owner test 6: snapshots before and after a normal session compare `Identical` | needs his library | yes | 2026-10-27 |
| Which key signs every APK installed on the phone | the APKs on the phone so far appear to be signed with a development machine's debug key (the signer check in [DEV](DEV.md#signing) confirms it); adopting a new release key means one deliberate reinstall, which wipes the app's data. The choice is recorded in DECISIONS and the keystore is created by the owner (never by an agent) | yes | 2026-10-27 |
| "Rebuild index" on the phone finishes in under 2 minutes for the real library | measured from the log on the owner's phone with his library | no (agent reads the log) | 2026-10-27 |
| Which rclone version is inside the phone's `librclone.so` | the binary is dropped in by hand and its version is not recorded; versions before 1.75.2 have a known Proton Drive upload bug | no | 2026-10-27 |
| Android WebView and OS version on the phone | read over adb, then recorded in DECISIONS | no | 2026-10-27 |
| Driving the phone's WebView over the DevTools protocol | not yet shown to work with Tauri's WebView; the fallback is deep-link commands | no | 2026-10-27 |
| The minified release APK downloads, updates the helper and syncs on a device | the release build shrinks code; the download library ships no keep rules of its own | no | 2026-10-27 |
| CI workflows run green on GitHub's runners | written and validated locally, not yet run on GitHub | no | 2026-10-27 |
| Release workflow produces installable artefacts | skeleton; completed in Phase 7 (macOS, smoke tests, bundled ffmpeg) | no | 2026-10-27 |
| Questions waiting for the owner: Android Auto yes or no (and cable or wireless); AcoustID key and LRCLIB App-Id | asked once in the Phase 0 report; the stated defaults apply until answered | yes | 2026-10-27 |
| Repository history predates the hygiene rules | only a history rewrite cleans old commits; the owner's decision | yes | 2026-10-27 |
