# Releasing Tetro

The source checkout is `VanaLabs/tetro`. Dev mode and the consumer app use the
same source and app identifier, `am.vanalabs.tetro`. Ship a release build,
not the debug executable or the dev launcher.

Tetro checks the latest public GitHub release at startup and every six hours
while open. Users can also choose **Settings → About → Check for updates**.
They choose when to download, then choose **Install and restart**. Recording
must finish before installation. Saved data and model downloads live outside
the application bundle and are retained.

## Signing key

The first updater key was generated outside this repository at
`~/.config/tetro/release/updater.key`. The matching public key is in
`frontend/src-tauri/tauri.conf.json`. Back up the private key securely before
the first public release. Never commit or upload it as a release asset.
Future releases must use this same key so existing installations trust them.
For another build machine, supply `TAURI_SIGNING_PRIVATE_KEY` and, when
applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` through secret storage.

Updater signatures are separate from Apple's Developer ID signing and
notarization. Tetro's first release uses ad-hoc Apple code signing and signed
updater packages, without a paid Apple Developer membership. It is not notarized.
Downloaded copies may require **System Settings → Privacy & Security → Open
Anyway** on first launch. Follow [Apple's opening instructions](https://support.apple.com/en-us/102445);
do not ask users to disable Gatekeeper globally. Test permission and Keychain
access again after updating; ad-hoc signing does not guarantee they persist.

## Version numbers

Tetro starts at `9.1.0` (First Edition): launch month, major release, minor
revision. The update test is `9.1.1`; a later major release can be `9.2.0`.
Keep `9` as the launch-month series rather than resetting the first number each
January: the updater compares all three numbers from left to right and requires
a higher version. Keep each published version immutable and associate it with
its Git tag, commit, and release notes so problems can be traced to the exact build.

## Prepare a macOS release

1. Set the same new version in `frontend/package.json`,
   `frontend/src-tauri/Cargo.toml`, and `frontend/src-tauri/tauri.conf.json`.
   Every update must have a higher version than the installed app.
2. Run frontend checks and build the release on the intended architecture:

   ```sh
   cd frontend
   pnpm typecheck
   pnpm test
   node scripts/prepare-release.mjs --allow-adhoc
   ```

   Optional: set `TETRO_RELEASE_NOTES_FILE` to an absolute Markdown file path.
   `--allow-adhoc` selects the current free distribution method. If Developer ID
   signing is configured later, set `APPLE_SIGNING_IDENTITY` and omit that flag.
   Ordinary local builds do not generate updater archives; the release config
   explicitly enables them.
3. Inspect `target/releases/vVERSION/TARGET/`. It contains the DMG, signed
   `.app.tar.gz`, signature, and `latest.json`. Verify the actual downloaded
   app's signing, notarization, permissions, recording, and notes behavior.
   The helper builds only the host architecture. Do not advertise Intel
   support from an Apple Silicon build. If shipping both, build both natively
   and merge their `platforms` entries into one `latest.json`.
4. Once publication is authorized, make the repository public and create a
   **draft** GitHub release with tag `vVERSION`. Upload the DMG, archive,
   signature, and `latest.json` together. Inspect all manifest URLs and ensure
   each points to an uploaded artifact for that exact tag.
5. Publish the draft as the latest stable release only after checking all
   assets. A prerelease does not advance the `/releases/latest/` channel.
   Repository pushes alone do not deliver app updates.

To validate the update channel, perform an actual upgrade from one packaged version to a higher
signed version on a separate macOS test account or machine. Confirm signature
rejection for an altered package, restart, and preservation of recordings,
settings, API-key access, and downloaded models. Until a public manifest and
packages exist, manual update checks report a connection/channel error;
startup checks stay quiet. Do not interpret that as “up to date.”

References: [Tauri updater](https://v2.tauri.app/plugin/updater/) and
[macOS signing](https://v2.tauri.app/distribute/sign/macos/).
