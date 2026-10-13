# Windows Dev builds

Use the existing source repository for both `x86_64-pc-windows-msvc` and
`aarch64-pc-windows-msvc`. The Windows Dev workflow runs each target on its
matching Windows runner and retains internal installers and build records.
It does not publish releases or update the consumer manifest.

The build host needs Rust, Node/pnpm from the workflow, MSVC for the target,
LLVM matching the Rust build host with `clang-cl` and `libclang`, Ninja, and MSYS2 GNU make.
Initialize the matching MSVC environment, then run:

```powershell
./frontend/scripts/windows/build-dev.ps1 -Target x86_64-pc-windows-msvc
./frontend/scripts/windows/build-dev.ps1 -Target aarch64-pc-windows-msvc
```

The script builds FFmpeg from the authenticated, SHA256-pinned 8.0.3 source
using the restricted Tetro audio recipe. The resulting target, size, and hash
are embedded in this Dev app and verified before bundling and execution.
ARM64 also uses Clang for the summary engine, with the Windows MSVC ABI and SDK.
CI uses native Rust/compiler tools on each runner. Whisper uses bindgen
0.72.1 to resolve forward-declared records with
LLVM 22. ARM64 binaries and ABI layout checks execute natively.
The header-only ABI check uses a separate Cargo directory; model CPU decoding
runs after packaging and the native app regression suite.
The summary helper also decodes a synthetic prompt with fingerprint-verified
Qwen 3.5 2B before packaging. These model checks do not use audio devices.
Existing consumer/macOS pins are retained. An internal build does not enable
consumer Windows distribution or a public dependency download.

ONNX Runtime 1.22.0 archives and DLLs have separate x64/ARM64 fingerprints.
All app, FFmpeg, llama-helper, and ONNX payload machine types must agree with
the requested target. FFmpeg encode/decode is tested on the Windows runner.
Physical microphone, loopback, and product workflows need device tests.

Dev keeps `am.vanalabs.tetro.dev`, separate profile/credentials, visible Dev
marking, and no consumer updater. The per-user NSIS installer requires Windows
11 build22000 or later. Internal Dev installers are unsigned; no Windows
certificate or paid signing service is configured by this workflow.
Microsoft runtime signatures and target machine types are checked before
staging. The ARM SDK's x64 emulation DLL is excluded from native ARM64 bundles;
app/helper imports must not depend on it.

Outputs: `target/windows-dev/<source-commit>/<target>/`. Keep matching installer,
dependency/configuration hashes, source commit, and device results together.
Installers can be tested on a laptop without a source checkout or compiler.
