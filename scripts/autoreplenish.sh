#!/usr/bin/env bash
#
# autoreplenish.sh — keep a target's invite pool lean and topped up. Runs on a timer.
#
# Usage: ./scripts/autoreplenish.sh <target> [low] [target_size]
#   defaults: low=20  target_size=40
#
# Every run, in order:
#   1. PRUNE — remove already-USED invites from the pool. A used invite still embeds the
#      now-joined member's private signing key, so we keep the public page to the unused
#      set only, dropping spent ones within the hour.
#   2. TOP UP — if unused <= low, mint (target_size - unused) fresh invites (via refill.sh).
#   3. REPUBLISH — exactly once, and only if the pool changed (pruned and/or minted). A
#      quiet hour (nothing used, nothing minted) publishes nothing → the version doesn't bump.
# Fail-safe: if the live read fails, nothing is pruned, minted, or published.
#
# Designed for cron / a systemd timer: robust PATH, absolute paths, logged output.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# Robust environment for non-interactive (cron/systemd) execution.
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TARGET="${1:?usage: autoreplenish.sh <target> [low=20] [target_size=40]}"
LOW="${2:-20}"
TARGET_SIZE="${3:-40}"

stamp() { date -Is 2>/dev/null || date; }
field() { node "$HERE/scripts/target-field.mjs" "$TARGET" "$1"; }

ROOM_NAME="$(field roomName)"

# 1. Prune used invites (rewrites the pool to unused-only). prune-pool.mjs is fail-safe:
#    on any live-read/decode error it leaves the pool untouched and exits non-zero, so a
#    failed read here aborts the whole run — we never mint or publish on bad data.
OUT="$(node "$HERE/scripts/prune-pool.mjs" "$TARGET")" || {
  echo "[$(stamp)] $TARGET: prune/live-read FAILED — pool & page left untouched" >&2; exit 1; }

UNUSED="$(printf '%s\n' "$OUT" | sed -n 's/^UNUSED \([0-9][0-9]*\) .*/\1/p' | tail -1)"
REMOVED="$(printf '%s\n' "$OUT" | sed -n 's/.* REMOVED \([0-9][0-9]*\).*/\1/p' | tail -1)"
[ -n "$UNUSED" ] && [ -n "$REMOVED" ] || {
  echo "[$(stamp)] $TARGET: could not parse prune output '$OUT' — aborting" >&2; exit 1; }

echo "[$(stamp)] $TARGET (\"$ROOM_NAME\"): $UNUSED unused, pruned $REMOVED used  (low=$LOW, target=$TARGET_SIZE)"

# 2. Top up if at/below the floor. refill.sh appends to the just-pruned pool and publishes
#    once, so its single PUT already reflects the prune — no extra republish needed.
if [ "$UNUSED" -le "$LOW" ]; then
  NEED=$(( TARGET_SIZE - UNUSED ))
  if [ "$NEED" -ge 1 ]; then
    echo "[$(stamp)] $TARGET: <=$LOW unused → minting $NEED to reach $TARGET_SIZE (refill republishes once)"
    "$HERE/scripts/refill.sh" "$TARGET" "$NEED"
    command -v signal >/dev/null 2>&1 && \
      signal "invite pool '$TARGET' replenished: $UNUSED→$TARGET_SIZE unused (+$NEED); pruned $REMOVED used" || true
    exit 0
  fi
fi

# 3. No mint needed. If we pruned anything, republish once so the page sheds the used codes.
if [ "$REMOVED" -ge 1 ]; then
  prev="$(cat "$HERE/published-version-$TARGET.txt" 2>/dev/null || echo 0)"
  next=$((prev + 1))
  echo "[$(stamp)] $TARGET: pruned $REMOVED, no top-up needed → republishing pruned pool at version $next"
  "$HERE/scripts/build-web.sh" "$TARGET"
  "$HERE/scripts/publish.sh" "$TARGET" "$next"
else
  echo "[$(stamp)] $TARGET: nothing used since last run, above floor — no republish"
fi
