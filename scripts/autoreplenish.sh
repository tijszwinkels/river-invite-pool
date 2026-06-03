#!/usr/bin/env bash
#
# autoreplenish.sh — keep a target's pool topped up automatically.
#
# Usage: ./scripts/autoreplenish.sh <target> [low] [target_size]
#   defaults: low=20  target_size=50
#
# Reads the target room's LIVE unused-invite count (same read the page does, via
# read-spike/read.mjs). If unused < low, mints (target_size - unused) fresh invites and
# republishes — i.e. tops the pool back up to <target_size> unused. Otherwise does nothing.
# Idempotent and safe to run on a timer; fail-safe (never mints if the read fails).
#
# Designed to run from cron / a systemd timer, so it sets a robust PATH and uses absolute
# paths. Output is logged; on a successful top-up it also tries to send a Signal note.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# Robust environment for non-interactive (cron/systemd) execution.
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TARGET="${1:?usage: autoreplenish.sh <target> [low=20] [target_size=50]}"
LOW="${2:-20}"
TARGET_SIZE="${3:-50}"
NODE_WS="${NODE_WS:-ws://127.0.0.1:7509/v1/contract/command}"

stamp() { date -Is 2>/dev/null || date; }
field() { node "$HERE/scripts/target-field.mjs" "$TARGET" "$1"; }
abspath() { case "$1" in /*) printf '%s' "$1";; *) printf '%s/%s' "$HERE" "$1";; esac; }

ROOM_CONTRACT="$(field roomContract)"
ROOM_NAME="$(field roomName)"
POOL="$(abspath "$(field poolFile)")"

[ -n "$ROOM_CONTRACT" ] || { echo "[$(stamp)] $TARGET: no roomContract in targets.json" >&2; exit 1; }
[ -f "$POOL" ] || { echo "[$(stamp)] $TARGET: pool file missing: $POOL" >&2; exit 1; }

# Read live unused count (fail-safe: if the read fails, do NOT mint).
OUT="$(CONTRACT="$ROOM_CONTRACT" CODES_FILE="$POOL" NODE_WS="$NODE_WS" \
        node "$HERE/read-spike/read.mjs" 2>/dev/null)" || {
  echo "[$(stamp)] $TARGET: live read FAILED — not replenishing" >&2; exit 1; }

UNUSED="$(printf '%s\n' "$OUT" | sed -n 's/^UNUSED \([0-9][0-9]*\) .*/\1/p' | tail -1)"
[ -n "$UNUSED" ] || { echo "[$(stamp)] $TARGET: could not parse unused count — aborting" >&2; exit 1; }

echo "[$(stamp)] $TARGET (\"$ROOM_NAME\"): $UNUSED unused  (low=$LOW, target=$TARGET_SIZE)"

if [ "$UNUSED" -ge "$LOW" ]; then
  echo "[$(stamp)] $TARGET: at/above threshold — nothing to do"
  exit 0
fi

NEED=$(( TARGET_SIZE - UNUSED ))
[ "$NEED" -ge 1 ] || { echo "[$(stamp)] $TARGET: nothing to mint"; exit 0; }

echo "[$(stamp)] $TARGET: below $LOW → minting $NEED to reach $TARGET_SIZE unused"
"$HERE/scripts/refill.sh" "$TARGET" "$NEED"

# Best-effort operator notification (no-op if the tool isn't on PATH).
command -v signal >/dev/null 2>&1 && \
  signal "Off-topic-style invite pool '$TARGET' auto-replenished: $UNUSED → $TARGET_SIZE unused (+$NEED)" || true
