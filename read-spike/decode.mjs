// decode.mjs — invite-code → invitee verifying-key, and room-state → member VKs.
// Shared, unit-testable logic reused by the spike and (bundled) by the page.
import bs58 from 'bs58';
import { decode as cborDecode } from 'cbor-x';

/** Normalise a CBOR-decoded 32-byte value (Uint8Array/Buffer/number[]) to a Uint8Array. */
export function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (v && v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error(`expected bytes, got ${typeof v}`);
}

/** base58 invite code → invitee verifying-key (base58 string, 32 raw bytes). */
export function vkFromCode(code) {
  const inv = cborDecode(Buffer.from(bs58.decode(code)));
  const vk = inv?.invitee?.member?.member_vk;
  if (!vk) throw new Error('invite missing invitee.member.member_vk');
  return bs58.encode(toBytes(vk));
}

/** CBOR room-state bytes → Set of member verifying-keys (base58 strings). */
export function memberVksFromState(stateBytes) {
  const state = cborDecode(Buffer.from(stateBytes));
  const members = state?.members?.members;
  if (!Array.isArray(members)) throw new Error('state missing members.members[]');
  const out = new Set();
  for (const am of members) {
    const vk = am?.member?.member_vk;
    if (vk) out.add(bs58.encode(toBytes(vk)));
  }
  return out;
}
