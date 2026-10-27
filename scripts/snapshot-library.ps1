<#
Takes a snapshot of a Soundhood library before a session that may write to it: a manifest (size and
BLAKE3 hash of every audio file and of everything under _Playlists) saved as
<root>/_Soundhood/snapshots/<yyyy-MM-dd-HHmm>.json, and prints that file's path. Nothing else in the
library is touched; the snapshot itself sits in _Soundhood, which manifests leave out, so taking
one never changes the next one. Compare two snapshots with tools/manifest.ps1 -Before -After.
Uses soundhood-tools next to an installed Soundhood (%LOCALAPPDATA%\Soundhood), else
<repo>/target/release, building it there with cargo if neither exists.

  pwsh -File scripts/snapshot-library.ps1 -Root <library root>

Exit code: 0 written, 1 an error, 2 wrong arguments.
#>
param(
  [string] $Root
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Checked by hand (not a Mandatory parameter) so wrong arguments exit 2, not PowerShell's 1.
if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) {
  $host.UI.WriteErrorLine("usage: snapshot-library.ps1 -Root <library root>  (folder not found: '$Root')")
  exit 2
}

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

$Root = (Resolve-Path -LiteralPath $Root).Path
$tools = Find-SoundhoodTools

$dir = Join-Path $Root '_Soundhood/snapshots'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Never overwrite an earlier snapshot taken in the same minute.
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$out = Join-Path $dir "$stamp.json"
$n = 2
while (Test-Path -LiteralPath $out) {
  $out = Join-Path $dir "$stamp-$n.json"
  $n++
}

& $tools manifest $Root $out | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $out
