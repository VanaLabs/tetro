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

[**Download Tetro 9.1.2 for Apple Silicon Macs**](https://github.com/VanaLabs/tetro/releases/download/v9.1.2/Tetro_9.1.2_aarch64.dmg)

## Install on your Mac

1. Download **Tetro_9.1.2_aarch64.dmg** from the assets below. Choose the DMG, not “Source code” or the updater archive.
2. Open the downloaded DMG, then **drag Tetro onto Applications** in that window. Wait for the copy to finish.
3. Open **Finder → Applications → Tetro**. You can eject the Tetro disk image afterward.
4. If macOS says Apple cannot check Tetro or the developer cannot be verified, dismiss that message with **Done** (or **OK**, depending on macOS). Keep the app in Applications.
5. Open **Apple menu  → System Settings → Privacy & Security**. Scroll down to **Security**. Find the message about Tetro being blocked and click **Open Anyway**.
6. Confirm with your Mac password or Touch ID if asked, then click **Open** in the confirmation. Tetro’s setup should appear.

**Don’t see Open Anyway?** First try opening Tetro from Applications once, then return to Privacy & Security. The button appears after macOS blocks a launch. A managed work Mac may require help from its administrator.

![Apple’s example of Privacy & Security, with Open Anyway highlighted](https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png)

*Screenshot: Apple Support. “Example App” will be “Tetro” on your Mac; the layout may differ by macOS version.* [Apple’s full instructions](https://support.apple.com/en-us/102445).

Tetro is ad-hoc signed and not Apple-notarized. These steps apply to the unidentified-developer warning for your download from **VanaLabs/tetro**. If macOS instead reports malware or a damaged app, stop and report the exact message.

This installer is for **Apple Silicon Macs**. Computer-audio capture requires macOS 14.4 or later.

Onboarding helps you set up permissions and download Parakeet for transcription
and Qwen 3.5 2B for summaries. Intel Mac, Windows, and Linux installers are not
included in this release.

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
