# Tetro

Tetro is a desktop app for recording meetings, transcribing audio, and turning
conversations into editable notes and action items. It can use local models for
transcription and notes. If you choose an external AI provider, the content
needed for that request is sent to that provider.

## Source and brand

Project-authored code and written documentation are available under the
[MIT License](LICENSE.md). Third-party components keep their own licenses;
see the notices bundled in the app. The **Tetro** name, wordmark, logos, app
icons, and other identity artwork belong to **Vana Labs** and are
reserved separately. See [BRAND.md](BRAND.md) before distributing a fork.

This repository publishes the source code. It does not provide a signed and
notarized installer yet.

## Source layout

The frontend is in `frontend/src/`, and the native Tauri app is in
`frontend/src-tauri/`. This repository holds the consumer app source. Model
weights and platform-specific sidecar executables are not committed. A native
build needs those resources in the paths listed in
`frontend/src-tauri/tauri.conf.json`.

From `frontend/`, the main checks are:

```sh
pnpm typecheck
pnpm test
pnpm build
```

The Rust tests run from the repository root:

```sh
cargo test --lib --manifest-path frontend/src-tauri/Cargo.toml
```

The original copyright notice and third-party license notices remain in
[LICENSE.md](LICENSE.md) and the app's Licenses panel.

## Privacy

Recordings, transcripts, and notes are stored locally. Downloading a model
contacts its distributor. External AI providers process the content you send
to them. Read [the privacy policy](PRIVACY_POLICY.md) and the app's provider
settings before using an external service.

## Contributing

Issues and patches are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions to the project code are under
MIT; contributions do not grant rights to the Tetro brand.
