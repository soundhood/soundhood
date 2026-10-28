# lofty 0.25.5, patched for Soundhood

Upstream: <https://github.com/Serial-ATA/lofty-rs> (crates.io `lofty` 0.25.5), licensed MIT OR
Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`). Used through `[patch.crates-io]` in the root
`Cargo.toml`.

One change, in `src/mp4/ilst/write.rs` `write_free_atom`: the assertion `size > ATOM_HEADER_LEN`
becomes `size >= ATOM_HEADER_LEN`. `pad_atom` pads a shrunken MP4 tag with a `free` atom whenever the
tag shrank by 8 bytes or more, so a shrink of exactly 8 bytes asked for an 8-byte `free` atom (header
only, which is valid MP4) and hit the assertion. Every m4a edit whose new tag was exactly 8 bytes
shorter panicked, including the Undo of an edit that had added 8 bytes.

Drop this copy (and the patch entry) once an upstream release carries the fix.
