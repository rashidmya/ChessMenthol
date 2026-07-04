#!/usr/bin/env bash
# Cross-compile Stockfish for Android arm64-v8a and install it as libstockfish.so into
# the app's jniLibs — the one directory Android lets us execute a bundled binary from
# (see EnginePlugin.kt / mobile_engine.rs). This is the mobile analogue of the desktop
# scripts/fetch-sidecar.mjs: the ~114MB binary is gitignored and rebuilt from here.
#
#   NDK_HOME=/path/to/ndk app/src-tauri/scripts/build-stockfish-android.sh
#
# Requires: the Android NDK (NDK_HOME or ANDROID_NDK_HOME), network access (the default
# NNUE nets are downloaded and embedded at build time), make, git.
#
# Pinned to sf_18 to match the desktop sidecar's net for analysis parity.
set -euo pipefail

SF_TAG="${SF_TAG:-sf_18}"
API="${ANDROID_API:-24}"
HOST_TAG="${NDK_HOST_TAG:-linux-x86_64}"

NDK="${NDK_HOME:-${ANDROID_NDK_HOME:-}}"
: "${NDK:?set NDK_HOME (or ANDROID_NDK_HOME) to your Android NDK path}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"                 # app/src-tauri
OUT="$ROOT/gen/android/app/src/main/jniLibs/arm64-v8a"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
export CXX="$TOOLCHAIN/aarch64-linux-android${API}-clang++"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[sf-android] cloning Stockfish $SF_TAG…"
git clone --depth 1 --branch "$SF_TAG" https://github.com/official-stockfish/Stockfish.git "$WORK/sf"

# Android's Bionic folds pthread + rt into libc, so `-lpthread`/`-lrt` (added by the
# Stockfish Makefile for Linux) have no library to find. Provide empty stub archives so
# those flags resolve harmlessly; the real symbols come from libc.
mkdir -p "$WORK/stublibs"
"$TOOLCHAIN/llvm-ar" crs "$WORK/stublibs/libpthread.a"
"$TOOLCHAIN/llvm-ar" crs "$WORK/stublibs/librt.a"

cd "$WORK/sf/src"
echo "[sf-android] building (ARCH=armv8, embedded net, static libc++)…"
# Plain `build`, NOT profile-build — PGO would try to RUN the arm64 binary on the host.
make -j"$(nproc)" build ARCH=armv8 COMP=clang CXX="$CXX" \
  EXTRALDFLAGS="-static-libstdc++ -L$WORK/stublibs"

"$TOOLCHAIN/llvm-strip" stockfish
mkdir -p "$OUT"
cp stockfish "$OUT/libstockfish.so"

echo "[sf-android] installed:"
file "$OUT/libstockfish.so"
ls -la "$OUT/libstockfish.so" | awk '{print "  " $5 " bytes"}'
