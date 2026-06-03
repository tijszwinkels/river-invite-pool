// app.js — v1 page entry. Reads LIVE room membership, filters the baked invite
// pool to the still-unused set, shows an honest "N of M invites left" counter,
// and hands out one random unused invite via the gateway's cross-contract Join.
import { CONFIG } from './config.generated.js';
import { POOL } from './pool.generated.js';
import { readMemberVks } from './read-room.js';
import { computeUnused, choosePick } from './pick.js';

// Per-target config (baked at build time). ROOM_CONTRACT's membership decides
// "used"; RIVER_BASE is the River app that accepts the invite.
const { roomContract: ROOM_CONTRACT, riverBase: RIVER_BASE, roomName: ROOM_NAME, tag: TAG } = CONFIG;
const LS_KEY = `riverInvitePool:handedOut:${ROOM_CONTRACT}`;
const M = POOL.length;

const $ = (id) => document.getElementById(id);
const els = {
  count: $('count'), unit: $('countUnit'), join: $('join'),
  hint: $('hint'), codebox: $('codebox'), roomName: $('roomName'), tag: $('tag'),
};

// Identify the room immediately (before the read returns).
els.roomName.textContent = ROOM_NAME;
els.tag.textContent = TAG;
document.title = `Join ${ROOM_NAME} — River invite pool`;

// --- localStorage: codes this browser already handed out (best-effort) ---
function loadHandedOut() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch { return new Set(); }
}
function rememberHandedOut(code) {
  try {
    const s = loadHandedOut(); s.add(code);
    localStorage.setItem(LS_KEY, JSON.stringify([...s]));
  } catch { /* sandbox may block storage; de-prioritisation just won't persist */ }
}

// --- UI states ---
function setJoinEnabled(enabled, label) {
  els.join.textContent = label;
  if (enabled) {
    els.join.removeAttribute('aria-disabled');
    els.join.style.filter = '';
    els.join.style.pointerEvents = '';
  } else {
    els.join.setAttribute('aria-disabled', 'true');
    els.join.removeAttribute('href');
    els.join.style.filter = 'grayscale(1) brightness(.8)';
    els.join.style.pointerEvents = 'none';
  }
}

function showSyncing() {
  els.count.textContent = '…';
  els.unit.textContent = 'syncing…';
  els.codebox.hidden = true;
  els.hint.textContent = 'Reading live room membership to find you an unused invite…';
  setJoinEnabled(false, 'syncing…');
}

function showRetrying() {
  // Never show a (possibly wrong) number on read failure.
  els.count.textContent = '…';
  els.unit.textContent = 'couldn’t reach the room — retrying…';
  els.codebox.hidden = true;
  els.hint.textContent = 'The page reads the room through your Freenet node; reconnecting…';
  setJoinEnabled(false, 'reconnecting…');
}

function showEmpty() {
  els.count.textContent = '0';
  els.unit.textContent = `of ${M} invites left`;
  els.codebox.hidden = true;
  els.hint.textContent = 'Every invite in this pool has been claimed.';
  setJoinEnabled(false, 'No invites left — ask the owner to refill');
}

let joinTarget = null; // single source of truth for the click handler
function showInvite(pick, unusedCount) {
  joinTarget = RIVER_BASE + '?invitation=' + encodeURIComponent(pick.code);
  els.count.textContent = String(unusedCount);
  els.unit.textContent = `of ${M} invites left`;
  els.join.href = joinTarget; // for middle/ctrl-click ("open in new tab")
  els.codebox.hidden = false;
  els.codebox.textContent = pick.code.slice(0, 28) + '…' + pick.code.slice(-12);
  els.hint.textContent = 'Click to open River and accept your single-use invite.';
  setJoinEnabled(true, 'Get my invite →');
  rememberHandedOut(pick.code);
}

// Cross-contract Join: we're inside the gateway's sandbox iframe (no top-nav),
// so a normal link can't reach River (a different contract). postMessage the
// parent shell, which does a top-level navigation preserving ?invitation=…
// (verified against the gateway shell, v0, 2026-06-03).
els.join.addEventListener('click', (e) => {
  if (!joinTarget) { e.preventDefault(); return; }
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let browser open a tab
  e.preventDefault();
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'navigate', href: joinTarget }, '*');
  } else {
    window.location.assign(joinTarget); // standalone (non-sandboxed) fallback
  }
});

function render(memberVks) {
  const unused = computeUnused(POOL, memberVks);
  if (unused.length === 0) { showEmpty(); return; }
  const pick = choosePick(unused, loadHandedOut());
  showInvite(pick, unused.length);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One-shot read with retry-until-success and capped backoff. Once a read
// succeeds we render the honest count and stop; we never render before it.
async function syncOnce() {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      const memberVks = await readMemberVks(ROOM_CONTRACT);
      render(memberVks);
      return;
    } catch (err) {
      console.warn(`[invite-pool] read attempt ${attempt} failed:`, err.message);
      showRetrying();
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}

showSyncing();
syncOnce();
