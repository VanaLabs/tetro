#!/usr/bin/env bash
# Called from Windows Dev tooling, with an initialized MSVC environment.
set -euo pipefail
export PATH="$PATH:/usr/bin:/bin"
target=${1:?Windows Rust target required}
root=$(cd "$(dirname "$0")/../../.." && pwd)
case "$target" in
  x86_64-pc-windows-msvc) arch=x86_64 ;;
  aarch64-pc-windows-msvc) arch=aarch64 ;;
  *) echo "Unsupported Windows target: $target" >&2; exit 1 ;;
esac
version=8.0.3
digest=6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818
work="$root/target/windows-dev/dependencies/ffmpeg/$version/$target"
mkdir -p "$work"
archive="$work/ffmpeg-$version.tar.xz"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
    "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz" -o "$archive"
fi
printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -
source_root=$(mktemp -d "$work/verified.XXXXXX")
trap 'rm -rf "$source_root"' EXIT
tar -xJf "$archive" -C "$source_root"
build=$(mktemp -d "$work/build.XXXXXX")
cl_path=$(command -v cl.exe)
# Avoid MSYS's unrelated link.exe shadowing the Microsoft linker.
export PATH="$(dirname "$cl_path"):$PATH:/usr/bin:/bin"
cd "$build"
"$source_root/ffmpeg-$version/configure" --toolchain=msvc --arch="$arch" --target-os=win32 \
  --disable-autodetect --disable-network --disable-doc --disable-debug --disable-shared --enable-static \
  --disable-programs --enable-ffmpeg --disable-everything --disable-asm \
  --enable-protocol=file,pipe --enable-demuxer=mov,matroska,asf,wav,mp3,flac,ogg,aac,concat,pcm_f32le \
  --enable-muxer=mp4,wav --enable-parser=aac,mpegaudio,flac,opus,vorbis \
  --enable-decoder=aac,aac_fixed,mp3,mp3float,flac,vorbis,opus,wmav1,wmav2,wmapro,wmalossless,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,alac \
  --enable-encoder=aac,pcm_s16le --enable-filter=aresample,anull,aformat,asetpts,amix,volume
make -r -j4
cp ffmpeg.exe "$work/ffmpeg-$target.exe"
cp config.h "$work/config.h"
cp ffbuild/config.mak "$work/config.mak"
cp ffbuild/config.log "$work/config.log"
cp "$source_root/ffmpeg-$version/COPYING.LGPLv2.1" "$work/COPYING.LGPLv2.1"
mkdir -p "$root/frontend/src-tauri/binaries"
cp "$work/ffmpeg-$target.exe" "$root/frontend/src-tauri/binaries/ffmpeg-$target.exe"
echo "Built Tetro FFmpeg from pinned upstream source: $target"
