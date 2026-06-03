#!/usr/bin/env bash
#
# publish.sh — package a target's staged page as a Freenet web contract and PUT it.
#
# Usage: ./scripts/publish.sh <target> [version]
#
# Each target has its OWN web-container keypair (targets.json → webKeys), so it gets
# its own STABLE contract id / URL. The id is derived from web_container_contract.wasm
# + that keypair's verifying key, so republishing the same target keeps its URL as long
# as its keypair is unchanged. Run ./scripts/build-web.sh <target> first.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
RIVER="${RIVER_REPO:-$HOME/projects/river}"
WCT="$RIVER/target/release/web-container-tool"
WASM="$RIVER/target/wasm32-unknown-unknown/release/web_container_contract.wasm"
# Absolute fdev so publish works under cron/systemd's minimal PATH (not just an
# interactive shell). Override with FDEV=… if installed elsewhere.
FDEV="${FDEV:-$(command -v fdev || echo "$HOME/.local/bin/fdev")}"
PORT="${PORT:-7509}"

TARGET="${1:?usage: publish.sh <target> [version]  (e.g. test | offtopic)}"
VERSION="${2:-1}"

STAGE="$HERE/.build/$TARGET/web"
META="$HERE/.build/$TARGET/meta.sh"
BUILD="$HERE/.build/$TARGET"

for f in "$WCT" "$WASM" "$FDEV"; do [ -x "$f" ] || { echo "missing/!executable: $f" >&2; exit 1; }; done
[ -d "$STAGE" ] || { echo "no staged build for '$TARGET' — run ./scripts/build-web.sh $TARGET first" >&2; exit 1; }
[ -f "$META" ]  || { echo "missing $META — run ./scripts/build-web.sh $TARGET first" >&2; exit 1; }

# shellcheck disable=SC1090
source "$META"   # → WEBKEYS, ROOM_NAME, ROOM_CONTRACT
KEYS="$HERE/$WEBKEYS"

if [ ! -f "$KEYS" ]; then
  echo "→ generating web-container keypair for '$TARGET' (one-time, gitignored): $KEYS"
  "$WCT" generate --output "$KEYS"
fi

echo "→ target '$TARGET' · room \"$ROOM_NAME\" ($ROOM_CONTRACT) · version $VERSION"
echo "→ packaging $STAGE → webapp.tar.xz"
tar -cJf "$BUILD/webapp.tar.xz" -C "$STAGE" .

echo "→ signing webapp (version $VERSION) with $WEBKEYS"
"$WCT" sign \
  --input "$BUILD/webapp.tar.xz" \
  --output "$BUILD/webapp.metadata" \
  --parameters "$BUILD/webapp.parameters" \
  --key-file "$KEYS" \
  --version "$VERSION"

echo "→ fdev put (port $PORT)"
"$FDEV" --port "$PORT" execute put \
  --code "$WASM" \
  --parameters "$BUILD/webapp.parameters" \
  contract \
  --webapp-archive "$BUILD/webapp.tar.xz" \
  --webapp-metadata "$BUILD/webapp.metadata" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee "$BUILD/put.log"

# Record the published version (monotonic per-target counter; the single source of
# truth that refill.sh reads to compute the next version). Only ever advances.
VERFILE="$HERE/published-version-$TARGET.txt"
PREV="$(cat "$VERFILE" 2>/dev/null || echo 0)"
[ "$VERSION" -gt "$PREV" ] && printf '%s\n' "$VERSION" > "$VERFILE"

echo
echo "=== candidate web-contract id(s) from put.log (base58, 43-44 chars) ==="
grep -oE '[1-9A-HJ-NP-Za-km-z]{43,44}' "$BUILD/put.log" | sort -u || true
echo
echo "Verify which id serves the page:"
echo "  curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/v1/contract/web/<ID>/"
