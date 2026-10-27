<#
.SYNOPSIS
  Builds the signed arm64 release APK, prints its signer, and installs it on the attached phone only
  when the phone's copy of the app was signed with the same key.

.DESCRIPTION
  Run from anywhere:   pwsh -File scripts\build-android.ps1 [-NoInstall] [-Serial <adb serial>]

  Build: `npm run tauri android build -- --apk --target aarch64 --config src-tauri/tauri.standalone.conf.json`
  in app\. The standalone config sets devUrl to null, so the UI is embedded and the APK runs without
  this PC.

  Signing: app\src-tauri\gen\android\app\build.gradle.kts reads a keystore.properties that lives
  outside the repo, from $env:SOUNDHOOD_KEYSTORE_PROPERTIES or else
  %USERPROFILE%\.soundhood\keystore.properties (keys: storeFile, storePassword, keyAlias, keyPassword).
  Without that file the APK is signed with this PC's Android debug key
  (%USERPROFILE%\.android\debug.keystore), which is what signed the builds installed so far.
  Android refuses an update signed with a different key, and uninstalling wipes the app's data
  (Proton login, settings), so this script compares signers before every install and stops on a
  mismatch.

  Dev loop (the phone loads the UI live from this PC's Vite server; nothing in the repo to edit):
      cd app
      npm run tauri android dev -- --host <PC LAN IP>
  Tauri points the app at that address and sets TAURI_DEV_HOST; app\vite.config.ts already listens on
  0.0.0.0 for mobile builds. Without --host the CLI guesses the network interface and can pick the VPN
  adapter; `npm run tauri android dev -- --force-ip-prompt` lists the interfaces to choose from.
#>
[CmdletBinding()]
param(
  # Build and print the signer, but do not touch the phone.
  [switch]$NoInstall,
  # adb serial of the phone, needed only when more than one device is attached.
  [string]$Serial,
  # Build even when librclone.so is missing (Proton sync will not work in that APK).
  [switch]$AllowMissingRclone
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
$packageId = 'com.mgmat.soundhood'
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

function Get-SdkTool([string]$name) {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
  if (-not $sdk) { throw 'ANDROID_HOME is not set' }
  if ($name -eq 'adb') {
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    if (Test-Path $adb) { return $adb }
    return (Get-Command adb -ErrorAction Stop).Source
  }
  # apksigner: from the newest build-tools that has it.
  $tool = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'apksigner.bat') } |
    Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
    Select-Object -First 1
  if (-not $tool) { throw "No apksigner in $sdk\build-tools" }
  return (Join-Path $tool.FullName 'apksigner.bat')
}

