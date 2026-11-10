# Phase 1 gate screenshots (real WebView2 window and the phone)

The eight parity screens (`playlists`, `artists`, `folders`, `tracks` with Late Night open and Lunar
Comets paused, `playing`, `queue`, `search` for "glass", `settings` open over Folders) on the real
devices, taken on 2026-11-10 from the release builds of version 0.3.0 at commit `fccaec6`, with the
**Test library** switch on, so every song, artist and playlist on screen is generated and the folder
line reads "test library".

- **PC** (`1280x800-<screen>.png`, `1920x1080-<screen>.png`): the release build under a test
  identifier of its own (`tools/netlog/test-identity.conf.json`), so the installed app's data was
  never touched, in the real WebView2 window on Windows. Each file was captured at its exact size over
  the DevTools protocol (`Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 1`, then
  `Page.captureScreenshot`), as [TESTING](../../../TESTING.md#device-runs-with-the-fixture-root)
  describes. The test identity's data was deleted afterwards.
- **Phone** (`1116x2484-<screen>.png`): the release APK installed over the app on the phone (same
  signing key), the Test library switched on from the developer section, each screen captured with
  `adb shell screencap`, then the switch turned off and the developer section hidden again. The phone
  draws at its own size and with its system font scale; the status bar is the phone's own.
- [`parity/`](parity/) pairs them, the phone on the left and the PC at 1280x800 on the right:
  `npm run evidence:parity -- --in ../docs/evidence/phase-1/gate --out ../docs/evidence/phase-1/gate/parity --phone 1116x2484 --desktop 1280x800`
  (in `tools/`). All eight screens pair up; none is one-sided.

All files pass `node tools/blue-scan.mjs --strict`. `1280x800-settings.png` has a mask
(`1280x800-settings.mask.json`) over the sidebar's playlist covers blurred behind the Settings dialog:
there WebView2's blur mixes the aqua and purple fixture covers into near-black pixels of blue hue
(0.12 % of the shot), which the scan's rule for artwork leaves out. The mocked baselines of the same
screen pass without a mask.
