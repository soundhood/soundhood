#!/usr/bin/env node
// Parity grid (Phase 1 definition of done): for every screen shot at both the phone size and the
// desktop size, one image with the two side by side, scaled to the same height, on the app canvas
// colour (#0f0f0f) with a 16 px gap; then all of them stacked into parity-all.png. Images only, no
// text: the file name says which screen it is.
//
//   node screenshot/parity-grid.mjs --in <dir> --out <dir> [--phone 390x844] [--desktop 1280x800]
//   npm run evidence:parity -- --in screenshot/__screenshots__/win32 --out ../docs/evidence/<phase>/parity
//
// Input names follow the visual suite: <width>x<height>-<screen>.png. Writes parity-<screen>.png per
// paired screen and parity-all.png (screens in name order), lists the screens found at only one of
// the two sizes, and exits 1 when no screen pairs up.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { composePair, composeStack, pairScreens, parseSize } from "./parity.mjs";

function usage(message) {
  console.error(`parity-grid: ${message}`);
  console.error("usage: node screenshot/parity-grid.mjs --in <dir> --out <dir> [--phone 390x844] [--desktop 1280x800]");
  process.exit(2);
}

const opts = { phone: "390x844", desktop: "1280x800" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (!argv[i].startsWith("--") || !["in", "out", "phone", "desktop"].includes(key)) usage(`unknown argument ${argv[i]}`);
  if (i + 1 >= argv.length) usage(`${argv[i]} needs a value`);
  opts[key] = argv[++i];
}
if (!opts.in || !opts.out) usage("--in and --out are required");
let phone;
let desktop;
try {
  phone = parseSize(opts.phone);
  desktop = parseSize(opts.desktop);
} catch (e) {
  usage(e.message);
}

const inDir = path.resolve(opts.in);
let names;
try {
  names = readdirSync(inDir);
} catch {
  usage(`cannot read the folder ${inDir}`);
}
const { pairs, phoneOnly, desktopOnly } = pairScreens(names, phone, desktop);

const read = (name) => {
  const png = PNG.sync.read(readFileSync(path.join(inDir, name)));
  return { width: png.width, height: png.height, data: png.data };
};
const write = (file, img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  writeFileSync(file, PNG.sync.write(png));
};

const outDir = path.resolve(opts.out);
mkdirSync(outDir, { recursive: true });
const grids = [];
for (const { screen, phone: p, desktop: d } of pairs) {
  const grid = composePair(read(p), read(d));
  write(path.join(outDir, `parity-${screen}.png`), grid);
  grids.push(grid);
  console.log(`parity-grid: parity-${screen}.png  ${p} + ${d}`);
}
if (grids.length) write(path.join(outDir, "parity-all.png"), composeStack(grids));

const size = (s) => `${s.width}x${s.height}`;
if (phoneOnly.length) console.log(`parity-grid: only at ${size(phone)}: ${phoneOnly.join(", ")}`);
if (desktopOnly.length) console.log(`parity-grid: only at ${size(desktop)}: ${desktopOnly.join(", ")}`);
if (!grids.length) {
  console.log(`parity-grid: no screen in ${inDir} exists at both ${size(phone)} and ${size(desktop)}`);
  process.exit(1);
}
console.log(`parity-grid: ${grids.length} screens paired, parity-all.png written to ${outDir}`);
