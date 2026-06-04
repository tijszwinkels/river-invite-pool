// read.mjs — GATE spike: read LIVE River room membership through the local node
// using the freenet-stdlib TS client (flatbuffers WS transport), CBOR-decode the
// state, print member VKs, and cross-check against the baked invite pool.
//
// Usage: node read.mjs
//   env: NODE_WS (default ws://127.0.0.1:7509/v1/contract/command)
//        CONTRACT (default = test room contract id)
import { readFileSync } from 'fs';
import { readState } from './get-state.mjs';
import { vkFromCode, memberVksFromState } from './decode.mjs';

const NODE_WS = process.env.NODE_WS || 'ws://127.0.0.1:7509/v1/contract/command';
const CONTRACT = process.env.CONTRACT || 'GqxuHdTGP5MHwYDt3cSXSREPmuHAmtdahQacK4krbyPv';
const CODES_FILE = process.env.CODES_FILE || '/tmp/river-pool/codes.txt';

async function main() {
  console.log(`→ node WS:   ${NODE_WS}`);
  console.log(`→ contract:  ${CONTRACT}\n`);

  const stateBytes = await readState(CONTRACT, { nodeWs: NODE_WS });
  console.log(`✓ got state: ${stateBytes.length} bytes`);

  const memberVks = memberVksFromState(stateBytes);
  console.log(`✓ members in room state: ${memberVks.size}`);
  for (const vk of memberVks) console.log(`    ${vk}`);

  // Cross-check against the baked pool.
  let poolVks = [];
  try {
    const codes = readFileSync(CODES_FILE, 'utf8').trim().split('\n').filter(Boolean);
    poolVks = codes.map((code, i) => ({ i, vk: vkFromCode(code) }));
  } catch (e) {
    console.log(`\n(no pool codes file ${CODES_FILE}: ${e.message})`);
  }

  if (poolVks.length) {
    console.log(`\n→ pool codes: ${poolVks.length}`);
    let used = 0, unused = 0;
    for (const { i, vk } of poolVks) {
      const isMember = memberVks.has(vk);
      if (isMember) used++; else unused++;
      console.log(`    [${i}] ${vk}  ${isMember ? 'USED (in room)' : 'unused'}`);
    }
    console.log(`\n=== ${unused} of ${poolVks.length} invites unused; ${used} already joined ===`);
    // Stable machine-readable line for scripts (autoreplenish.sh greps this).
    console.log(`UNUSED ${unused} TOTAL ${poolVks.length} USED ${used}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n✗ FAILED: ${e.message}`);
  if (/variant index|deserialize|invalid value|index out of range/i.test(e.message)) {
    console.error('  ↳ looks like a WIRE-INCOMPATIBILITY between TS client 0.2.0 and the node.');
  }
  process.exit(1);
});
