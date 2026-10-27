<#
.SYNOPSIS
  Builds the Windows installer and prints where it is.

.DESCRIPTION
  Run from anywhere:   pwsh -File scripts\build-windows.ps1

  1. Installs the npm dependencies (npm ci) when app\node_modules is missing or older than
     app\package-lock.json.
  2. Runs `npm run tauri build` in app\ (release build + NSIS installer).
  3. Prints the installer path. The Cargo workspace puts every bundle under
     <repo>\target\release\bundle\nsis, not under app\src-tauri\target.

  The desktop sidecars (yt-dlp, deno) must sit in app\src-tauri\bin with their target-triple names
  until the sidecar manager fetches them on first enable; the script stops early when they are missing.
#>
[CmdletBinding()]
param()

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

$triple = 'x86_64-pc-windows-msvc'
$missing = @('yt-dlp', 'deno') | Where-Object {
  -not (Test-Path (Join-Path $app "src-tauri\bin\$_-$triple.exe"))
}
if ($missing) {
  throw ("Missing sidecar(s) in app\src-tauri\bin: " + (($missing | ForEach-Object { "$_-$triple.exe" }) -join ', '))
}

Push-Location $app
try {
  Install-NpmDependencies
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
