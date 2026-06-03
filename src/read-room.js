// read-room.js — read LIVE room membership through the local Freenet node.
// Uses the freenet-stdlib TS client (flatbuffers WS transport), proven
// wire-compatible with the 0.8.1 node (read-gate, 2026-06-03).
import { FreenetWsApi, ContractKey, GetRequest } from '@freenetorg/freenet-stdlib';
import { memberVksFromState } from './decode.js';

/** Same-origin node WS endpoint (the host that served this page also serves the
 *  node API). Matches River's own UI. The client appends ?encodingProtocol=flatbuffers. */
export function nodeWsUrl() {
  const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss:' : 'ws:';
  const host = (typeof location !== 'undefined' && location.host) || '127.0.0.1:7509';
  return `${proto}//${host}/v1/contract/command`;
}

/**
 * One-shot: open a WS, GET the room contract, decode → Set<member vk (base58)>.
 * Rejects on host error, not-found, socket close, or timeout. Closes the socket
 * when done so retries don't leak connections.
 */
export function readMemberVks(contractId, { wsUrl = nodeWsUrl(), timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let api = null;
    let timer = null;
    const finish = (fn) => (x) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { api?.ws?.close(); } catch { /* ignore */ }
      fn(x);
    };
    const ok = finish(resolve);
    const fail = finish(reject);

    const handler = {
      onOpen: () => {
        try {
          const key = ContractKey.fromInstanceId(contractId);
          api.get(new GetRequest(key, true, false, false))
            .then((resp) => ok(memberVksFromState(Uint8Array.from(resp.state))))
            .catch(fail);
        } catch (e) { fail(e); }
      },
      onContractGet: () => {},
      onContractNotFound: () => fail(new Error('room contract not found on node')),
      onErr: (e) => fail(new Error(`host error: ${e?.cause || 'unknown'}`)),
      onClose: (code, reason) => fail(new Error(`ws closed: ${code} ${reason || ''}`)),
      onContractPut: () => {}, onContractUpdate: () => {},
      onContractUpdateNotification: () => {}, onDelegateResponse: () => {},
    };

    timer = setTimeout(() => fail(new Error(`read timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      // Pass an explicit empty authToken: the room is public (no auth needed —
      // proven headless), and this bypasses the client's getAuthTokenFromCookie(),
      // which reads document.cookie and throws inside the gateway's sandboxed
      // iframe (no allow-same-origin). River's Rust client sidesteps this; the TS
      // client doesn't. Empty string ⇒ no authToken param, no Authenticate frame.
      api = new FreenetWsApi(new URL(wsUrl), handler, '');
    } catch (e) { fail(e); }
  });
}
