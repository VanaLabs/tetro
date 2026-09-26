# Contributing to Tetro

Thanks for helping improve Tetro. The project started from
[Meetily Community Edition](https://github.com/Zackriya-Solutions/meeting-minutes),
and its original copyright notice remains in `LICENSE.md`.

## Before you send a change

- Check the existing issues and describe the problem or proposed behavior.
- Keep a patch focused. Explain how to reproduce a bug and what changed.
- Use fictional or consented meeting content in screenshots, fixtures and logs.
  Never include recordings, transcripts, API keys, or local profile data from a
  real user.
- Run the relevant checks from `frontend/`: `pnpm typecheck`, `pnpm test`, and
  `pnpm build`. For native changes, run
  `cargo test --lib --manifest-path frontend/src-tauri/Cargo.toml` from the
  repository root. Describe any checks you could not run.
- Update the help text or README when a user-facing behavior changes.

The isolated macOS development app and its setup are described in
[`docs/TETRO-DEVELOPMENT.md`](docs/TETRO-DEVELOPMENT.md). It uses a separate
profile from an installed Meetily app.

## Source and identity

By submitting a contribution, you agree to license your contribution to the
project code under the [MIT License](LICENSE.md). Retain notices for any
third-party material you include and identify its source and license in the
change description.

The Tetro name, wordmark, logos, app icons, and other identity artwork are
reserved to Sedrak Hovhannisyan. A code contribution does not convey rights
to that identity. Read [`BRAND.md`](BRAND.md) before distributing a modified
build.

If a contribution needs new artwork, include its provenance and the rights
needed for the project to use and redistribute it. Do not add another
person's brand assets or generated media without checking those rights.
