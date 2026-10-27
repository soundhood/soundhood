<#
.SYNOPSIS
  Builds the Windows installer and prints where it is.

.DESCRIPTION
  Run from anywhere:   pwsh -File scripts\build-windows.ps1 [-SkipSidecarFetch]

  1. Installs the npm dependencies (npm ci) when app\node_modules is missing or older than
     app\package-lock.json.
  2. Fetches yt-dlp and deno into app\src-tauri\bin with scripts\fetch-sidecars.ps1: the pinned
     releases from GitHub over HTTPS, each checked against the release's published SHA-256 and the
     pin in core\src\ytdlp\pins.rs before it replaces the file there. -SkipSidecarFetch keeps
     what bin\ holds (an offline rebuild); step 4 still holds it to the pins.
  3. Builds soundhood-tools (npm run build:tools), the third bundled helper.
  4. Checks every bundled helper (node .github\scripts\sidecars.mjs check): present, not a
     placeholder, and yt-dlp and deno exactly the pinned builds. Stops here when one is not.
  5. Runs `npm run tauri build` in app\ (release build + NSIS installer).
  6. Prints the installer path. The Cargo workspace puts every bundle under
     <repo>\target\release\bundle\nsis, not under app\src-tauri\target.

  Until the sidecar manager fetches yt-dlp and deno on first enable, the installer carries them, so
  it must carry the pinned ones: an older vendored yt-dlp is below the project's floor.
#>
[CmdletBinding()]
param(
  # Use the yt-dlp and deno already in app\src-tauri\bin instead of fetching them (no network).
  [switch] $SkipSidecarFetch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
$started = Get-Date

function Install-NpmDependencies {
  # npm ci wipes node_modules, so only run it when the lock file is newer than the last install.
  $lock = Join-Path $app 'package-lock.json'
  $installed = Join-Path $app 'node_modules\.package-lock.json'
  if ((Test-Path $installed) -and ((Get-Item $installed).LastWriteTime -ge (Get-Item $lock).LastWriteTime)) {
    Write-Host 'npm dependencies: up to date'
    return
  }
  Write-Host 'npm dependencies: installing (npm ci)'
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
}

Push-Location $app
try {
  Install-NpmDependencies

  if ($SkipSidecarFetch) {
    Write-Host 'sidecars: using what app\src-tauri\bin holds (-SkipSidecarFetch)'
  } else {
    Write-Host 'sidecars: fetching the pinned yt-dlp and deno (verified)'
    & (Join-Path $PSScriptRoot 'fetch-sidecars.ps1')
    if ($LASTEXITCODE -ne 0) { throw "fetching the sidecars failed (exit $LASTEXITCODE); nothing was built" }
  }

  & npm run build:tools
  if ($LASTEXITCODE -ne 0) { throw "npm run build:tools failed (exit $LASTEXITCODE)" }

  & node (Join-Path $repo '.github\scripts\sidecars.mjs') check
  if ($LASTEXITCODE -ne 0) {
    throw 'The bundled helpers are not the pinned builds (see above); run without -SkipSidecarFetch.'
  }

  & npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "npm run tauri build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

$nsis = Join-Path $repo 'target\release\bundle\nsis'
$installer = Get-ChildItem -Path $nsis -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer -or $installer.LastWriteTime -lt $started) {
  throw "The build finished but no new installer is in $nsis"
}

$elapsed = (Get-Date) - $started
Write-Host ''
Write-Host ("Installer: {0}" -f $installer.FullName)
Write-Host ("Size:      {0:N1} MB" -f ($installer.Length / 1MB))
Write-Host ("Took:      {0}m{1:00}s" -f [int][math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds)
