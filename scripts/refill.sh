#!/usr/bin/env bash
#
# refill.sh — mint N fresh single-use invites for a target's room, add them to the
# pool, and republish that target's page at the next version. One command.
#
# Usage: ./scripts/refill.sh <target> <count>     (e.g. ./scripts/refill.sh offtopic 30)
#
# Reads the target from targets.json (roomOwnerVk, riverctlConfigDir, poolFile). riverctl
# must already be joined to that room as a member (member key in riverctlConfigDir) — see
# README "Bootstrap a new room". Minting only generates pre-signed invites locally; it does
# NOT modify room state. The room signing key never leaves the machine.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
RIVERCTL="${RIVERCTL:-$HOME/projects/river/target/release/riverctl}"
PORT="${PORT:-7509}"

TARGET="${1:?usage: refill.sh <target> <count>}"
COUNT="${2:?usage: refill.sh <target> <count>}"
case "$COUNT" in ''|*[!0-9]*) echo "count must be a positive integer" >&2; exit 1;; esac
[ "$COUNT" -ge 1 ] || { echo "count must be >= 1" >&2; exit 1; }

field() { node "$HERE/scripts/target-field.mjs" "$TARGET" "$1"; }
abspath() { case "$1" in /*) printf '%s' "$1";; *) printf '%s/%s' "$HERE" "$1";; esac; }

OWNER="$(field roomOwnerVk)"
ROOM_NAME="$(field roomName)"
CONFIG_DIR="$(abspath "$(field riverctlConfigDir)")"
POOL="$(abspath "$(field poolFile)")"

[ -x "$RIVERCTL" ] || { echo "riverctl not found/executable: $RIVERCTL" >&2; exit 1; }
[ -d "$CONFIG_DIR" ] || { echo "riverctl config-dir missing: $CONFIG_DIR — bootstrap the member first (README)" >&2; exit 1; }

before="$([ -f "$POOL" ] && wc -l < "$POOL" || echo 0)"
echo "→ minting $COUNT invite(s) for \"$ROOM_NAME\" (owner $OWNER)"
minted=0
for _ in $(seq 1 "$COUNT"); do
  code="$("$RIVERCTL" --config-dir "$CONFIG_DIR" -f json invite create "$OWNER" 2>/dev/null \
          | sed -n 's/.*"invitation_code": *"\([^"]*\)".*/\1/p')"
  if [ -n "$code" ]; then printf '%s\n' "$code" >> "$POOL"; minted=$((minted + 1)); printf '.'; else printf 'X'; fi
done
echo
[ "$minted" -eq "$COUNT" ] || echo "⚠ minted only $minted/$COUNT (X = a mint failed)"
after="$(wc -l < "$POOL")"
echo "→ pool $POOL: $before → $after codes"

# Next monotonic version = (last published) + 1. publish.sh advances the counter on success.
prev="$(cat "$HERE/published-version-$TARGET.txt" 2>/dev/null || echo 0)"
next=$((prev + 1))

echo "→ rebuilding + publishing '$TARGET' at version $next"
"$HERE/scripts/build-web.sh" "$TARGET"
"$HERE/scripts/publish.sh" "$TARGET" "$next"

ID="$(grep -oE '[1-9A-HJ-NP-Za-km-z]{43,44}' "$HERE/.build/$TARGET/put.log" 2>/dev/null | sort -u | head -1 || true)"
echo
echo "✅ refill complete — \"$ROOM_NAME\": pool now $after invites · published version $next"
[ -n "$ID" ] && echo "   URL: http://127.0.0.1:$PORT/v1/contract/web/$ID/"
