#!/bin/sh
# Run from the repository root. Source must first pass the pinned SHA-256 check.
set -eu
version=8.0.3
source_sha=6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818
root=$(pwd)
archive="$root/target/ffmpeg-source/ffmpeg-$version.tar.xz"
printf '%s  %s\n' "$source_sha" "$archive" | shasum -a 256 -c -
# Always extract the verified archive afresh; never trust an old extracted source tree.
source_root=$(mktemp -d "$root/target/ffmpeg-source/verified.XXXXXX")
trap 'rm -rf "$source_root"' EXIT HUP INT TERM
tar -xJf "$archive" -C "$source_root"
source="$source_root/ffmpeg-$version"
for arch in arm64 x86_64; do
 build="$root/target/ffmpeg-build-$arch"
 mkdir -p "$build"
 cd "$build"
 "$source/configure" --cc=/usr/bin/clang --arch="$arch" --target-os=darwin --enable-cross-compile \
  --extra-cflags="-arch $arch -mmacosx-version-min=11.0" --extra-ldflags="-arch $arch -mmacosx-version-min=11.0" \
  --disable-autodetect --disable-network --disable-doc --disable-debug --disable-shared --enable-static \
  --disable-programs --enable-ffmpeg --disable-everything --disable-x86asm \
  --enable-protocol=file,pipe --enable-demuxer=mov,matroska,asf,wav,mp3,flac,ogg,aac,concat,pcm_f32le \
  --enable-muxer=mp4,wav --enable-parser=aac,mpegaudio,flac,opus,vorbis \
  --enable-decoder=aac,aac_fixed,mp3,mp3float,flac,vorbis,opus,wmav1,wmav2,wmapro,wmalossless,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,alac \
  --enable-encoder=aac,pcm_s16le --enable-filter=aresample,anull,aformat,asetpts,amix,volume
 make -j6
 /usr/bin/codesign --force --sign - ffmpeg
 cd "$root"
done
