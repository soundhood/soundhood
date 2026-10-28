<#
Builds a manifest of a Soundhood library root, or compares two manifests. A manifest records the
size and BLAKE3 hash of every audio file and of everything under _Playlists (the _Soundhood
bookkeeping folder is left out, because it changes in every session). Comparing prints one plain
line, "Identical", or "N files changed:" followed by one line per path, so the before/after check
of a session reads as a sentence. PowerShell has no BLAKE3, so this is a thin wrapper over the
soundhood-tools program: it uses the copy next to an installed Soundhood (%LOCALAPPDATA%\Soundhood),
else <repo>/target/release, and builds it there with cargo if neither exists.

  pwsh -File tools/manifest.ps1 -Root <library root> -Out <manifest.json>
  pwsh -File tools/manifest.ps1 -Before <before.json> -After <after.json>

Exit code: 0 identical / written, 1 differences or an error, 2 wrong arguments.
#>
param(
  [string] $Root,
  [string] $Out,
  [string] $Before,
  [string] $After
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Checked by hand (not Mandatory parameters) so wrong arguments exit 2, not PowerShell's 1.
$build = $Root -and $Out -and -not ($Before -or $After)
$compare = $Before -and $After -and -not ($Root -or $Out)
if (-not ($build -or $compare)) {
  $host.UI.WriteErrorLine('usage: manifest.ps1 -Root <library root> -Out <manifest.json>')
  $host.UI.WriteErrorLine('       manifest.ps1 -Before <before.json> -After <after.json>')
  exit 2
}

# Finds soundhood-tools: installed app first, then the repo's release build; builds it if absent.
function Find-SoundhoodTools {
  param([switch] $PreferRepo)
  # Not $IsWindows: that variable exists only in PowerShell 6+, and Windows PowerShell 5.1 (the
  # `powershell` in OWNER_GUIDE) stops on it under StrictMode.
  $exe = if ([Environment]::OSVersion.Platform -eq 'Win32NT') { 'soundhood-tools.exe' } else { 'soundhood-tools' }
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

$tools = Find-SoundhoodTools
if ($build) {
  & $tools manifest $Root $Out
} else {
  & $tools diff $Before $After
}
exit $LASTEXITCODE