function Get-SignerSha256([string]$apk) {
  $out = & $script:apksigner verify --print-certs $apk 2>&1
  if ($LASTEXITCODE -ne 0) { throw "apksigner could not verify $apk`n$($out -join "`n")" }
  # "Signer #1 certificate SHA-256 digest: ..." on older build-tools, "V2 Signer: certificate ..." on 37+.
  $digests = @($out | ForEach-Object { "$_" } | Select-String -Pattern 'certificate SHA-256 digest: ([0-9a-f]{64})' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Unique)
  if ($digests.Count -eq 0) { throw "No signer certificate in $apk`n$($out -join "`n")" }
  if ($digests.Count -gt 1) { throw "More than one signer in ${apk}: $($digests -join ', ')" }
  return $digests[0]
}

# librclone.so is not in git (78 MB, built per machine); without it the APK has no Proton sync.
$rclone = Join-Path $app 'src-tauri\plugins\soundhood-ytdl\android\src\main\jniLibs\arm64-v8a\librclone.so'
if (-not (Test-Path $rclone)) {
  $msg = "librclone.so is missing: $rclone"
  if (-not $AllowMissingRclone) { throw "$msg (pass -AllowMissingRclone to build an APK without Proton sync)" }
  Write-Warning "$msg; this APK cannot sync with Proton Drive"
}

$keystoreProps = $env:SOUNDHOOD_KEYSTORE_PROPERTIES
if (-not $keystoreProps) { $keystoreProps = Join-Path $env:USERPROFILE '.soundhood\keystore.properties' }
if (Test-Path $keystoreProps) {
  $signedWith = "release key from $keystoreProps"
} else {
  $signedWith = 'this PC''s Android debug key (no keystore.properties found)'
  Write-Warning "No $keystoreProps : the APK will be signed with the Android debug key"
}

Push-Location $app
try {
  Install-NpmDependencies
  & npm run tauri android build -- --apk --target aarch64 --config src-tauri/tauri.standalone.conf.json
  if ($LASTEXITCODE -ne 0) { throw "npm run tauri android build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

# Gradle leaves the APK untouched when nothing changed, so the newest release APK is the current one.
$outputs = Join-Path $app 'src-tauri\gen\android\app\build\outputs\apk'
$apk = Get-ChildItem -Path $outputs -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq 'release' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "The build finished but no release APK is under $outputs" }
if ($apk.Name -like '*unsigned*') { throw "The release APK is unsigned: $($apk.FullName)" }

$script:apksigner = Get-SdkTool 'apksigner'
$signer = Get-SignerSha256 $apk.FullName
$schemes = @(& $script:apksigner verify --verbose $apk.FullName 2>&1 | ForEach-Object { "$_" } |
  Select-String -Pattern '^Verified using (v[\d.]+) scheme.*: true$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
$elapsed = (Get-Date) - $started

Write-Host ''
Write-Host ("APK:            {0}" -f $apk.FullName)
Write-Host ("Size:           {0:N1} MB" -f ($apk.Length / 1MB))
Write-Host ("Signed with:    {0}" -f $signedWith)
Write-Host ("Signer SHA-256: {0}" -f $signer)
Write-Host ("Schemes:        {0}" -f ($schemes -join ', '))
Write-Host ("Took:           {0}m{1:00}s" -f [int][math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds)

if ($NoInstall) { return }

$adb = Get-SdkTool 'adb'
$devices = @(& $adb devices | Select-String -Pattern '^(\S+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if ($Serial) {
  if ($devices -notcontains $Serial) { throw "adb does not see device $Serial (attached: $($devices -join ', '))" }
} elseif ($devices.Count -eq 0) {
  Write-Host ''
  Write-Host 'No phone attached (adb devices is empty): nothing installed.'
  return
} elseif ($devices.Count -gt 1) {
  throw "More than one device attached ($($devices -join ', ')): pass -Serial <serial>"
} else {
  $Serial = $devices[0]
}

$installedPath = (& $adb -s $Serial shell pm path $packageId 2>$null | Select-String -Pattern '^package:(.*base\.apk)$' |
  Select-Object -First 1)
if ($installedPath) {
  $remote = $installedPath.Matches[0].Groups[1].Value.Trim()
  $pulled = Join-Path ([IO.Path]::GetTempPath()) "soundhood-installed-$([guid]::NewGuid().ToString('N')).apk"
  try {
    & $adb -s $Serial pull $remote $pulled | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb pull $remote failed (exit $LASTEXITCODE)" }
    $installedSigner = Get-SignerSha256 $pulled
  } finally {
    Remove-Item -LiteralPath $pulled -ErrorAction SilentlyContinue
  }
  Write-Host ("Phone's signer: {0}" -f $installedSigner)
  if ($installedSigner -ne $signer) {
    Write-Host ''
    Write-Host 'NOT INSTALLED: the app on the phone was signed with a different key.'
    Write-Host 'Android would refuse this update, and uninstalling first would wipe the app''s data.'
    Write-Host 'Build with the key that signed the installed app (see the keystore notes at the top of this script).'
    exit 2
  }
} else {
  Write-Host "Phone: $packageId is not installed yet, installing fresh"
}

& $adb -s $Serial install -r $apk.FullName
if ($LASTEXITCODE -ne 0) { throw "adb install failed (exit $LASTEXITCODE)" }
Write-Host 'Installed.'
