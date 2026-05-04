#!/usr/bin/env bash
# Build all 5 prebuilt bridge binaries from a single Linux x86_64 host.
#
# Run from the repo root:
#   bash scripts/build-binaries.sh
#
# Prerequisites (one-time):
#   - Go 1.22+ on the host (only needed for the linux-x64 native build)
#   - Docker with buildx and QEMU binfmt handlers registered for arm64:
#       docker run --rm --privileged tonistiigi/binfmt --install arm64
#   - The crazymax/osxcross image (auto-pulled). It bundles a maintained
#     osxcross toolchain + an Apple SDK extracted from an official Xcode
#     CLT package.
#
# The darwin builds use a custom image built from
# scripts/Dockerfile.darwin-builder. First run builds the image (~3 min);
# subsequent runs reuse it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$REPO_ROOT/bridge"
PKG_DIR="$REPO_ROOT/platform-packages"
DARWIN_IMAGE="hrequests-darwin-builder"

# ----- darwin builder image -----
echo "==> Ensuring $DARWIN_IMAGE Docker image exists"
if ! docker image inspect "$DARWIN_IMAGE" >/dev/null 2>&1; then
  docker build -t "$DARWIN_IMAGE" -f "$REPO_ROOT/scripts/Dockerfile.darwin-builder" "$REPO_ROOT/scripts"
fi

# ----- linux-x64 (native) -----
echo "==> linux-x64 (native)"
( cd "$BRIDGE_DIR" && \
  CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
  go build -buildmode=c-shared \
  -o "$PKG_DIR/hrequests-linux-x64/bridge.so" server.go )

# ----- linux-arm64 (Docker arm64 under QEMU) -----
echo "==> linux-arm64 (Docker arm64)"
docker run --rm --platform linux/arm64 \
  -v "$BRIDGE_DIR":/src \
  -v "$PKG_DIR":/out \
  -w /src golang:1.22 \
  bash -c "apt-get update -qq && apt-get install -y -qq gcc >/dev/null 2>&1 && \
    CGO_ENABLED=1 go build -buildmode=c-shared \
    -o /out/hrequests-linux-arm64/bridge.so server.go"

# ----- win32-x64 (Docker amd64 + mingw) -----
echo "==> win32-x64 (mingw-w64 in Docker)"
docker run --rm \
  -v "$BRIDGE_DIR":/src \
  -v "$PKG_DIR":/out \
  -w /src golang:1.22 \
  bash -c "apt-get update -qq && apt-get install -y -qq gcc-mingw-w64-x86-64 >/dev/null 2>&1 && \
    CGO_ENABLED=1 GOOS=windows GOARCH=amd64 CC=x86_64-w64-mingw32-gcc \
    go build -buildmode=c-shared \
    -o /out/hrequests-win32-x64/bridge.dll server.go"

# ----- darwin-arm64 (osxcross in Docker) -----
echo "==> darwin-arm64 (osxcross)"
docker run --rm \
  -v "$BRIDGE_DIR":/src \
  -v "$PKG_DIR":/out \
  -w /src "$DARWIN_IMAGE" \
  bash -c "MACOSX_DEPLOYMENT_TARGET=11.0 \
    CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 \
    CC=aarch64-apple-darwin25.1-clang CXX=aarch64-apple-darwin25.1-clang++ \
    go build -buildmode=c-shared \
    -o /out/hrequests-darwin-arm64/bridge.dylib server.go"

# ----- darwin-x64 (osxcross in Docker) -----
echo "==> darwin-x64 (osxcross)"
docker run --rm \
  -v "$BRIDGE_DIR":/src \
  -v "$PKG_DIR":/out \
  -w /src "$DARWIN_IMAGE" \
  bash -c "MACOSX_DEPLOYMENT_TARGET=10.13 \
    CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
    CC=o64-clang CXX=o64-clang++ \
    go build -buildmode=c-shared \
    -o /out/hrequests-darwin-x64/bridge.dylib server.go"

# ----- cleanup: Go emits .h headers next to each shared library; we don't ship them.
find "$PKG_DIR" -name '*.h' -delete

# ----- cleanup: Docker writes files as root; chown them back to the invoking user.
if [[ "$(id -u)" -ne 0 ]]; then
  docker run --rm -v "$PKG_DIR":/pp alpine \
    chown -R "$(id -u):$(id -g)" /pp >/dev/null
fi

echo
echo "==> Built binaries:"
find "$PKG_DIR" -maxdepth 2 -type f -name 'bridge.*' -exec ls -lh {} +
