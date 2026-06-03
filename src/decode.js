// decode.js — invite-code → invitee verifying-key, and room-state → member VKs.
// Pure Uint8Array (no Node Buffer) so the SAME file works in the browser bundle
// and in the Node pool generator. Empirically-confirmed CBOR shapes (2026-06-03):
//   invite:      { room, invitee_signing_key, invitee:{ member:{ member_vk: <32 bytes> } }, room_secrets }
//   room state:  { …, members:{ members:[ { member:{ member_vk: <32 bytes> } } ] }, … }
// member_vk is a 32-byte CBOR byte string (ed25519 VerifyingKey).
import bs58 from 'bs58';
import { decode as cborDecode } from 'cbor-x';

/** Normalise a CBOR 32-byte value (Uint8Array / Buffer / number[]) to a Uint8Array. */
export function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (v && v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error(`expected bytes, got ${typeof v}`);
}

function asU8(x) {
  return x instanceof Uint8Array ? x : Uint8Array.from(x);
}

/** base58 invite code → invitee verifying-key (base58 string of the 32 raw bytes). */
export function vkFromCode(code) {
  const inv = cborDecode(asU8(bs58.decode(code)));
  const vk = inv?.invitee?.member?.member_vk;
  if (!vk) throw new Error('invite missing invitee.member.member_vk');
  return bs58.encode(toBytes(vk));
}

/** CBOR room-state bytes → Set of member verifying-keys (base58 strings). Owner is
 *  NOT a member entry (it lives in the room parameters), so it never appears here. */
export function memberVksFromState(stateBytes) {
  const state = cborDecode(asU8(stateBytes));
  const members = state?.members?.members;
  if (!Array.isArray(members)) throw new Error('state missing members.members[]');
  const out = new Set();
  for (const am of members) {
    const vk = am?.member?.member_vk;
    if (vk) out.add(bs58.encode(toBytes(vk)));
  }
  return out;
}
