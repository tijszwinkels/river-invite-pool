// pick.js — pure invite-selection logic (no DOM, no network) so it's unit-testable.
// An invite is "used" once its invitee VK appears among the room's members.

/** pool: [{code, vk}], memberVks: Set<base58 vk> → the still-unused invites. */
export function computeUnused(pool, memberVks) {
  return pool.filter((p) => !memberVks.has(p.vk));
}

/**
 * Choose one invite to hand out, uniformly at random from the unused set, but
 * de-prioritising codes this browser already handed out (only re-hand those if
 * nothing else is unused). Random pick is REQUIRED (see decisions D6): a
 * deterministic pick would force simultaneous grabbers to collide.
 *
 * unused: [{code, vk}], handedOut: Set<code>, rnd: () => [0,1)  → {code,vk} | null
 */
export function choosePick(unused, handedOut, rnd = Math.random) {
  if (unused.length === 0) return null;
  const fresh = unused.filter((p) => !handedOut.has(p.code));
  const candidates = fresh.length ? fresh : unused;
  return candidates[Math.floor(rnd() * candidates.length)];
}
