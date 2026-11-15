#!/usr/bin/env bash
# Checks that frontend/src/lighttable.css starts with the reference HAMAL lighttable.css unchanged.
# Usage: scripts/check-css-parity.sh [path to the HAMAL checkout, default ../HAMAL]
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:-../HAMAL}/internal/app/static/lighttable.css"
ours=frontend/src/lighttable.css
# The reference rules start at "body.lt {"; ours repeat them, then add the Linux section.
ref_body="$(sed -n '/^body\.lt {$/,$p' "$ref")"
ours_body="$(sed -n '/^body\.lt {$/,$p' "$ours" | sed '/^\/\* HAMAL Linux additions/,$d' | sed '$d')"
ours_body="$(printf '%s\n' "$ours_body" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
if [ "$(printf '%s' "$ref_body" | sha256sum)" != "$(printf '%s' "$ours_body" | sha256sum)" ]; then
  echo "lighttable.css differs from $ref" >&2
  diff <(printf '%s\n' "$ref_body") <(printf '%s\n' "$ours_body") | head -40 >&2
  exit 1
fi
echo "lighttable.css: reference part identical to $ref ($(printf '%s' "$ref_body" | sha256sum | cut -c1-16))"
