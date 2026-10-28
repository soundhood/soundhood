<#
Fills the folder the desktop dev build takes its sidecars from (app/src-tauri/bin by default) with
yt-dlp and deno: downloads the pinned releases from GitHub over HTTPS, checks each file against the
SHA-256 the release publishes and the pin in core/src/ytdlp/pins.rs, refuses anything that does not
match, and installs them under the yt-dlp-<triple>.exe / deno-<triple>.exe names Tauri's
externalBin expects (a file only replaces an existing one once it has verified). It prints both
hashes per file. A development convenience over `soundhood-tools fetch-sidecars`, which runs the
same Rust sidecar manager (core/src/sidecars.rs) the desktop app uses.

Which soundhood-tools runs: the one -Tools names (scripts/build-windows.ps1 passes the copy
`npm run build:tools` has just built), else this repo's release build, rebuilt with cargo first (a
quick no-op when nothing changed), so the fetch code and the pins are always this checkout's. Only
when cargo is not installed does it fall back to the copy next to an installed Soundhood, and it
says so: that copy carries the installed version's pins.

  pwsh -File scripts/fetch-sidecars.ps1 [-Dest <folder>] [-Triple <target triple>] [-Tools <soundhood-tools.exe>]
#>
param(
  [string] $Dest,
  [string] $Triple,
  # The soundhood-tools executable to run; it must exist.
  [string] $Tools
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This repo's release soundhood-tools, built (or confirmed up to date) by cargo just now.
function Get-RepoSoundhoodTools {
  # Not $IsWindows: that variable exists only in PowerShell 6+, and Windows PowerShell 5.1 stops on
  # it under StrictMode.
  $exe = if ([Environment]::OSVersion.Platform -eq 'Win32NT') { 'soundhood-tools.exe' } else { 'soundhood-tools' }
  $repo = Split-Path -Parent $PSScriptRoot
  $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repo 'target' }
  $built = Join-Path $targetDir "release/$exe"
  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $installed = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Soundhood/$exe" } else { $null }
    if ($installed -and (Test-Path -LiteralPath $installed -PathType Leaf)) {
      Write-Warning "cargo is not installed: using the installed app's $installed, with that version's pins."
      return $installed
    }
    throw 'cargo is not installed and no installed Soundhood carries soundhood-tools.'
  }
  Write-Host 'soundhood-tools: building this checkout''s release build (a no-op when up to date)...'
  & cargo build --release -p soundhood-core --features tools --bin soundhood-tools --manifest-path (Join-Path $repo 'Cargo.toml') | Out-Host
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $built -PathType Leaf)) {
    throw "Could not build soundhood-tools (cargo exit code $LASTEXITCODE)."
  }
  return $built
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path $repo 'app/src-tauri/bin' }
if ($Tools) {
  if (-not (Test-Path -LiteralPath $Tools -PathType Leaf)) { throw "-Tools: no file at $Tools" }
} else {
  $Tools = Get-RepoSoundhoodTools
}
Write-Host "soundhood-tools: $Tools"

$toolArgs = @('fetch-sidecars', $Dest)
if ($Triple) { $toolArgs += @('--triple', $Triple) }
& $Tools @toolArgs
exit $LASTEXITCODE
