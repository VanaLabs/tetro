# Windows Dev builds

Use the existing source repository for both `x86_64-pc-windows-msvc` and
`aarch64-pc-windows-msvc`. The Windows Dev workflow runs each target on its
matching Windows runner and retains internal installers and build records.
It does not publish releases or update the consumer manifest.

The build host needs Rust, Node/pnpm from the workflow, MSVC for the target,
Ninja, and MSYS2 GNU make. Initialize the matching MSVC environment, then run:

```powershell
./frontend/scripts/windows/build-dev.ps1 -Target x86_64-pc-windows-msvc
./frontend/scripts/windows/build-dev.ps1 -Target aarch64-pc-windows-msvc
```

The script builds FFmpeg from the authenticated, SHA256-pinned 8.0.3 source
using the restricted Tetro audio recipe. The resulting target, size, and hash
are embedded in this Dev app and verified before bundling and execution.
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

Outputs: `target/windows-dev/<source-commit>/<target>/`. Keep matching installer,
dependency/configuration hashes, source commit, and device results together.
Installers can be tested on a laptop without a source checkout or compiler.
