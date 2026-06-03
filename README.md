# River invite-pool — serverless Freenet web contract

A static Freenet **web contract** that hands out one **unused** single-use River
invite at a time, with an honest **"N of M invites left"** counter read from the
room's **live membership** — no server, no online signing key.

One codebase, **multiple target pages** (see `targets.json`). Each target has its
own invite pool, target room, and web-container keypair, so it gets its **own stable
contract id / URL** and the targets never disturb each other.

| Target | Room | Contract id (page URL `…/v1/contract/web/<id>/`) | Keypair |
|---|---|---|---|
| `offtopic` | **Off Topic** (live) | `EL8ikx4zQs7mGjPrnJJgbXKayjv5VqDavCs51sv28C96` | `.web-keys-offtopic.toml` |
| `test` | Kestrel test room | `BWTmLA34uMK4tyuMZpbEdAwbJq2iKiZqVeKLn8YYsqD3` | `.web-keys.toml` |

A page's contract id is derived from `web_container_contract.wasm` + its keypair's
verifying key, so it stays constant across republishes — **keep the `.web-keys*.toml`
files, never commit them**.

## How it works

1. On load the page shows **"syncing…"** and reads the target room's state through
   the local node over the freenet-stdlib **TypeScript client** (flatbuffers WS at
   `ws://<host>/v1/contract/command`). It never shows a count before the read returns.
2. It CBOR-decodes `ChatRoomStateV1.members.members[].member.member_vk` → the set of
   joined verifying-keys. An invite is **used** once its invitee VK appears there.
3. `unused = pool \ used`. It shows **"N of M invites left"** and offers one invite
   chosen **uniformly at random from the unused set** (random is required — a
   deterministic pick would force simultaneous grabbers to collide; see `notes` D6).
4. **Join** is a cross-contract hop: `postMessage({type:'navigate', href})` to the
   gateway shell, which top-navigates to `<river>?invitation=<code>`.
5. On read failure it shows **"couldn't reach the room — retrying…"** and retries
   with backoff — **never a wrong number**.

The room signing key is never here: the pool is a batch of pre-signed single-use
invites minted offline by `riverctl` (joined to the room as a member).

## Architecture & security model

- **Pre-signed pool.** A River invite is a self-contained credential —
  `base58(CBOR(Invitation))` that already bakes in a fresh *invitee* key plus the
  inviter's signature. So a batch can be minted **offline, in advance**, published
  inside a static page, and claimed one at a time. No live key, no server, nothing to
  attack at request time.
- **Scarcity *is* the rate limit.** There is no counter contract and no consensus
  enforcing "one per person" — the only thing between an attacker and unlimited joins
  is the **number of pre-signed invites in the pool**. Publish N invites → at most N new
  members until the next refill. Publishing the whole pool publicly is acceptable: the
  worst case is "the pool drains faster," never "the room key leaked."
- **One invite = one identity.** Each invite carries its own invitee key, so reusing it
  re-asserts the same identity (River says "already a member"). Distinct people need
  distinct invites — hence a *pool*, not a single link.
- **"Used" is read, not tracked.** The page decodes the room's live membership and
  treats an invite as used when its invitee VK is already a member. No state of our own.
- **riverctl member-bootstrap (the key never leaves the machine).** We never extract the
  room owner's key. Instead `riverctl`, joined to the room **as a member**, mints the
  pool: River is a web-of-trust invite model — any member can invite (each pool invite is
  `invited_by = <our member>`). The member signing key lives only in that `riverctlConfigDir`
  on this machine (plaintext, filesystem-protected); if it ever leaked, blast radius = one
  member the owner can ban. (See `notes` D3/D5.)

## Layout

| Path | Role |
|---|---|
| `targets.json` | per-target config: room name/owner/contract, RIVER_BASE, `poolFile`, `riverctlConfigDir`, keypair |
| `src/decode.js` | CBOR → invitee VK / member VKs (Uint8Array-only; shared by node + browser) |
| `src/pick.js` | pure unused-filter + random pick + localStorage de-prioritisation (unit-tested) |
| `src/read-room.js` | open WS, GET room contract, decode → `Set<vk>` |
| `src/app.js` | page entry: UI states, Join wiring, retry loop (reads `CONFIG`) |
| `src/config.generated.js` | baked `{roomName, tag, roomContract, riverBase}` — **generated**, git-ignored |
| `src/pool.generated.js` | baked `[{code, vk}]` — **generated**, git-ignored |
| `web/index.html` | shared page template (inline CSS; room name/tag injected by JS) |
| `scripts/gen-sources.mjs` | `<target>` → `config.generated.js` + `pool.generated.js` + `.build/<target>/meta.sh` |
| `scripts/build-web.sh` | `<target>`: gen-sources + esbuild → `.build/<target>/web/{index.html,app.js}` |
| `scripts/publish.sh` | `<target> [version]`: package the staged dir + sign with the target's keypair + `fdev put`; advances the version counter |
| `scripts/refill.sh` | `<target> <count>`: mint → append to pool → rebuild → publish at next version (one command) |
| `scripts/target-field.mjs` | print one `targets.json` field (used by the shell scripts) |
| `published-version-<target>.txt` | monotonic per-target version counter (the source of truth for the next version) |
| `test/` | hermetic unit tests (`node --test`) over captured fixtures |
| `read-spike/` | the headless read-gate (`read.mjs`) that proved wire-compat (also re-usable read-only against any room via `CONTRACT=… CODES_FILE=… node read.mjs`) |

