// Builds the soundhood-tools CLI (manifest, fixture library, sidecar fetch, self-test) in release mode
// and copies it to app/src-tauri/bin/soundhood-tools-<target triple>[.exe], the name Tauri's
// `bundle.externalBin` expects, so the desktop installer ships it next to Soundhood.
//
//   npm run build:tools        (run by `beforeBuildCommand`, so `npm run tauri build` does it)
//
// Phone builds skip it: the Android overlay empties `externalBin`, and the CLI is a desktop tool.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
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

const cargoArgs = ["build", "--release", "-p", "soundhood-core", "--features", "tools", "--bin", "soundhood-tools"];
if (triple !== host) cargoArgs.push("--target", triple);
execFileSync("cargo", cargoArgs, { cwd: repo, stdio: "inherit" });

// Honour CARGO_TARGET_DIR and any workspace target-dir setting: ask cargo where it built.
const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: repo, encoding: "utf8" }),
);
const releaseDir = triple === host ? join(meta.target_directory, "release") : join(meta.target_directory, triple, "release");
const built = join(releaseDir, `soundhood-tools${ext}`);
if (!existsSync(built)) {
  console.error(`build:tools: cargo finished but ${built} is missing`);
  process.exit(1);
}

const dest = join(app, "src-tauri", "bin", `soundhood-tools-${triple}${ext}`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log(`build:tools: soundhood-tools -> src-tauri/bin/soundhood-tools-${triple}${ext}`);
