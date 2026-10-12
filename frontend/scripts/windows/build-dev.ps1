param(
  [ValidateSet('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc')]
  [string]$Target = 'x86_64-pc-windows-msvc',
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This script requires a Windows build host' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $root
function Invoke-Checked([string]$Program, [string[]]$CallArguments) {
  & $Program @CallArguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit $LASTEXITCODE" }
}
$source = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Build provenance requires the source Git commit' }
$recordDir = Join-Path $root "target\windows-dev\$source\$Target"
New-Item -ItemType Directory -Path $recordDir -Force | Out-Null
$env:CARGO_TARGET_DIR = Join-Path $root 'target\windows-dev\cargo'
$env:CMAKE_GENERATOR = 'Ninja'
$env:CMAKE_POLICY_VERSION_MINIMUM = '3.5'
# Windows ONNX is loaded from the separately pinned Microsoft DLLs; do not stage
# a second runtime via ort-sys's build-time downloader.
$env:ORT_SKIP_DOWNLOAD = '1'
$redistArch = if ($Target -eq 'aarch64-pc-windows-msvc') { 'arm64' } else { 'x64' }
$redistRoot = Join-Path $env:VCToolsRedistDir $redistArch
$crt = @(Get-ChildItem $redistRoot -Directory -Filter 'Microsoft.VC*.CRT' | Sort-Object Name -Descending)[0]
if (!$crt) { throw 'Matching Microsoft redistributable CRT directory is missing' }
$runtimeDir = Join-Path $root 'frontend\src-tauri\binaries\msvc-runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$runtimeRecords = @()
foreach ($dll in Get-ChildItem $crt.FullName -Filter '*.dll') {
  $signature = Get-AuthenticodeSignature $dll.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw "Microsoft CRT signature verification failed: $($dll.Name)"
  }
  Copy-Item $dll.FullName $runtimeDir
  $runtimeRecords += [ordered]@{Name=$dll.Name;SHA256=(Get-FileHash $dll.FullName -Algorithm SHA256).Hash.ToLowerInvariant();Publisher=$signature.SignerCertificate.Subject;Authenticode=$signature.Status.ToString()}
}
foreach ($required in @('msvcp140.dll','msvcp140_1.dll','vcruntime140.dll')) {
  if (!(Test-Path (Join-Path $runtimeDir $required))) { throw "Missing required Microsoft CRT: $required" }
}
$bash = 'C:\msys64\usr\bin\bash.exe'
if (!(Test-Path $bash)) { throw 'MSYS2 GNU make/bash are required for the pinned FFmpeg source build' }
if (!(Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'Initialize the matching MSVC developer environment first' }
Invoke-Checked $bash @('--noprofile','--norc','frontend/scripts/ffmpeg/build-windows.sh',$Target)
$ffmpeg = Join-Path $root "frontend\src-tauri\binaries\ffmpeg-$Target.exe"
$env:TETRO_WINDOWS_FFMPEG_TARGET = $Target
$env:TETRO_WINDOWS_FFMPEG_SHA256 = (Get-FileHash $ffmpeg -Algorithm SHA256).Hash.ToLowerInvariant()
$env:TETRO_WINDOWS_FFMPEG_SIZE = (Get-Item $ffmpeg).Length.ToString([Globalization.CultureInfo]::InvariantCulture)
$ffmpegWork = Join-Path $root "target\windows-dev\dependencies\ffmpeg\8.0.3\$Target"
Copy-Item (Join-Path $ffmpegWork 'COPYING.LGPLv2.1') (Join-Path $root 'frontend\src-tauri\binaries\ffmpeg-LICENSE.txt')
Invoke-Checked 'node' @('frontend/scripts/windows/smoke-ffmpeg.mjs',$ffmpeg,$Target,(Join-Path $recordDir 'ffmpeg-smoke'))
Invoke-Checked 'cargo' @('build','--locked','--release','--target',$Target,'-p','llama-helper')
$releaseDir = Join-Path $env:CARGO_TARGET_DIR "$Target\release"
Copy-Item (Join-Path $releaseDir 'llama-helper.exe') (Join-Path $root "frontend\src-tauri\binaries\llama-helper-$Target.exe")
Invoke-Checked 'pnpm.cmd' @('--dir','frontend','exec','tauri','build','--config','src-tauri/tauri.dev.conf.json','--config','src-tauri/tauri.windows-dev.conf.json','--features','dev-profile','--target',$Target,'--bundles','nsis','--ci','--','--locked')
$inspect = @"
import { assertWindowsMachine } from './frontend/scripts/windows/pe.mjs';
import { existsSync, readdirSync } from 'node:fs';
const app = '$($releaseDir.Replace('\','/'))/tetro-dev.exe';
if (!existsSync(app)) throw new Error('Missing isolated Dev executable');
for (const path of [app, '$($ffmpeg.Replace('\','/'))', '$($releaseDir.Replace('\','/'))/llama-helper.exe', 'frontend/src-tauri/binaries/onnxruntime/onnxruntime.dll', 'frontend/src-tauri/binaries/onnxruntime/onnxruntime_providers_shared.dll']) assertWindowsMachine(path, '$Target');
for (const name of readdirSync('frontend/src-tauri/binaries/msvc-runtime')) assertWindowsMachine('frontend/src-tauri/binaries/msvc-runtime/' + name, '$Target');
console.log('App, sidecars and ONNX DLLs all match $Target.');
"@
$inspectFile = Join-Path $root 'target\windows-dev\inspect-payload.mjs'
# Resolve imports relative to this generated module's target/windows-dev path.
$inspect = $inspect.Replace("'./frontend/scripts/windows/pe.mjs'", "'../../frontend/scripts/windows/pe.mjs'")
[IO.File]::WriteAllText($inspectFile, $inspect, (New-Object Text.UTF8Encoding($false)))
Invoke-Checked 'node' @($inspectFile)
$installers = @(Get-ChildItem (Join-Path $releaseDir 'bundle\nsis') -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows Dev NSIS installer' }
Copy-Item $installers[0].FullName $recordDir
$payloads = @((Join-Path $releaseDir 'tetro-dev.exe'),$ffmpeg,(Join-Path $releaseDir 'llama-helper.exe'),(Join-Path $root 'frontend\src-tauri\binaries\onnxruntime\onnxruntime.dll'),(Join-Path $root 'frontend\src-tauri\binaries\onnxruntime\onnxruntime_providers_shared.dll'))
$record = [ordered]@{
  SourceCommit=$source; Target=$Target; Identity='am.vanalabs.tetro.dev'; Product='Tetro Dev'
  WindowsMinimumBuild=22000; Updater='disabled'; Authenticode='unsigned internal Dev build'
  FfmpegSourceSHA256='6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818'
  FfmpegEmbeddedPin=[ordered]@{Target=$env:TETRO_WINDOWS_FFMPEG_TARGET;SHA256=$env:TETRO_WINDOWS_FFMPEG_SHA256;Size=$env:TETRO_WINDOWS_FFMPEG_SIZE}
  MicrosoftRuntime=$runtimeRecords
  BuildHost=[Environment]::OSVersion.VersionString; Rust=((& rustc --version) -join ''); Node=((& node --version) -join '')
  GitHubRun=$env:GITHUB_RUN_ID; GitHubAttempt=$env:GITHUB_RUN_ATTEMPT
  Payloads=@($payloads | ForEach-Object {[ordered]@{Name=[IO.Path]::GetFileName($_);Size=(Get-Item $_).Length;SHA256=(Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant()}})
  Installer=[ordered]@{Name=$installers[0].Name;Size=$installers[0].Length;SHA256=(Get-FileHash $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
  PackagedUtc=(Get-Date).ToUniversalTime().ToString('o'); PhysicalDeviceTests='not run in CI'
}
[IO.File]::WriteAllText((Join-Path $recordDir 'build-record.json'), ($record | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Copy-Item (Join-Path $ffmpegWork 'config.h'),(Join-Path $ffmpegWork 'config.mak'),(Join-Path $ffmpegWork 'COPYING.LGPLv2.1') $recordDir
if (!$SkipTests) {
  Invoke-Checked 'cargo' @('test','--workspace','--locked','--release','--target',$Target,'--features','dev-profile','--','--skip','wake_fails_gracefully_for_unknown_device','--skip','test_list_system_audio_devices')
}
Write-Host "Windows Dev artifacts and provenance: $recordDir"
