# Phase 1 evidence

The Phase 1 interface (version 0.3.0) on the fixture library, at the four sizes the visual suite
checks. The commit these files were made from, and the gate run that checked it, are named in the
[Phase 1 review](../../REVIEWS/phase-1.md).

- [`after/`](after/) holds the eight screens the parity grid pairs (`playlists`, `artists`,
  `folders`, `tracks` with a playlist open and a song playing, `playing`, `queue` with the queue
  open, `search` for "glass", `settings` with the settings open over Folders), each at 390x844 and
  834x1194 (phone layout) and 1280x800 and 1920x1080 (PC layout), named `<size>-<screen>.png`. They
  are not taken by hand: they are the visual suite's own baselines, copied unchanged from
  `tools/screenshot/__screenshots__/win32/` by `npm run evidence:after` (run in `tools/`), so they
  show exactly what every run of the suite compares against. Chromium draws them with the Tauri
  backend mocked, over the generated fixture library ([TESTING](../../TESTING.md#visual-suite)), so
  every name and path on screen is made up (the Music folder reads `C:/Music` on the PC and
  `/storage/emulated/0/Music` on the phone).
- [`parity/`](parity/) holds the parity grid made from `after/` with
  `npm run evidence:parity -- --in ../docs/evidence/phase-1/after --out ../docs/evidence/phase-1/parity`
  (run in `tools/`, default sizes: the phone at 390x844 on the left, the PC at 1280x800 on the right):
  one `parity-<screen>.png` per screen and `parity-all.png` with all of them stacked. All eight
  screens pair; none is listed as one-sided ([TESTING](../../TESTING.md#evidence-rules)).

To make them again after a change to the interface, in `tools/`: `npm run test:visual:update`, look
at every baseline it changed, then `npm run evidence:after` and the parity command above. The visual
suite then passes with no baseline changed, and both folders pass
`node tools/blue-scan.mjs --strict`.

The gate's screenshots of the real WebView2 window and of the phone are not part of this set and are
not made from the baselines; they are in [`gate/`](gate/) with a README of their own and a parity grid
from the real devices (the evidence rules in [TESTING](../../TESTING.md#evidence-rules)).
