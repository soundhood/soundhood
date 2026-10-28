# Phase 0 gate screenshots (real WebView2 window)

These ten screenshots come from the Phase 0 gate, round 2: a debug build of version 0.2.0 at commit
`8f80a7d`, running in the real WebView2 window on Windows, under a test identifier of its own (as
[DEV](../../../DEV.md#desktop) describes) so the installed app's data was never touched. The library is the generated fixture library the **Test library** switch
installs, so the folder line reads "Folder: test library" and no path is on screen. Each file was
captured at its exact size (1280x800 and 1920x1080, scale 1) over the DevTools protocol with
`Page.captureScreenshot` after `Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 1`
([TESTING](../../../TESTING.md#device-runs-with-the-fixture-root)), and passes
`node tools/blue-scan.mjs --strict`. The set per size: `library` (the library with the test library
shown), `library-dev` (the developer section open), `before-add` and `after-playlist-add` (a track
added to a playlist), and `undone` (that add undone). At `8f80a7d` the developer switch still read
"Use fixture root: on"; it now reads "Test library: on". The visual baselines of the current UI are in
[`after/`](../after/), the pre-rebuild screens in [`before-0.1.0/`](../before-0.1.0/).
