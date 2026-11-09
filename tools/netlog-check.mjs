#!/usr/bin/env node
// Net-log check of the PC app, once per release (docs/TESTING.md, "Per-release net-log check"):
// starts a built desktop app under a test identity with WebView2's network log on, lets it run,
// closes its window normally and fails on any host other than tauri.localhost, ipc.localhost and
// asset.localhost in the log, on a TCP or UDP exchange with a non-loopback address in the log,
// and on any TCP connection with a non-loopback address owned by the app's process tree while it
// ran (Get-NetTCPConnection, polled; the tree found by parent id and creation time). Windows only.
//
//   node tools/netlog-check.mjs [app.exe] [--seconds 120] [--keep] [--no-library]
//
// app.exe defaults to target/release/soundhood.exe. It must be a build with the test identity
// (tools/netlog/test-identity.conf.json), so the run gets its own settings, index and journal and
// never touches the installed app's data; a built exe cannot take --config, and the app's data
// folders cannot be moved from outside without an app change. Build it, from app/:
//
//   npm run tauri build -- --no-bundle --config ../tools/netlog/test-identity.conf.json
//
// The script refuses an exe that does not carry the test identifier. It seeds the test identity with
// the fixture library (soundhood-tools fixture-lib, next to the exe) so the app scans a library at
// startup, puts WebView2's own data in a scratch folder (WEBVIEW2_USER_DATA_FOLDER) and passes only
// --log-net-log through WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (never a --disable-features there: it
// would replace the app's own list). Everything it creates is removed afterwards unless --keep.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { REPO_ROOT } from "./lint/common.mjs";
import { foldPolls, judgeNetLog, parseNetLog } from "./netlog/netlog.mjs";

const TOOL = "netlog-check";
const log = (line) => console.log(`${TOOL}: ${line}`);
const fail = (line, code = 1) => {
  console.error(`${TOOL}: ${line}`);
  process.exit(code);
};

if (process.platform !== "win32") {
  log(`skipped, Windows only (the desktop app's WebView2 and Get-NetTCPConnection); this is ${process.platform}`);
  process.exit(0);
}

// ---- arguments ----
const opts = { seconds: 120, keep: false, library: true, exe: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--keep") opts.keep = true;
  else if (a === "--no-library") opts.library = false;
  else if (a === "--seconds") {
    opts.seconds = Number(argv[++i]);
    if (!Number.isFinite(opts.seconds) || opts.seconds < 5) fail("--seconds needs a number of at least 5", 2);
  } else if (a.startsWith("--")) fail(`unknown argument ${a}`, 2);
  else if (opts.exe) fail(`one app path only, got ${opts.exe} and ${a}`, 2);
  else opts.exe = a;
}
const exe = path.resolve(opts.exe ?? path.join(REPO_ROOT, "target", "release", "soundhood.exe"));
if (!existsSync(exe)) fail(`${exe} does not exist; build it first (see the header of tools/netlog-check.mjs)`, 2);

// ---- identity: refuse anything that could be the installed app's ----
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const productionId = readJson(path.join(REPO_ROOT, "app", "src-tauri", "tauri.conf.json")).identifier;
const testId = readJson(path.join(REPO_ROOT, "tools", "netlog", "test-identity.conf.json")).identifier;
if (!testId || testId === productionId) fail(`the test identifier must differ from the app's (${productionId})`, 2);
if (readFileSync(exe).indexOf(Buffer.from(testId, "utf8")) < 0) {
  fail(
    `${path.basename(exe)} does not carry the test identifier ${testId}, so it would run on the installed app's ` +
      "data. Build it from app/ with: npm run tauri build -- --no-bundle --config ../tools/netlog/test-identity.conf.json",
    2,
  );
}

const roaming = process.env.APPDATA;
const local = process.env.LOCALAPPDATA;
if (!roaming || !local) fail("APPDATA and LOCALAPPDATA must be set", 2);
const testDirs = [path.join(roaming, testId), path.join(local, testId)];
const productionDirs = [path.join(roaming, productionId), path.join(local, productionId)];

/** Removes one of this check's own folders: only a test identity folder or the scratch folder. */
function removeOwn(dir, scratch) {
  const own = testDirs.includes(dir) || (scratch && dir === scratch);
  if (!own) throw new Error(`refusing to remove ${dir}`);
  for (let attempt = 0; attempt < 10 && existsSync(dir); attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // WebView2 can hold a file for a moment after it exits: wait half a second and try again.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  if (existsSync(dir)) log(`could not remove ${dir}; delete it by hand`);
}

/** Newest modification time under `dir` (ms), 0 when it does not exist. */
function newestMtime(dir) {
  let newest = 0;
  const visit = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      try {
        newest = Math.max(newest, statSync(abs).mtimeMs);
      } catch {
        continue;
      }
      if (e.isDirectory()) visit(abs);
    }
  };
  visit(dir);
  return newest;
}

