// prune-pool.mjs — remove already-USED invites from a target's pool file.
//
// "Used" = the invite's invitee VK is now a member of the room. A used invite still
// embeds that member's *private* signing key, so leaving it in the published page keeps
// a live member's key publicly readable. Pruning keeps the page to the unused set only.
//
// Usage: node scripts/prune-pool.mjs <target>        (targets defined in targets.json)
//   stdout (only on success): UNUSED <n> TOTAL <m> USED <k> REMOVED <k>
//   Rewrites the pool file (atomically) to unused-only — ONLY when something was removed.
//   Fail-safe: any read/decode error → pool left UNTOUCHED, non-zero exit, no stdout line.
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { readState } from '../read-spike/get-state.mjs';
import { vkFromCode, memberVksFromState } from '../read-spike/decode.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('usage: prune-pool.mjs <target>'); process.exit(2); }

const targets = JSON.parse(readFileSync(join(root, 'targets.json'), 'utf8'));
const cfg = targets[target];
if (!cfg) { console.error(`unknown target '${target}'. known: ${Object.keys(targets).join(', ')}`); process.exit(2); }

const poolPath = isAbsolute(cfg.poolFile) ? cfg.poolFile : join(root, cfg.poolFile);

async function main() {
  // 1. Live membership (throws on any wire/decode failure → fail-safe below).
  const members = memberVksFromState(await readState(cfg.roomContract));

  // 2. Current pool, one code per line.
  const codes = readFileSync(poolPath, 'utf8').split('\n').map((c) => c.trim()).filter(Boolean);

  // 3. Partition. A malformed code throws in vkFromCode → fail-safe (we'd rather abort
  //    than silently drop or keep a line we can't classify).
  const kept = [];
  let removed = 0;
  for (const code of codes) {
    if (members.has(vkFromCode(code))) removed += 1; else kept.push(code);
  }

  // 4. Rewrite atomically, only when we actually removed something (no needless churn).
  if (removed > 0) {
    const tmp = `${poolPath}.tmp`;
    writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
    renameSync(tmp, poolPath);
  }

  // 5. Machine-readable summary the orchestrator (autoreplenish.sh) greps.
  console.log(`UNUSED ${kept.length} TOTAL ${codes.length} USED ${removed} REMOVED ${removed}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`prune-pool FAILED (pool left untouched): ${e.message}`);
  process.exit(1);
});
