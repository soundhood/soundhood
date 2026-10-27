// Checks the desktop sidecars that tauri.conf.json still lists under `bundle.externalBin`.
//
// tauri-build refuses to compile the desktop host when a listed sidecar
// (`app/src-tauri/<path>-<target triple>[.exe]`) is missing, and those binaries are never in git.
//
//   node .github/scripts/sidecars.mjs stub    CI build-health: create empty placeholders so the host
//                                             compiles; the result must never be shipped
//   node .github/scripts/sidecars.mjs check   release: fail if any listed sidecar is missing, a
//                                             placeholder, or not the pinned build
//
// `check` holds the bundled yt-dlp and deno to core/src/ytdlp/pins.rs, the same table the sidecar
// manager verifies against, so an installer never ships a build below the project's floor:
//   - yt-dlp: the file's SHA-256 must equal the bootstrap pin for the host triple (the pin is the hash
//     of the release's own executable, which `soundhood-tools fetch-sidecars` installs unchanged);
//   - deno: pins.rs pins the release zip, not the deno executable inside it, so the executable is held
//     to the pinned version instead (`deno --version` must say DENO_VERSION). Its SHA-256 is printed.
// Fix a failure with `scripts/fetch-sidecars.ps1` (or `soundhood-tools fetch-sidecars app/src-tauri/bin`).
//
// Once the sidecar manager fetches yt-dlp and deno at runtime, `externalBin` no longer lists them
// and both modes become no-ops for those two.
import { createHash } from "node:crypto";
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

/** The `PinnedAsset` rows of one `pub const <name>: &[PinnedAsset] = &[ ... ];` table in pins.rs. */
function pinTable(pins, name) {
  const block = new RegExp(`pub const ${name}: &\\[PinnedAsset\\] = &\\[([\\s\\S]*?)\\n\\];`).exec(pins)?.[1];
  if (!block) throw new Error(`pins.rs: table ${name} not found`);
  const rows = [];
  const row = /triple:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*sha256:\s*"([0-9a-f]{64})"/g;
  for (let m; (m = row.exec(block)); ) rows.push({ triple: m[1], name: m[2], sha256: m[3] });
  if (rows.length === 0) throw new Error(`pins.rs: table ${name} has no rows`);
  return rows;
}

/** The value of `pub const <name>: &str = "...";` in pins.rs. */
function pinConst(pins, name) {
  const v = new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(pins)?.[1];
  if (!v) throw new Error(`pins.rs: ${name} not found`);
  return v;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Why `file` (sidecar `bin`) is not the pinned build, or null when it is (or nothing is pinned). */
function pinProblem(bin, file, pins) {
  const tool = bin.split("/").pop();
  if (tool === "yt-dlp") {
    const pin = pinTable(pins, "YTDLP_BOOTSTRAP").find((p) => p.triple === host);
    if (!pin) return `no yt-dlp pin for ${host} in pins.rs`;
    const actual = sha256(file);
    console.log(`yt-dlp sha256 ${actual} (pinned ${pin.sha256}, ${pinConst(pins, "YTDLP_BOOTSTRAP_VERSION")})`);
    return actual === pin.sha256 ? null : `yt-dlp is not the pinned build (sha256 ${actual}, pinned ${pin.sha256})`;
  }
  if (tool === "deno") {
    const want = pinConst(pins, "DENO_VERSION");
    console.log(`deno sha256 ${sha256(file)}`);
    let said = "";
    try {
      said = execFileSync(file, ["--version"], { encoding: "utf8", timeout: 30_000 });
    } catch (e) {
      return `deno did not run (${e.message.split("\n")[0]})`;
    }
    const version = /^deno (\S+)/m.exec(said)?.[1] ?? "unknown";
    console.log(`deno version ${version} (pinned ${want})`);
    return version === want ? null : `deno is ${version}, pinned ${want}`;
  }
  return null;
}

const pins = mode === "check" ? readFileSync(join(repo, "core", "src", "ytdlp", "pins.rs"), "utf8") : "";
const missing = [];
const wrong = [];
for (const bin of bins) {
  const name = `${bin}-${host}${ext}`;
  const file = join(tauriDir, name);
  // An empty file is a placeholder from `stub`, never a real binary.
  if (existsSync(file) && (mode === "stub" || statSync(file).size > 0)) {
    console.log(`present: ${name}`);
    if (mode === "check") {
      const problem = pinProblem(bin, file, pins);
      if (problem) wrong.push(`${name}: ${problem}`);
    }
    continue;
  }
  if (mode === "stub") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    // GitHub annotation, so a run that stubbed is visibly not a shippable build.
    console.log(`::warning::stubbed sidecar ${name} (build-health only, never shipped)`);
  } else {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error(`::error::missing or placeholder sidecars: ${missing.join(", ")}`);
  console.error("Release builds never ship placeholders. Remove them from externalBin (the sidecar");
  console.error("manager fetches yt-dlp and deno at runtime) or fetch the bundled ones in the release job.");
}
for (const w of wrong) console.error(`::error::${w}`);
if (wrong.length > 0) {
  console.error("Release builds ship only the pinned yt-dlp and deno (core/src/ytdlp/pins.rs). Run");
  console.error("scripts/fetch-sidecars.ps1, or soundhood-tools fetch-sidecars app/src-tauri/bin, then check again.");
}
if (missing.length > 0 || wrong.length > 0) process.exit(1);
