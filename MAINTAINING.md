# Maintaining hrequests-js

End users do not build the Go bridge. They get a prebuilt `.dylib` / `.so` /
`.dll` from one of five per-platform npm packages, pulled in automatically as
an optional dependency of `hrequests-js`. This document is for the maintainer
who publishes those binaries.

## The 6 packages

| npm package | what it ships |
|---|---|
| `hrequests-js` | TypeScript dist + `optionalDependencies` on the 5 below |
| `hrequests-darwin-arm64` | `bridge.dylib` for macOS Apple Silicon (min 11.0) |
| `hrequests-darwin-x64` | `bridge.dylib` for macOS Intel (min 10.13) |
| `hrequests-linux-x64` | `bridge.so` for Linux glibc x86_64 |
| `hrequests-linux-arm64` | `bridge.so` for Linux glibc arm64 |
| `hrequests-windows-x64` | `bridge.dll` for Windows x86_64 (named `windows` not `win32` because npm's spam filter blocks the latter) |

All six versions move in lockstep. Never publish a platform package at a
version that does not match the main package — `optionalDependencies` pins
exact versions, so a mismatch silently breaks installs.

## Build host

All 5 binaries are built from a single Linux x86_64 host (Ubuntu/Debian
recommended). Darwin binaries are produced via cgo cross-compilation using
the [crazymax/osxcross](https://hub.docker.com/r/crazymax/osxcross) Docker
image, which bundles a maintained osxcross toolchain along with an Apple
SDK extracted from official Xcode Command Line Tools.

## Prerequisites (one-time)

```bash
# Go 1.22+ on the host (needed only for the linux-x64 native build)
sudo apt install -y golang docker.io

# Register QEMU binfmt handlers so Docker can run linux/arm64 images
docker run --rm --privileged tonistiigi/binfmt --install arm64
```

Docker pulls the rest as needed. First run of the build script also builds
a small custom image, `hrequests-darwin-builder`, that combines
`debian:trixie` + Go + osxcross — see
[scripts/Dockerfile.darwin-builder](scripts/Dockerfile.darwin-builder).
Cached after the first build.

## Release flow

```bash
# 1. Bump the main package version. This is the single source of truth.
npm version patch                 # or minor / major

# 2. Build all 5 binaries into platform-packages/<name>/.
bash scripts/build-binaries.sh

# 3. Publish all 6 packages. The script bumps every platform package's
#    version to match the main package automatically before publishing,
#    and publishes platform packages first so the main package's
#    optionalDependencies resolve cleanly.
bash scripts/publish-all.sh
```

That's it. `npm version patch` will create a git tag — push it (`git push
--follow-tags`) once you're happy.

## Verification (recommended before each release)

```bash
# Pack the main package and the linux-x64 platform package,
# install both into a clean tmp dir, run the get-ip test.
( cd platform-packages/hrequests-linux-x64 && npm pack >/dev/null )
npm pack >/dev/null
TMPDIR=$(mktemp -d)
( cd "$TMPDIR" && \
  npm init -y >/dev/null && \
  node -e "const p=require('./package.json');p.type='module';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))" && \
  npm install $(pwd)/../*.tgz $(pwd)/../platform-packages/hrequests-linux-x64/*.tgz >/dev/null && \
  cp tests/get-ip.test.js . && node get-ip.test.js )
```

## Troubleshooting

**`exec format error` running an arm64 image** — QEMU binfmt handlers are
not registered. Re-run
`docker run --rm --privileged tonistiigi/binfmt --install arm64`.

**`libtapi.so.12git: cannot open shared object file`** — the osxcross
toolchain can't find its bundled `libtapi`. The Dockerfile sets
`LD_LIBRARY_PATH=/osxcross/lib`; check it didn't get clobbered.

**`GLIBC_2.38 not found`** — the osxcross wrappers were invoked from a
container with too-old glibc (e.g. `bookworm`-based golang image). The
darwin builder uses `debian:trixie` deliberately for glibc 2.41.

**Apple SDK seems too new / too old** — the bundled SDK matches the version
in `crazymax/osxcross:latest` (currently macOS 26.1). Pinning a different
SDK would mean swapping the base in `scripts/Dockerfile.darwin-builder` to
`crazymax/osxcross:<sdk-version>` and adjusting the target triple in
`scripts/build-binaries.sh` accordingly.

**`npm publish` 403** — `npm whoami` to confirm you're logged in; `npm
access list packages` to confirm publish rights on the `hrequests-*` names.

## Bridge changes

When `bridge/server.go` changes, you must rebuild and republish all 5
platform packages — even patch-level edits, since they ship as raw shared
libraries with no runtime version negotiation. The `MACOSX_DEPLOYMENT_TARGET`
values in `scripts/build-binaries.sh` (11.0 for arm64, 10.13 for x64) set
the minimum macOS for the published binaries; bump them only with
intent, since older Macs will get install errors otherwise.
