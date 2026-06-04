// get-state.mjs — read a contract's raw state bytes from the local node over the
// freenet-stdlib flatbuffers WS transport. Shared by the read spike (read.mjs) and the
// pool pruner (scripts/prune-pool.mjs) so both speak to the node through one code path.
import { FreenetWsApi, ContractKey, GetRequest } from '@freenetorg/freenet-stdlib';

export const DEFAULT_WS = 'ws://127.0.0.1:7509/v1/contract/command';

/**
 * GET a contract's current state. Resolves a Uint8Array of state bytes; rejects on
 * host error, not-found, ws close, or timeout. Callers treat a rejection as fail-safe
 * (do nothing) rather than guessing at membership.
 */
export function readState(contractId, { nodeWs = process.env.NODE_WS || DEFAULT_WS, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (x) => { if (!settled) { settled = true; fn(x); } };
    const ok = done(resolve), fail = done(reject);

    const handler = {
      onOpen: () => {
        const key = ContractKey.fromInstanceId(contractId);
        // fetchContract=true → node returns state (and container); no subscribe.
        api.get(new GetRequest(key, true, false, false))
          .then((resp) => ok(Uint8Array.from(resp.state)))
          .catch(fail);
      },
      onContractGet: () => {},            // resolution handled via api.get() promise
      onContractNotFound: () => fail(new Error('contract not found on node')),
      onErr: (e) => fail(new Error(`host error: ${e.cause}`)),
      onContractPut: () => {}, onContractUpdate: () => {},
      onContractUpdateNotification: () => {}, onDelegateResponse: () => {},
      onClose: (code, reason) => fail(new Error(`ws closed: ${code} ${reason || ''}`)),
    };

    const api = new FreenetWsApi(new URL(nodeWs), handler);
    setTimeout(() => fail(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  });
}
