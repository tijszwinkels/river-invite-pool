# River invite-pool 🛶

Hand out invites to a Freenet **River** room from a plain web page — **no server, no bot
running, no signing key online.** The page shows one *unused* single-use invite at a time
plus an honest **"N of M invites left"** counter read live from the room, and a **Join**
button that opens River and adds the visitor. When the pool runs low, one command (or a
cron) tops it back up.

> Works today for the **Off Topic** room. One repo can serve **many rooms** — each gets its
> own page/URL (see [Use it for another room](#use-it-for-another-room)).

Beware! - This is now a quickly vibe-coded tool. Not reviewed, be aware this is not 
secure. Users can potentially imitate other users in the target chatroom since it leaks the invites.
ONLY USE for public rooms, and even then use with care.

---

## Quick start

**Prerequisites**

- A Freenet node running locally (WebSocket API on `:7509`).
- The River tools, built once from a [river](https://github.com/freenet/river) checkout at
  `~/projects/river`:
  ```sh
  cargo build --release -p riverctl -p web-container-tool
  cargo build --release --target wasm32-unknown-unknown -p web-container-contract
  ```
- This repo's page deps:
  ```sh
  npm install        # esbuild, cbor-x, bs58, @freenetorg/freenet-stdlib
  ```
- Your config — the real `targets.json` is **local-only** (gitignored); start from the example:
  ```sh
  cp targets.example.json targets.json    # then edit it — see "Use it for another room"
  ```

**Build & publish a page** (for an already-configured target, e.g. `offtopic`):

```sh
./scripts/build-web.sh offtopic        # bundle the page for this target
./scripts/publish.sh   offtopic 1      # publish to your node at version 1
```

`publish.sh` prints the page URL — `http://<host>:7509/v1/contract/web/<id>/`. The id is
derived from the target's keypair, so **the URL is stable** across every republish. Share
that URL — that's the invite page.

**Run the tests** (hermetic, no node needed):

```sh
npm test
```

---

## Use it for another room

Point the tool at any room you can get one invite to — **three steps**:

**1 · Join the room as a member** (one-time). In River's UI, the room owner mints **one**
invite for your bot identity, then accept it into a fresh config dir:

```sh
riverctl --config-dir ./.riverctl-myroom invite accept "<paste invite code>" -N "InvitePool"
```

The owner key never leaves the owner's River — your bot only ever holds its **own member
key** (in `.riverctl-myroom/`, gitignored).

**2 · Add the room to `targets.json`** (your local copy of [`targets.example.json`](targets.example.json)):

```json
{
  "myroom": {
    "roomName":          "My Room",
    "tag":               "single-use invites · live",
    "roomOwnerVk":       "<room owner verifying key>",
    "roomContract":      "<room contract id>",
    "riverBase":         "/v1/contract/web/<your-river-app-id>/",
    "poolFile":          "pool/myroom-codes.txt",
    "riverctlConfigDir": ".riverctl-myroom",
    "webKeys":           ".web-keys-myroom.toml"
  }
}
```

Where to get the values:
- `roomOwnerVk` & `roomContract` — `riverctl --config-dir ./.riverctl-myroom debug contract-key <ownerVk>` prints the contract id; the owner VK is the room id River shows you.
- `riverBase` — the River web app you open to accept invites (host-relative path).
- the rest are just file names; they're created for you.

**3 · Mint a pool and publish:**

```sh
./scripts/refill.sh myroom 30
```

That mints 30 invites, builds, and publishes — printing your new page's URL. The keypair and
contract id are generated automatically on first publish. **That's it** — a second page that
never touches the first. (Targets are fully isolated.)

---

## Keep the pool full

**Manually**, when it runs low:

```sh
./scripts/refill.sh offtopic 30        # mint 30 more → rebuild → republish (same URL)
```

**Automatically** — every run `autoreplenish.sh` (a) **prunes used invites** from the pool
(a used invite still embeds the now-joined member's private key, so spent invites are dropped
from the public page within the hour) and (b) **tops up to 40** whenever unused drops to **≤20**.
It republishes only when the pool actually changed, so a quiet hour bumps no version.
Fail-safe: if the live read fails, nothing is pruned, minted, or published.

```sh
./scripts/autoreplenish.sh offtopic                 # defaults: low=20, target=40
./scripts/autoreplenish.sh offtopic <low> <target>  # custom thresholds
```

### Schedule it — option A: systemd user timer (recommended)

Survives reboot (with lingering enabled). Unit templates ship in [`deploy/`](deploy):

```sh
mkdir -p ~/.config/systemd/user
cp deploy/river-invite-autoreplenish@.{service,timer} ~/.config/systemd/user/
# ⚠ edit the ExecStart path in the .service if your clone isn't at ~/projects/.../river-invite-pool
systemctl --user daemon-reload
systemctl --user enable --now river-invite-autoreplenish@offtopic.timer   # hourly

# handy:
systemctl --user list-timers 'river-invite-autoreplenish@*'               # next run
journalctl  --user -u river-invite-autoreplenish@offtopic.service         # logs
systemctl --user start  river-invite-autoreplenish@offtopic.service       # run now
systemctl --user disable --now river-invite-autoreplenish@offtopic.timer  # turn off
```

Enable another room by swapping the target after `@`. Change cadence by editing `OnCalendar=`
in the timer (e.g. `*:0/30` = every 30 min, `daily`); change thresholds via the `.service`
`ExecStart` (`… %i <low> <target>`).

### Schedule it — option B: plain cron

```sh
crontab -e
```
```cron
# hourly: prune used invites + top Off Topic back up to 40 whenever it dips to <=20
0 * * * * /ABSOLUTE/PATH/TO/river-invite-pool/scripts/autoreplenish.sh offtopic 20 40 >> /tmp/river-autoreplenish.log 2>&1
```

The scripts set their own `PATH` and use absolute tool paths, so they run fine under cron's
minimal environment.

---

## Everyday commands

| Goal | Command |
|---|---|
| Build a page | `./scripts/build-web.sh <target>` |
| Publish (version must increase) | `./scripts/publish.sh <target> <version>` |
| Refill now | `./scripts/refill.sh <target> <count>` |
| Check & auto-top-up | `./scripts/autoreplenish.sh <target> [low] [target]` |
| Run unit tests | `npm test` |

---
---

## How it works

1. On load the page shows **"syncing…"** and reads the target room's state through the local
   node via the freenet-stdlib **TypeScript client** (flatbuffers WS at
   `ws://<host>/v1/contract/command`). It never shows a count before the read returns.
2. It CBOR-decodes `ChatRoomStateV1.members.members[].member.member_vk` → the set of joined
   keys. An invite is **used** once its invitee key is in that set.
3. `unused = pool − used`. It shows **"N of M invites left"** and offers one invite chosen
   **uniformly at random from the unused set** (random is required — a deterministic pick
   would make simultaneous visitors collide; see caveats).
4. **Join** is a cross-contract hop: `postMessage({type:'navigate', href})` to the gateway
   shell, which top-navigates to `<river>?invitation=<code>`.
5. On a read failure it shows **"couldn't reach the room — retrying…"** — **never a wrong
   number**.

## Architecture & security model

- **Pre-signed pool.** A River invite is a self-contained credential —
  `base58(CBOR(Invitation))` that already bakes in a fresh *invitee* key plus the inviter's
  signature. So a batch can be minted **offline, in advance**, published in a static page,
  and claimed one at a time. Nothing to attack at request time.
- **Scarcity *is* the rate limit.** No counter contract, no consensus — the only thing
  between an attacker and unlimited joins is the **number of pre-signed invites**. Publish N
  → at most N new members until the next refill. Publishing the pool publicly is fine: worst
  case is "it drains faster," never "the room key leaked."
- **One invite = one identity.** Each invite carries its own key, so reusing it re-asserts
  the same identity. Distinct people need distinct invites — hence a *pool*.
- **"Used" is read, not tracked.** The page decodes the room's live membership; we keep no
  state of our own.
- **The room key never leaves the machine.** We never extract the owner's key. `riverctl`,
  joined to the room **as a member**, mints the pool — River is a web-of-trust invite model,
  so any member can invite (each pool invite is `invited_by = <our member>`). The member key
  lives only in `riverctlConfigDir` on this machine; if it leaked, blast radius is one member
  the owner can ban.

## Files

| Path | Role |
|---|---|
| `targets.example.json` | template config — copy to `targets.json` and fill in your room |
| `targets.json` | your per-room config (**local-only, gitignored**; the only thing you edit to add a room) |
| `src/decode.js` | CBOR → invitee VK / member VKs (shared by node + browser) |
| `src/pick.js` | pure unused-filter + random pick (+ localStorage de-dup); unit-tested |
| `src/read-room.js` | open WS, GET room contract, decode → `Set<vk>` |
| `src/app.js` | page entry: UI states, Join wiring, retry loop |
| `web/index.html` | page template (room name/tag injected at build) |
| `scripts/gen-sources.mjs` | `<target>` → generated config + pool + `meta.sh` |
| `scripts/build-web.sh` | `<target>` → esbuild bundle into `.build/<target>/web/` |
| `scripts/publish.sh` | `<target> [version]` → sign + `fdev put`; advances the version counter |
| `scripts/refill.sh` | `<target> <count>` → mint → append → rebuild → publish (one command) |
| `scripts/prune-pool.mjs` | `<target>` → drop already-used invites from the pool (fail-safe); prints `UNUSED/TOTAL/USED/REMOVED` |
| `read-spike/get-state.mjs` | shared WS `readState()` — GET a contract's state bytes (used by `read.mjs` + `prune-pool.mjs`) |
| `scripts/autoreplenish.sh` | `<target> [low] [target]` → prune used every run; top up when unused ≤ low (for cron) |
| `deploy/` | systemd user timer/service templates |
| `published-version-<target>.txt` | monotonic per-target version counter |
| `test/` | hermetic unit tests over captured fixtures |

**Generated / local-only (gitignored):** `.web-keys*.toml` (page keypairs), `.riverctl-*/`
(member key stores), `pool/*-codes.txt` (live invite pools), `.build/`, `src/*.generated.js`,
`node_modules/`. A fresh clone is **source-only** — `npm install` + the bootstrap above make
it operational.

## Version policy

Web-container updates are last-writer-wins by an integer **version**, so each republish must
use a strictly higher number. The current value lives in `published-version-<target>.txt`;
`refill.sh` reads it and publishes at `+1`, and `publish.sh` advances it on success. Never
timestamp-based — counters only ever increase.

## Caveats

- **Simultaneous-grab collision.** A coordination-free page can't guarantee two people who
  click within the few-second sync window get *distinct* invites. Mitigations: live
  used-filtering (handles the sequential case), random pick, and a big enough pool (collision
  odds ≈ 1/remaining). Never provably zero — the accepted tradeoff of a serverless design.
- **Sandbox storage.** The page runs in the gateway's opaque-origin iframe, so cookies and
  `localStorage` are blocked; the WS client is built with an empty auth token (public room),
  and the per-browser de-dup degrades gracefully to pure random.

Full design history & decisions: `../../specs/20260603-river-invite-pool/notes/decisions.md`.
