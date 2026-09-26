# Tetro patch to whisper-rs-sys 0.11.1

Copied from the existing crates.io package without changing its engine or Rust API. Original licenses are retained.

The sole engine build change is in `whisper.cpp/ggml/src/CMakeLists.txt`: use CMake file reads and literal replacement to embed `ggml-common.h` instead of a shell sed command. With a space in the build directory, the generated sed program reads a backslash-containing path and silently drops this header. The app then logs unknown Metal block types and falls back to CPU transcription.

Configuration tracks both input files. Replacing the crate with a version containing an equivalent fix lets us remove this patch. Do not edit the global Cargo registry cache.
