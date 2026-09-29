# Tetro

Tetro is developed by Vana Labs.

Tetro is a desktop app for recording meetings, transcribing audio, and turning
conversations into editable summaries and action items. It can use local models for
transcription and summaries. If you choose an external AI provider, the content
needed for that request is sent to that provider.

## Source and brand

Project-authored code and written documentation are available under the
[MIT License](LICENSE.md). Third-party components keep their own licenses;
see the notices bundled in the app. The **Tetro** name, wordmark, logos, app
icons, and other identity artwork belong to **Vana Labs** and are
reserved separately. See [BRAND.md](BRAND.md) before distributing a fork.

## Download

[Download Tetro 9.1.0 — First Edition for Apple Silicon Macs](https://github.com/VanaLabs/tetro/releases/download/v9.1.0/Tetro_9.1.0_aarch64.dmg).
Open the DMG and drag Tetro into Applications.

This release uses ad-hoc code signing and is **not Apple-notarized**. If macOS
blocks the first launch, follow [Apple’s Open Anyway instructions](https://support.apple.com/en-us/102445)
in **System Settings → Privacy & Security**. No paid account is needed to use Tetro.

Onboarding helps you set up permissions and download Parakeet for transcription
and Qwen 3.5 2B for summaries. Intel Mac, Windows, and Linux installers are not
included in this release. See [release notes](https://github.com/VanaLabs/tetro/releases/tag/v9.1.0).

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

## Releases and updates

The app checks GitHub Releases and lets users choose when to download and
install updates. Release builds need signed updater artifacts and `latest.json`;
a source push alone does not update installed apps. See
[the release guide](docs/RELEASING.md) for packaging, signing, and publication.
Updater packages are signed separately from Apple code signing. An end-to-end
upgrade from the first release is still pending validation.

## Privacy

Recordings, transcripts, and summaries are stored locally. Downloading a model
contacts its distributor. External AI providers process the content you send
to them. Read [the privacy policy](PRIVACY_POLICY.md) and the app's provider
settings before using an external service.

## Contributing

Issues and patches are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions to the project code are under
MIT; contributions do not grant rights to the Tetro brand.
