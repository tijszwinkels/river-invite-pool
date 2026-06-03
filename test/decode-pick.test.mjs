// Hermetic unit tests for the CBOR decode + used/unused filter + pick logic.
// Run: node --test  (from the project root)  — uses captured fixtures, no node/network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { vkFromCode, memberVksFromState } from '../src/decode.js';
import { computeUnused, choosePick } from '../src/pick.js';

const here = dirname(fileURLToPath(import.meta.url));
const codes = readFileSync(join(here, 'fixtures/codes.txt'), 'utf8').trim().split('\n').filter(Boolean);
const stateBytes = readFileSync(join(here, 'fixtures/state.bin'));

// VKs proven live in the spike (2026-06-03): code[0] and code[4] joined the room.
const VK0 = 'CT7Pt9qVPY66dbypSsa5aU9EEt57TC7tfw4haZtvvDPh';
const VK4 = 'JDg3AT8J2gVYrKp92wVmXYB2883g9uenDehZsTUbzcfp';

test('vkFromCode decodes invitee.member.member_vk', () => {
  assert.equal(vkFromCode(codes[0]), VK0);
  assert.equal(vkFromCode(codes[4]), VK4);
  // All 5 pool VKs are distinct (minting is correct — D6).
  const vks = new Set(codes.map(vkFromCode));
  assert.equal(vks.size, codes.length);
});

test('memberVksFromState decodes the room members (owner excluded)', () => {
  const m = memberVksFromState(stateBytes);
  assert.ok(m.has(VK0), 'code[0] joined → its VK is a member');
  assert.ok(m.has(VK4), 'code[4] joined → its VK is a member');
  assert.equal(m.size, 2);
});

test('computeUnused filters out joined invites', () => {
  const pool = codes.map((code) => ({ code, vk: vkFromCode(code) }));
  const members = memberVksFromState(stateBytes);
  const unused = computeUnused(pool, members);
  assert.equal(unused.length, 3); // 5 minted − 2 joined
  assert.ok(!unused.some((p) => p.vk === VK0 || p.vk === VK4));
});

test('choosePick returns null when nothing unused', () => {
  assert.equal(choosePick([], new Set()), null);
});

test('choosePick de-prioritises already-handed-out codes', () => {
  const unused = [{ code: 'A', vk: 'a' }, { code: 'B', vk: 'b' }];
  // A already handed out → must return B regardless of rnd.
  assert.equal(choosePick(unused, new Set(['A']), () => 0).code, 'B');
  assert.equal(choosePick(unused, new Set(['A']), () => 0.99).code, 'B');
});

test('choosePick falls back to unused when all were handed out', () => {
  const unused = [{ code: 'A', vk: 'a' }, { code: 'B', vk: 'b' }];
  const handed = new Set(['A', 'B']);
  assert.equal(choosePick(unused, handed, () => 0).code, 'A');
  assert.equal(choosePick(unused, handed, () => 0.99).code, 'B');
});

test('choosePick picks uniformly across the unused set (random, not lowest-index)', () => {
  const unused = [{ code: 'A', vk: 'a' }, { code: 'B', vk: 'b' }, { code: 'C', vk: 'c' }];
  assert.equal(choosePick(unused, new Set(), () => 0).code, 'A');
  assert.equal(choosePick(unused, new Set(), () => 0.5).code, 'B');
  assert.equal(choosePick(unused, new Set(), () => 0.999).code, 'C');
});
