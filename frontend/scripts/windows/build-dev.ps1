param(
  [ValidateSet('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc')]
  [string]$Target = 'x86_64-pc-windows-msvc',
  [ValidateSet('all','bindings','ffmpeg','helper','app','tests')]
  [string]$Stage = 'all',
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This script requires a Windows build host' }
if ($Stage -ne 'all' -and $env:GITHUB_ACTIONS -ne 'true') { throw 'Separate build stages are reserved for the sequential CI workflow' }
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
$tinySpec = ([IO.File]::ReadAllText((Join-Path $root 'frontend\src-tauri\model-fingerprints.json')) | ConvertFrom-Json).'stt-whisper/ggml-tiny.bin'
$tiny = Join-Path $root 'frontend\src-tauri\resources\models\ggml-tiny.bin'
if ($Stage -in @('all','ffmpeg')) {
  if ($tinySpec.source -notmatch '^https://huggingface\.co/Vana-Labs/stt-whisper/resolve/[0-9a-f]{40}/ggml-tiny\.bin$') { throw 'Bundled Tiny must use the pinned Vana Labs source' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($tiny)) -Force | Out-Null
  if ((Test-Path $tiny) -and ((Get-Item $tiny).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Bundled Tiny cannot be a reparse point' }
  if (!(Test-Path $tiny) -or (Get-Item $tiny).Length -ne $tinySpec.size -or (Get-FileHash $tiny -Algorithm SHA256).Hash -ne $tinySpec.sha256) {
    $partial = "$tiny.part"
    Invoke-WebRequest -Uri $tinySpec.source -OutFile $partial
    if ((Get-Item $partial).Length -ne $tinySpec.size -or (Get-FileHash $partial -Algorithm SHA256).Hash -ne $tinySpec.sha256) { throw 'Bundled Tiny failed catalog fingerprint verification' }
    Move-Item $partial $tiny -Force
  }
}
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
# LLVM accepts upstream's empty C initializers, which newer ARM MSVC rejects.
# Prefer the native-host LLVM installation so bindgen can load its libclang too.
$llvmCandidates = @((Join-Path $env:VCINSTALLDIR 'Tools\Llvm\ARM64\bin'),(Join-Path $env:VCINSTALLDIR 'Tools\Llvm\x64\bin'),'C:\Program Files\LLVM\bin')
$rustHost = ((& rustc -vV) | Where-Object {$_ -like 'host:*'}) -replace '^host:\s*',''
$hostMachine = if ($rustHost -like 'aarch64-*') { 0xaa64 } else { 0x8664 }
$llvm = $null
foreach ($directory in $llvmCandidates) {
  $dll = Join-Path $directory 'libclang.dll'
  if ((Test-Path $dll) -and (Test-Path (Join-Path $directory 'clang-cl.exe'))) {
    $bytes=[IO.File]::ReadAllBytes($dll);$pe=[BitConverter]::ToInt32($bytes,60)
    if ([BitConverter]::ToUInt16($bytes,$pe+4) -eq $hostMachine) {$llvm=$directory;break}
  }
}
if (!$llvm) { throw "A native libclang/clang-cl installation is required for Rust host $rustHost" }
$env:LIBCLANG_PATH = $llvm
$env:Path = "$llvm;$env:Path"
Write-Host "Rust build host: $rustHost; native payload target: $Target"
Invoke-Checked (Join-Path $llvm 'clang-cl.exe') @('--version')
$env:TETRO_FFMPEG_CC = "clang-cl --target=$Target"
if ($Target -eq 'aarch64-pc-windows-msvc') {
  # llama.cpp's ARM backend requires Clang; retain the Windows MSVC ABI and SDK.
  $env:CC_aarch64_pc_windows_msvc = Join-Path $llvm 'clang-cl.exe'
  $env:CXX_aarch64_pc_windows_msvc = Join-Path $llvm 'clang-cl.exe'
  $env:CFLAGS_aarch64_pc_windows_msvc = '--target=aarch64-pc-windows-msvc'
  $env:CXXFLAGS_aarch64_pc_windows_msvc = '/EHsc --target=aarch64-pc-windows-msvc'
}
if ($Stage -eq 'bindings') {
  # Keep the header-only build separate so it cannot supply incomplete native
  # libraries to the app's Cargo cache. Test executables use the actual target.
  $appCargoDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = Join-Path $root 'target\windows-dev\binding-checks'
  $env:DOCS_RS = '1'
  try {
    Invoke-Checked 'cargo' @('test','-p','whisper-rs-sys','--locked','--release','--target',$Target,'--','--test-threads=1','--nocapture')
    $bindings = @(Get-ChildItem (Join-Path $env:CARGO_TARGET_DIR "$Target\release\build\whisper-rs-sys-*\out\bindings.rs"))
    if ($bindings.Count -ne 1) { throw 'Expected one native binding output' }
    Copy-Item $bindings[0].FullName (Join-Path $recordDir 'whisper-bindings.rs')
    $check = [ordered]@{SourceCommit=$source;Target=$Target;RustBuildHost=$rustHost;NativeLayoutTests='passed';LibclangSHA256=(Get-FileHash (Join-Path $llvm 'libclang.dll') -Algorithm SHA256).Hash.ToLowerInvariant()}
    [IO.File]::WriteAllText((Join-Path $recordDir 'whisper-abi-check.json'),($check | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  } finally {
    Remove-Item Env:DOCS_RS
    $env:CARGO_TARGET_DIR = $appCargoDir
  }
  return
}
if ($Stage -in @('all','ffmpeg')) {
  Write-Host '::notice title=Windows Dev stage::Building pinned FFmpeg with the matching LLVM/MSVC toolchain'
  Invoke-Checked $bash @('--noprofile','--norc','frontend/scripts/ffmpeg/build-windows.sh',$Target)
}
$ffmpeg = Join-Path $root "frontend\src-tauri\binaries\ffmpeg-$Target.exe"
$env:TETRO_WINDOWS_FFMPEG_TARGET = $Target
$env:TETRO_WINDOWS_FFMPEG_SHA256 = (Get-FileHash $ffmpeg -Algorithm SHA256).Hash.ToLowerInvariant()
$env:TETRO_WINDOWS_FFMPEG_SIZE = (Get-Item $ffmpeg).Length.ToString([Globalization.CultureInfo]::InvariantCulture)
$ffmpegWork = Join-Path $root "target\windows-dev\dependencies\ffmpeg\8.0.3\$Target"
Copy-Item (Join-Path $ffmpegWork 'COPYING.LGPLv2.1') (Join-Path $root 'frontend\src-tauri\binaries\ffmpeg-LICENSE.txt')
if ($Stage -in @('all','ffmpeg')) {
  Invoke-Checked 'node' @('frontend/scripts/windows/smoke-ffmpeg.mjs',$ffmpeg,$Target,(Join-Path $recordDir 'ffmpeg-smoke'))
}
$releaseDir = Join-Path $env:CARGO_TARGET_DIR "$Target\release"
if ($Stage -in @('all','helper')) {
  Write-Host '::notice title=Windows Dev stage::Building the summary sidecar'
  $nativeBuildRoot = Join-Path $releaseDir 'build'
  foreach ($entry in Get-ChildItem $nativeBuildRoot -Directory -Filter 'llama-cpp-sys-2-*' -ErrorAction SilentlyContinue) {
    $cmakeBuild = Join-Path $entry.FullName 'out\build'
    if ((Test-Path (Join-Path $cmakeBuild 'CMakeCache.txt')) -and !(Test-Path (Join-Path $cmakeBuild 'build.ninja'))) {
      # A failed configure leaves a cache that this dependency would otherwise reuse.
      Remove-Item $cmakeBuild -Recurse -Force
    }
  }
  Invoke-Checked 'cargo' @('build','--locked','--release','--target',$Target,'-p','llama-helper')
  Copy-Item (Join-Path $releaseDir 'llama-helper.exe') (Join-Path $root "frontend\src-tauri\binaries\llama-helper-$Target.exe")
  $imports = & dumpbin.exe /DEPENDENTS (Join-Path $releaseDir 'llama-helper.exe')
  if ($LASTEXITCODE) { throw 'Could not inspect summary sidecar runtime dependencies' }
  [IO.File]::WriteAllText((Join-Path $recordDir 'summary-runtime-imports.txt'), ($imports -join "`n"), (New-Object Text.UTF8Encoding($false)))
}
if ($Stage -in @('all','app')) {
  Write-Host '::notice title=Windows Dev stage::Summary sidecar built; compiling and packaging Tetro Dev'
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
  $mainRecordFile = Join-Path $recordDir 'main-executable.json'
  Invoke-Checked 'node' @('frontend/scripts/windows/nsis-main-record.mjs',(Join-Path $releaseDir 'tetro-dev.exe'),$Target,$mainRecordFile)
  $mainRecord = [IO.File]::ReadAllText($mainRecordFile) | ConvertFrom-Json
  $payloads = @($ffmpeg,(Join-Path $releaseDir 'llama-helper.exe'),(Join-Path $root 'frontend\src-tauri\binaries\onnxruntime\onnxruntime.dll'),(Join-Path $root 'frontend\src-tauri\binaries\onnxruntime\onnxruntime_providers_shared.dll'))
  $record = [ordered]@{
    SourceCommit=$source; Target=$Target; Identity='am.vanalabs.tetro.dev'; Product='Tetro Dev'
    WindowsMinimumBuild=22000; Updater='disabled'; Authenticode='unsigned internal Dev build'
    FfmpegSourceSHA256='6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818'
    FfmpegEmbeddedPin=[ordered]@{Target=$env:TETRO_WINDOWS_FFMPEG_TARGET;SHA256=$env:TETRO_WINDOWS_FFMPEG_SHA256;Size=$env:TETRO_WINDOWS_FFMPEG_SIZE}
    MicrosoftRuntime=$runtimeRecords
    CompilerExecutableSHA256=$mainRecord.CompilerSHA256
    BundledModels=@([ordered]@{Name='ggml-tiny.bin';ResourcePath='resources/models/ggml-tiny.bin';Size=$tinySpec.size;SHA256=$tinySpec.sha256})
    BuildHost=[Environment]::OSVersion.VersionString; Rust=((& rustc --version) -join ''); Node=((& node --version) -join '')
    GitHubRun=$env:GITHUB_RUN_ID; GitHubAttempt=$env:GITHUB_RUN_ATTEMPT
    Payloads=@([ordered]@{Name=$mainRecord.Name;Size=$mainRecord.Size;SHA256=$mainRecord.SHA256}) + @($payloads | ForEach-Object {[ordered]@{Name=[IO.Path]::GetFileName($_);Size=(Get-Item $_).Length;SHA256=(Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant()}})
    Installer=[ordered]@{Name=$installers[0].Name;Size=$installers[0].Length;SHA256=(Get-FileHash $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    PackagedUtc=(Get-Date).ToUniversalTime().ToString('o'); PhysicalDeviceTests='not run in CI'
  }
  [IO.File]::WriteAllText((Join-Path $recordDir 'build-record.json'), ($record | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Copy-Item (Join-Path $ffmpegWork 'config.h'),(Join-Path $ffmpegWork 'config.mak'),(Join-Path $ffmpegWork 'COPYING.LGPLv2.1') $recordDir
}
if (!$SkipTests -and $Stage -in @('all','tests')) {
  Write-Host '::notice title=Windows Dev stage::Installer and payload machine types verified; running native Rust regression tests'
  # Standalone test executables need the same verified native files as the app.
  $testDir = Join-Path $releaseDir 'deps'
  New-Item -ItemType Directory -Path $testDir -Force | Out-Null
  Copy-Item $ffmpeg (Join-Path $testDir 'ffmpeg.exe')
  Copy-Item (Join-Path $runtimeDir '*.dll') $testDir
  Copy-Item (Join-Path $root 'frontend\src-tauri\binaries\onnxruntime\*.dll') $testDir
  $env:ORT_DYLIB_PATH = Join-Path $testDir 'onnxruntime.dll'
  Invoke-Checked 'cargo' @('test','--workspace','--locked','--release','--target',$Target,'--features','dev-profile','--','--test-threads=1','--nocapture','--skip','wake_fails_gracefully_for_unknown_device','--skip','test_list_system_audio_devices')
}
Write-Host "Windows Dev artifacts and provenance: $recordDir"
