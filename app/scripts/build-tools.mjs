// Builds the soundhood-tools CLI (manifest, fixture library, sidecar fetch, self-test) and copies it to app/src-tauri/bin/soundhood-tools-<target triple>[.exe], the name Tauri's
// `bundle.externalBin` expects, so the desktop installer ships it next to Soundhood.
//
//   npm run build:tools        (run by `beforeBuildCommand` and `beforeDevCommand`, so `npm run tauri
//                               build` and `npm run tauri dev` work from a fresh clone)
//
// Quick when nothing changed: cargo only checks its fingerprints, and the copy is skipped when the
// file in bin/ already has the same bytes (its timestamp then stays as it was).
//
// Phone builds skip it: the Android overlay empties `externalBin`, and the CLI is a desktop tool.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..");

// The Tauri CLI tells before-build commands what it is building for.
const platform = process.env.TAURI_ENV_PLATFORM ?? "";
if (platform === "android" || platform === "ios") {
  console.log(`build:tools: skipped for ${platform} (desktop-only CLI)`);
  process.exit(0);
}

const host = /^host: (\S+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (!host) {
  console.error("build:tools: could not read the host target triple from `rustc -vV`");
  process.exit(2);
}
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const ext = triple.includes("windows") ? ".exe" : "";

// `tauri dev` and `tauri build --debug` set TAURI_ENV_DEBUG=true: a debug build is quicker from a fresh
// clone (Tauri waits for the dev server, which starts after this, for about three minutes) and
// shares its compiled dependencies with the debug app build that follows. Release builds and a
// plain `npm run build:tools` build the release CLI the installer ships.
const debug = process.env.TAURI_ENV_DEBUG === "true";
const profile = debug ? "debug" : "release";
const cargoArgs = ["build", "-p", "soundhood-core", "--features", "tools", "--bin", "soundhood-tools"];
if (!debug) cargoArgs.splice(1, 0, "--release");
if (triple !== host) cargoArgs.push("--target", triple);
execFileSync("cargo", cargoArgs, { cwd: repo, stdio: "inherit" });

// Honour CARGO_TARGET_DIR and any workspace target-dir setting: ask cargo where it built.
const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: repo, encoding: "utf8" }),
);
const outDir = triple === host ? join(meta.target_directory, profile) : join(meta.target_directory, triple, profile);
const built = join(outDir, `soundhood-tools${ext}`);
if (!existsSync(built)) {
  console.error(`build:tools: cargo finished but ${built} is missing`);
  process.exit(1);
}

const dest = join(app, "src-tauri", "bin", `soundhood-tools-${triple}${ext}`);
const name = `src-tauri/bin/soundhood-tools-${triple}${ext}`;
const same =
  existsSync(dest) &&
  statSync(dest).size === statSync(built).size &&
  readFileSync(dest).equals(readFileSync(built));
if (same) {
  console.log(`build:tools: ${name} is up to date (${profile})`);
} else {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(built, dest);
  console.log(`build:tools: soundhood-tools (${profile}) -> ${name}`);
}
