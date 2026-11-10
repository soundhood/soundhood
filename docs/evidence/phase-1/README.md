# Phase 1 evidence

These screenshots come from the Phase 1 gate run on commit `bfd88d5` (version 0.3.0), built from a
clean clone of the `phase-1` branch.

- [`after/`](after/) holds the visual suite's baselines of the eight screens the parity grid pairs
  (`playlists`, `artists`, `folders`, `tracks` with a playlist open and a song playing, `playing`,
  `queue` with the queue open, `search` for "glass", `settings` with the settings open over Folders),
  each at 390x844 and 834x1194 (phone layout) and 1280x800 and 1920x1080 (PC layout), named
  `<size>-<screen>.png`. They are copied unchanged from `tools/screenshot/__screenshots__/win32/`:
  Chromium with the Tauri backend mocked, over the generated fixture library
  ([TESTING](../../TESTING.md#visual-suite)), so every name and path on screen is made up (the
  Music folder reads `C:/Music` on the PC and `/storage/emulated/0/Music` on the phone). The visual
  suite passed on the same commit with no baseline changed.
- [`parity/`](parity/) holds the parity grid made from `after/` with
  `npm run evidence:parity -- --in ../docs/evidence/phase-1/after --out ../docs/evidence/phase-1/parity`
  (run in `tools/`, default sizes: the phone at 390x844 on the left, the PC at 1280x800 on the right):
  one `parity-<screen>.png` per screen and `parity-all.png` with all of them stacked. All eight
  screens paired; none is listed as one-sided
  ([TESTING](../../TESTING.md#evidence-rules)).

Both folders pass `node tools/blue-scan.mjs --strict`. The screenshots of the real WebView2 window
at 1280x800 and 1920x1080 (`gate/`) are not part of this set.
