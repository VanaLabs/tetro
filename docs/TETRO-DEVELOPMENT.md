# Develop Tetro on macOS

Tetro is a Next.js frontend in a Tauri desktop window. Use the native window
to test recording, file import, models, and storage; those features do not run
in an ordinary browser tab.

## Requirements

- macOS with Xcode command-line tools
- Node.js, pnpm, and the Rust toolchain
- Internet access for dependencies and build-time FFmpeg/ONNX Runtime downloads

From the repository root, install the frontend dependencies:

```sh
cd frontend
pnpm install --frozen-lockfile
```

The repository does not contain model weights. Download Whisper Tiny before a
native build, because the Tauri resource manifest bundles this file:

```sh
mkdir -p frontend/src-tauri/resources/models
curl -fL --retry 3 \
  -o frontend/src-tauri/resources/models/ggml-tiny.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
```

This command is run from the repository root. The model file is ignored by Git.
The app copies the bundled model into its own profile when needed. Other models
can be downloaded inside the app.

## Run the isolated development app

Double-click `Start Tetro Dev.command` in the repository root, or run
`pnpm dev:desktop` from `frontend/`. The development app opens only after its
local frontend at `127.0.0.1:3119` is ready. Keep the launcher running while
using the app; stop it with Control-C.

Tetro Dev has bundle ID `am.vanalabs.tetro.dev` and stores its database,
recordings, models, and settings in
`~/Library/Application Support/am.vanalabs.tetro.dev/`. The release app uses
`am.vanalabs.tetro`; neither profile reads an installed Meetily profile.

Frontend edits refresh in the native window. Rust edits rebuild and relaunch
it, so stop a recording before changing native code. The Developer menu in
Tetro Dev provides an inspector and a way to open its development data folder.
The release configuration disables window devtools and the native context menu.

## Check changes

```sh
cd frontend
pnpm typecheck
pnpm test
pnpm build
```

For native code, from the repository root:

```sh
cargo test --lib --manifest-path frontend/src-tauri/Cargo.toml
```

`pnpm build` builds the frontend. A distributable desktop build also needs the
model file above and platform-specific signing and packaging setup. The source
repository does not claim to provide a signed or notarized installer.

## Privacy during development

Use fictional or consented meeting content for tests and screenshots. The
development profile is local to your computer and is never committed. Local
models process content on the device; selecting an external provider sends
the requested content to that provider. Model downloads contact the model
distributor. See the [privacy policy](../PRIVACY_POLICY.md).
