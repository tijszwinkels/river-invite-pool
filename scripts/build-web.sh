#!/usr/bin/env bash
#
# build-web.sh — build a target's page into its own staging dir (.build/<target>/web).
#
# Usage: ./scripts/build-web.sh <target>        (targets defined in targets.json)
#
# Generates per-target config + pool, bundles src/app.js into a single self-contained
# IIFE (TS client + cbor-x + bs58 + flatbuffers + page logic), and stages it alongside
# the shared index.html template. Targets are isolated, so building one never disturbs
# another's published page.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: build-web.sh <target>  (e.g. test | offtopic)}"
STAGE="$HERE/.build/$TARGET/web"

echo "→ generating sources for target '$TARGET'"
node "$HERE/scripts/gen-sources.mjs" "$TARGET"

mkdir -p "$STAGE"
echo "→ bundling src/app.js → .build/$TARGET/web/app.js (esbuild, iife, browser)"
# 'ws' is the TS client's Node-only fallback; in the browser it short-circuits on
# the global WebSocket, so exclude it from the browser bundle.
npx esbuild "$HERE/src/app.js" \
  --bundle \
  --format=iife \
  --platform=browser \
  --target=es2020 \
  --external:ws \
  --minify \
  --legal-comments=none \
  --outfile="$STAGE/app.js"

cp "$HERE/web/index.html" "$STAGE/index.html"

echo "✓ staged $TARGET: index.html + app.js ($(wc -c < "$STAGE/app.js") bytes) in .build/$TARGET/web/"
