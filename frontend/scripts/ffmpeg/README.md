# Tetro FFmpeg

Tetro's macOS FFmpeg is built by VanaLabs from unmodified FFmpeg 8.0.3 source.
Source: https://ffmpeg.org/releases/ffmpeg-8.0.3.tar.xz
SHA-256: 6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818
Upstream signing key: FCF986EA15E6E293A5644F10B4322F04D67658D8

The detached source signature was verified against that fingerprint, published at
https://ffmpeg.org/download.html. The release contains source, signature, license,
build script, target binaries and SHA256SUMS:
https://github.com/VanaLabs/tetro/releases/tag/ffmpeg-8.0.3-tetro.1

Run build-macos.sh from the repository root after placing the source archive in
target/ffmpeg-source. It verifies the source digest, extracts a fresh temporary
source tree, and builds from that tree. The recipe disables network protocols, external libraries, GPL components,
and unrelated media functionality. AAC encoding, audio decoding and concatenation
remain enabled. Built with Apple's clang; ad-hoc signed locally. Byte identity is
pinned per published artifact, not claimed reproducible across different compilers.
Apple Silicon encode/decode smoke tests passed. Intel is cross-compiled; runtime
verification on Intel is still required before shipping an Intel Tetro release.
Other targets deliberately fail until a verified VanaLabs component is published.

Both build downloads and runtime repair verify size and SHA-256 before executing.
Runtime repair writes only to the app's component directory. It never edits shell
profiles or searches PATH/current directory for a replacement. Normal app bundles
are covered by the release signature; bundling may change Mach-O signing bytes.

FFmpeg is LGPL-2.1-or-later in this configuration. Source and license accompany the
component release. No proprietary modifications have been made to FFmpeg.