// ---- scratch, seed ----
for (const d of testDirs) removeOwn(d); // what a previous run left with --keep
const scratch = path.join(os.tmpdir(), `soundhood-netlog-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const netLogFile = path.join(scratch, "net-log.json");
const webviewData = path.join(scratch, "webview2");

if (opts.library) {
  const tools = path.join(path.dirname(exe), "soundhood-tools.exe");
  if (existsSync(tools)) {
    const library = path.join(scratch, "library");
    execFileSync(tools, ["fixture-lib", library], { stdio: "ignore" });
    // The settings store of the test identity (tauri-plugin-store, app data folder; the file keeps
    // the pre-rebuild name, docs/DEV.md "Dev-loop traps"), pointed at the fixture library.
    mkdirSync(testDirs[0], { recursive: true });
    writeFileSync(path.join(testDirs[0], "music-hood.json"), JSON.stringify({ library_dir: library }, null, 2));
    log("seeded the test identity with the fixture library");
  } else {
    log(`no ${path.basename(tools)} next to the app: it starts without a library`);
  }
}
const productionBefore = productionDirs.map(newestMtime);

// ---- run ----
const POLL_MS = 1000;
const POLLER = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $procs = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object {
    @{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; created = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } })
  $conns = @(Get-NetTCPConnection | Where-Object { $_.State -ne 'Listen' -and $_.State -ne 'Bound' } | ForEach-Object {
    @{ pid = [int]$_.OwningProcess; remote = [string]$_.RemoteAddress; remotePort = [int]$_.RemotePort; state = $_.State.ToString() } })
  [Console]::Out.WriteLine((@{ t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); procs = $procs; conns = $conns } | ConvertTo-Json -Compress -Depth 4))
  Start-Sleep -Milliseconds ${POLL_MS}
}`;

const env = { ...process.env };
env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--log-net-log=${netLogFile}`;
env.WEBVIEW2_USER_DATA_FOLDER = webviewData;
const started = Date.now();
const app = spawn(exe, [], { env, stdio: "ignore" });
let appExit = null;
app.on("exit", (code) => (appExit = { code, at: Date.now() }));
log(`started ${path.basename(exe)} (pid ${app.pid}, identity ${testId}); watching for ${opts.seconds} s`);

const polls = [];
const poller = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", POLLER], { stdio: ["ignore", "pipe", "ignore"] });
createInterface({ input: poller.stdout }).on("line", (line) => {
  try {
    polls.push(JSON.parse(line));
  } catch {
    // a partial line at shutdown
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const problems = [];
for (let waited = 0; waited < opts.seconds * 1000 && !appExit; waited += 500) await sleep(500);
if (appExit) problems.push(`the app exited by itself after ${Math.round((appExit.at - started) / 1000)} s (code ${appExit.code})`);

if (!appExit) {
  // Close the window as a user would (WM_CLOSE): a killed WebView2 leaves a truncated net log.
  const closed = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${app.pid}).CloseMainWindow()`],
    { encoding: "utf8" },
  ).trim();
  if (closed !== "True") problems.push(`the app has no main window to close (CloseMainWindow said ${closed || "nothing"})`);
  for (let waited = 0; waited < 30000 && !appExit; waited += 250) await sleep(250);
  if (!appExit) {
    problems.push("the app did not exit within 30 s of closing its window; killed it, so the net log may be cut off");
    execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  }
}
// WebView2 writes the end of the net log as its browser process shuts down, after the app exits.
const tree = foldPolls(polls, app.pid);
for (let waited = 0; waited < 30000 && [...tree.pids].some((p) => p !== app.pid && alive(p)); waited += 250) await sleep(250);
await sleep(POLL_MS);
poller.kill();

// ---- verdict ----
if (!existsSync(netLogFile)) problems.push("WebView2 wrote no net log (was --log-net-log passed through?)");
const net = existsSync(netLogFile) ? judgeNetLog(parseNetLog(readFileSync(netLogFile, "utf8"))) : null;
const tcp = foldPolls(polls, app.pid);

if (net) {
  log(`net log: ${net.events} events, ${net.complete ? "complete" : "CUT OFF (not valid JSON)"}; hosts seen: ${net.allowedHosts.join(", ") || "none"}`);
  if (!net.complete) problems.push("the net log is cut off: the window was not closed normally");
  for (const h of net.badHosts) problems.push(`net log names the host ${h.host} (${h.count}x, first in ${h.event})`);
  for (const s of net.tcp) problems.push(`net log: TCP to ${s.ip}:${s.port} (${s.event})`);
  for (const s of net.udp) problems.push(`net log: UDP traffic with ${s.ip}:${s.port}`);
  for (const s of net.probes) log(`note: UDP connect without a packet to ${s.ip}:${s.port} (the IPv6 reachability probe)`);
}
log(`TCP polls: ${polls.length}, ${tcp.pids.size} processes in the app's tree`);
if (polls.length < Math.min(5, opts.seconds / 2)) problems.push(`only ${polls.length} TCP polls arrived: the poller did not run`);
for (const c of tcp.remote) problems.push(`TCP connection from pid ${c.pid} to ${c.remote}:${c.remotePort} (${c.state})`);

const productionAfter = productionDirs.map(newestMtime);
productionDirs.forEach((d, i) => {
  if (productionAfter[i] > productionBefore[i]) {
    log(`warning: the installed app's data folder changed during the run (${d}); is the installed Soundhood open?`);
  }
});

if (opts.keep) {
  log(`kept the net log and scratch data in ${scratch} and the test identity folders ${testDirs.join(", ")}`);
} else {
  for (const d of testDirs) removeOwn(d);
  removeOwn(scratch, scratch);
}

if (problems.length) {
  for (const p of problems) console.log(`${TOOL}: FAIL ${p}`);
  process.exit(1);
}
log(`PASS: only ${net.allowedHosts.join(", ")} in the net log, no remote TCP from the app's process tree`);
