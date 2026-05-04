#!/usr/bin/env bash
# Publish the 5 platform packages and the main hrequests-js package.
# Platform packages must be published BEFORE the main package so that
# optionalDependencies resolution sees them on the registry.
#
# Run from the repo root after scripts/build-binaries.sh has produced
# the binaries:
#   bash scripts/publish-all.sh
#
# Requires: an npm session authorized to publish under the unscoped
# "hrequests-*" names (npm whoami should print your account).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/platform-packages"
VERSION=$(node -p "require('$REPO_ROOT/package.json').version")

echo "==> Publishing version $VERSION"

# Sanity check: every platform package must have its binary on disk and
# its version field must already match the main package version.
for dir in "$PKG_DIR"/*/; do
  name=$(basename "$dir")
  if ! ls "$dir"/bridge.* >/dev/null 2>&1; then
    echo "ERROR: $name has no bridge.* binary. Run scripts/build-binaries.sh first." >&2
    exit 1
  fi
  pkg_version=$(node -p "require('$dir/package.json').version")
  if [[ "$pkg_version" != "$VERSION" ]]; then
    echo "Bumping $name from $pkg_version -> $VERSION"
    (cd "$dir" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
  fi
done

# Publish platform packages first.
for dir in "$PKG_DIR"/*/; do
  name=$(basename "$dir")
  echo "==> npm publish $name@$VERSION"
  (cd "$dir" && npm publish --access public)
done

# Then the main package.
echo "==> npm publish hrequests-js@$VERSION"
(cd "$REPO_ROOT" && npm publish --access public)

echo
echo "Done. All 6 packages published at $VERSION."
