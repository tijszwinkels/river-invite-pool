import { writeFileSync } from 'fs';
import { FreenetWsApi, ContractKey, GetRequest } from '@freenetorg/freenet-stdlib';
const NODE_WS = 'ws://127.0.0.1:7509/v1/contract/command';
const CONTRACT = 'GqxuHdTGP5MHwYDt3cSXSREPmuHAmtdahQacK4krbyPv';
const OUT = process.argv[2];
const api = new FreenetWsApi(new URL(NODE_WS), {
  onOpen: () => api.get(new GetRequest(ContractKey.fromInstanceId(CONTRACT), true, false, false))
    .then(r => { writeFileSync(OUT, Uint8Array.from(r.state)); console.log('wrote', r.state.length, 'bytes ->', OUT); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); }),
  onContractGet(){}, onContractNotFound(){console.error('not found');process.exit(1)},
  onErr(e){console.error('err',e.cause);process.exit(1)}, onContractPut(){},
  onContractUpdate(){}, onContractUpdateNotification(){}, onDelegateResponse(){},
});
setTimeout(()=>{console.error('timeout');process.exit(1)},20000);
