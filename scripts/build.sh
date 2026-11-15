#!/usr/bin/env bash
# Builds the HAMAL Linux binary with the version from the VERSION file.
#
#   scripts/build.sh [output]      (default output: ./HAMAL-Linux; the snap build passes its own path)
#
# Needs Go, a C compiler, pkg-config and the GTK 3 / WebKitGTK 4.1 development packages
# (Ubuntu/Debian: build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev).
# The tags are the ones `wails build -tags webkit2_41` uses for a production build.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(tr -d '[:space:]' < VERSION)"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "VERSION must be a plain X.Y.Z version, got '$VERSION'" >&2
  exit 1
fi

OUTPUT="${1:-HAMAL-Linux}"

CGO_ENABLED=1 go build \
  -trimpath \
  -tags "desktop,production,webkit2_41" \
  -ldflags "-s -w -X main.AppVersion=v${VERSION}" \
  -o "$OUTPUT" .

# The version string must be in the binary exactly as injected.
if ! grep -aq "v${VERSION}" "$OUTPUT"; then
  echo "built $OUTPUT does not contain version v${VERSION}" >&2
  exit 1
fi

echo "Built $OUTPUT (HAMAL v${VERSION})"