## Build, test, publish

```sh
npm install                              # esbuild, cbor-x, bs58, @freenetorg/freenet-stdlib
npm test                                 # 7 unit tests (decode + filter + pick)
./scripts/build-web.sh  <target>         # e.g. offtopic | test
./scripts/publish.sh    <target> <ver>   # version MUST increase per target (LWW); URL stays stable
```

A new target = add an entry to `targets.json` (its keypair is generated on first publish).
Targets are isolated: building/publishing one never rebundles or republishes another.

## Refill — one command

When a pool runs low, mint more and republish in a single step:

```sh
./scripts/refill.sh offtopic 30      # mint 30 fresh invites for Off Topic, rebuild, republish
```

`refill.sh <target> <count>` reads the target from `targets.json` (`roomOwnerVk`,
`riverctlConfigDir`, `poolFile`), mints `<count>` invites with `riverctl invite create`,
appends them to the pool, then `build-web.sh` + `publish.sh` at the **next version**
(auto-incremented) and prints the URL + new pool size. Minting only generates pre-signed
invites — it does **not** touch room state; an invite reads as "used" only once someone
*accepts* it and the update propagates.

> Prereq: `riverctl` must already be a member of that room (key in `riverctlConfigDir`).
> If not, do the one-time bootstrap below first.

## Auto-replenish (scheduled)

Keep a pool topped up without thinking about it. `autoreplenish.sh` reads the **live**
unused count and only acts when it's low:

```sh
./scripts/autoreplenish.sh offtopic            # if unused < 20, top up to 50; else no-op
./scripts/autoreplenish.sh <target> <low> <target_size>   # custom thresholds
```

It's fail-safe (never mints if the live read fails), idempotent, and best-effort `signal`s
the operator when it actually replenishes.

Installed as a **systemd user timer** (hourly; survives reboot via lingering):

```sh
# units: ~/.config/systemd/user/river-invite-autoreplenish@.{service,timer}  (templated by target)
systemctl --user enable --now river-invite-autoreplenish@offtopic.timer   # turn on for a target
systemctl --user list-timers 'river-invite-autoreplenish@*'               # when's the next run
journalctl --user -u river-invite-autoreplenish@offtopic.service          # logs
systemctl --user start river-invite-autoreplenish@offtopic.service        # run now
systemctl --user disable --now river-invite-autoreplenish@offtopic.timer  # turn off
```

- **Thresholds** default to low=20 / target=50 (the `@.service` `ExecStart` passes only
  `%i`; append `%i <low> <target>` to change them).
- **Cadence**: edit `OnCalendar=` in the `@.timer` (e.g. `*:0/30` = every 30 min, `daily`).
- **Another room**: `systemctl --user enable --now river-invite-autoreplenish@<target>.timer`.
- The scripts use absolute tool paths (`fdev`, `riverctl`, `web-container-tool`) so they run
  under the timer's minimal environment, not just an interactive shell.

## Bootstrap a new room's pool

To add a page for a brand-new room:

1. **Join as a member.** In the River UI, the room owner mints **one** invite for your
   bot identity (the owner key never leaves the UI's delegate). Accept it with riverctl
   into a fresh config-dir:
   ```sh
   riverctl --config-dir ./.riverctl-<room> invite accept <code> -N "InvitePool"
   ```
2. **Add a target** to `targets.json`:
   ```json
   "<room>": {
     "roomName": "Display Name", "tag": "single-use invites · live",
     "roomOwnerVk": "<owner VK>", "roomContract": "<room contract id>",
     "riverBase": "/v1/contract/web/<river-app-id>/",
     "poolFile": "pool/<room>-codes.txt",
     "riverctlConfigDir": ".riverctl-<room>",
     "webKeys": ".web-keys-<room>.toml"
   }
   ```
3. **Mint + publish.** `./scripts/refill.sh <room> 30` (the keypair and first version are
   created automatically). The page gets its own stable contract id / URL.

## Version policy

Web-container updates are last-writer-wins by an integer **version**, so every republish
of a target must use a strictly higher number. The current version lives in
`published-version-<target>.txt` (tracked, like River's `contract-version.txt`); `refill.sh`
reads it, publishes at `+1`, and `publish.sh` advances the counter on success. **Never**
timestamp-based — counters only ever increase. (Manual `publish.sh <target> <ver>` also
advances the counter, so the two stay consistent.)

## Notes & caveats

- **Rooms are configured in `targets.json`**, not in code. A new room = add a target
  (room name/owner/contract, codes file, keypair) and `build-web.sh`/`publish.sh` it.
  The `offtopic` target points at the live **Off Topic** room; `test` at the throwaway.
- **Sandbox:** the page runs in the gateway's opaque-origin iframe → cookies and
  `localStorage` are blocked. The WS client is constructed with an empty `authToken`
  to skip its cookie read (public room ⇒ no auth). localStorage de-prioritisation is
  therefore inert in-sandbox (degrades gracefully to pure random). See `notes` D7.
- **Collision caveat (D6):** a coordination-free page can't guarantee two *simultaneous*
  grabbers get distinct invites. Mitigations: live used-filtering (sequential case),
  random pick, and a large pool. Never provably zero — the accepted tradeoff of a
  serverless design.

Full design history: `specs/20260603-river-invite-pool/notes/decisions.md`.
