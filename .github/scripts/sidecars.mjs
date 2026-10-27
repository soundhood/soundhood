// Checks the desktop sidecars that tauri.conf.json still lists under `bundle.externalBin`.
//
// tauri-build refuses to compile the desktop host when a listed sidecar
// (`app/src-tauri/<path>-<target triple>[.exe]`) is missing, and those binaries are never in git.
//
//   node .github/scripts/sidecars.mjs stub    CI build-health: create empty placeholders so the host
//                                             compiles; the result must never be shipped
//   node .github/scripts/sidecars.mjs check   release: fail if any listed sidecar is missing
//
// Once the sidecar manager fetches yt-dlp and deno at runtime, `externalBin` no longer lists them
// and both modes become no-ops for those two.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "stub" && mode !== "check") {
  console.error("usage: node .github/scripts/sidecars.mjs stub|check");
  process.exit(2);
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tauriDir = join(repo, "app", "src-tauri");
const conf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
const bins = conf.bundle?.externalBin ?? [];
if (bins.length === 0) {
  console.log("externalBin is empty: nothing to do");
  process.exit(0);
}

const host = /^host: (\S+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (!host) {
  console.error("could not read the host target triple from `rustc -vV`");
  process.exit(2);
}
const ext = host.includes("windows") ? ".exe" : "";

const missing = [];
for (const bin of bins) {
  const file = join(tauriDir, `${bin}-${host}${ext}`);
  // An empty file is a placeholder from `stub`, never a real binary.
  if (existsSync(file) && (mode === "stub" || statSync(file).size > 0)) {
    console.log(`present: ${bin}-${host}${ext}`);
    continue;
  }
  if (mode === "stub") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    // GitHub annotation, so a run that stubbed is visibly not a shippable build.
    console.log(`::warning::stubbed sidecar ${bin}-${host}${ext} (build-health only, never shipped)`);
  } else {
    missing.push(`${bin}-${host}${ext}`);
  }
}

if (missing.length > 0) {
  console.error(`::error::missing or placeholder sidecars: ${missing.join(", ")}`);
  console.error("Release builds never ship placeholders. Remove them from externalBin (the sidecar");
  console.error("manager fetches yt-dlp and deno at runtime) or fetch the bundled ones in the release job.");
  process.exit(1);
}
