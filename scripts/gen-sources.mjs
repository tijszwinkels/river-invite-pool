// gen-sources.mjs — materialise per-target build inputs from targets.json:
//   src/config.generated.js   { CONFIG: { roomName, tag, roomContract, riverBase } }
//   src/pool.generated.js     { POOL: [{code, vk}, …] }   (decoded from the target's codes)
//   .build/<target>/meta.sh   shell vars for publish.sh (WEBKEYS, ROOM_NAME, ROOM_CONTRACT)
//
// Usage: node scripts/gen-sources.mjs <target>
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { vkFromCode } from '../src/decode.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('usage: gen-sources.mjs <target>'); process.exit(1); }

const targets = JSON.parse(readFileSync(join(root, 'targets.json'), 'utf8'));
const cfg = targets[target];
if (!cfg) {
  console.error(`unknown target '${target}'. known: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}

// --- pool (decode each invite code → {code, vk}, dedupe by vk) ---
const codesPath = isAbsolute(cfg.poolFile) ? cfg.poolFile : join(root, cfg.poolFile);
const codes = readFileSync(codesPath, 'utf8').trim().split('\n').map((c) => c.trim()).filter(Boolean);
const seen = new Set();
const pool = [];
for (const code of codes) {
  const vk = vkFromCode(code); // throws on a malformed invite → fail loudly
  if (seen.has(vk)) { console.warn(`[gen] skipping duplicate VK ${vk}`); continue; }
  seen.add(vk);
  pool.push({ code, vk });
}
writeFileSync(
  join(root, 'src', 'pool.generated.js'),
  `// AUTO-GENERATED (target=${target}) from ${cfg.poolFile} — do not edit by hand.\n` +
  `export const POOL = ${JSON.stringify(pool, null, 2)};\n`,
);

// --- runtime config baked into the page ---
const config = { roomName: cfg.roomName, tag: cfg.tag, roomContract: cfg.roomContract, riverBase: cfg.riverBase };
writeFileSync(
  join(root, 'src', 'config.generated.js'),
  `// AUTO-GENERATED (target=${target}) — do not edit by hand.\n` +
  `export const CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);

// --- publish metadata (shell-sourceable; values are simple, no escaping needed) ---
const stage = join(root, '.build', target);
mkdirSync(stage, { recursive: true });
writeFileSync(
  join(stage, 'meta.sh'),
  `WEBKEYS=${JSON.stringify(cfg.webKeys)}\n` +
  `ROOM_NAME=${JSON.stringify(cfg.roomName)}\n` +
  `ROOM_CONTRACT=${JSON.stringify(cfg.roomContract)}\n`,
);

console.log(`[gen] target=${target}: ${pool.length} invites · room "${cfg.roomName}" (${cfg.roomContract})`);
