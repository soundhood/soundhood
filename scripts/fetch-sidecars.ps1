<#
Fills the folder the desktop dev build takes its sidecars from (app/src-tauri/bin by default) with
yt-dlp and deno: downloads the pinned releases from GitHub over HTTPS, checks each file against the
SHA-256 the release publishes and the pin in core/src/ytdlp/pins.rs, refuses anything that does not
match, and installs them under the yt-dlp-<triple>.exe / deno-<triple>.exe names Tauri's
externalBin expects (a file only replaces an existing one once it has verified). It prints both
hashes per file. A development convenience over `soundhood-tools fetch-sidecars`, which runs the
same Rust sidecar manager (core/src/sidecars.rs) the desktop app uses. Uses
<repo>/target/release/soundhood-tools (built with cargo if missing), else the copy next to an
installed Soundhood.

  pwsh -File scripts/fetch-sidecars.ps1 [-Dest <folder>] [-Triple <target triple>]
#>
param(
  [string] $Dest,
  [string] $Triple
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Finds soundhood-tools: installed app first, then the repo's release build; builds it if absent.
function Find-SoundhoodTools {
  param([switch] $PreferRepo)
  $exe = if ($IsWindows) { 'soundhood-tools.exe' } else { 'soundhood-tools' }
  $repo = Split-Path -Parent $PSScriptRoot
  $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repo 'target' }
  $built = Join-Path $targetDir "release/$exe"
  $installed = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Soundhood/$exe" } else { $null }
  $candidates = if ($PreferRepo) { @($built, $installed) } else { @($installed, $built) }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  Write-Host 'soundhood-tools not found; building it (the first build takes a few minutes)...'
  & cargo build --release -p soundhood-core --features tools --bin soundhood-tools --manifest-path (Join-Path $repo 'Cargo.toml') | Out-Host
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $built -PathType Leaf)) {
    throw "Could not build soundhood-tools (cargo exit code $LASTEXITCODE)."
  }
  return $built
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path $repo 'app/src-tauri/bin' }
# A dev script: the repo's build carries the repo's pins, so it wins over an installed copy.
$tools = Find-SoundhoodTools -PreferRepo

$toolArgs = @('fetch-sidecars', $Dest)
if ($Triple) { $toolArgs += @('--triple', $Triple) }
& $tools @toolArgs
exit $LASTEXITCODE
