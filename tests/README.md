# Ayni — test suite

Anchor/Mocha tests for the `ayni` program. Two kinds:

- **No-ZK suites** — run today against a local validator, no circuits needed.
- **ZK suite** — needs the circuit compiled + a trusted-setup key (see below).

## Running

```bash
make setup        # toolchain (one-time)
make build        # anchor build  → .so + IDL + target/types/ayni.ts
make test         # anchor test   → local validator + all suites
# or:  anchor test
```

`anchor test` spins up a fresh `solana-test-validator`, deploys the program, and
runs `tests/**/*.ts`. On slow machines (WSL2) the validator boot is covered by
`[test] startup_wait` in `Anchor.toml`.

Two things worth knowing, both learned the first time these suites were actually
executed (2026-08-10 — before that the repo had no toolchain, so none of them
had ever run):

- **`f28-election.ts` is a devnet script, not a suite.** It executes on import
  against the deployed program using the real deployer key, so the glob in
  `Anchor.toml` skips it (`--ignore`); otherwise `anchor test` reaches for devnet
  in the middle of a local run and stalls. Run it explicitly, as its own header
  documents.
- **Optional accounts must be passed as `null`.** `issue_membership` takes
  `open_membership: Option<Account<..>>`; if the client omits the key entirely,
  Anchor derives the PDA from its seeds and the instruction fails with
  `AccountNotInitialized` (3012). Every call therefore passes both
  `personhood: null` and `openMembership: null` for a gated Circle.

If the machine has no Solana/Anchor toolchain, run the suite in a container —
the toolchain needs GLIBC ≥ 2.39, so `ubuntu:24.04` works and `node:20-bookworm`
does not:

```bash
docker run --rm -v "$PWD":/work -w /work \
  -v ~/.local/share/solana/install/active_release:/opt/solana \
  -v ~/.local/bin/anchor:/usr/local/bin/anchor:ro \
  -v ~/.cache/solana:/root/.cache/solana \
  ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y -qq curl &&
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&
    apt-get install -y -qq nodejs && export PATH=/opt/solana/bin:$PATH &&
    npm install && anchor test --skip-build'
```

## Suites & what they verify

| File | Verifies | ZK? |
|---|---|---|
| `ayni.ts` | init Circle, member-set tree, issue soulbound membership | no |
| `resilience.ts` | 7-seat Council 4-of-7; **3/7 fails, 4/7 executes**; migration time-lock; any-seat contest | no |
| `cosign.ts` | member co-signature (either of 2 guardians), member self-recovery | no |
| `vote.ts` | **off-chain ↔ on-chain Poseidon root match**; anonymous ballot proven with the real ceremony key & verified on-chain; double-vote rejected | **yes** |

## Wallets / addresses

You provision **one** real wallet — the provider keypair
(`~/.config/solana/id.json`). Everything else is **ephemeral keypairs the tests
generate and fund via `requestAirdrop`** (free SOL on localnet). Peak funded
accounts in one file = **8** (`resilience.ts`: provider + 7 seats).

Members are **not** addresses — a member is a ZK commitment `Poseidon(secret)`;
a relayer pays so the voter/shaman is never linked on-chain.

The structure is two-tier: the **World Service** foundation at the top and many
local **Circles** under it. Every governance role exists at both tiers, so in
`test accounts.txt` they are prefixed **`World Service …`** (foundation) and
**`Circle …`** (local). The World Service Root is the parent seed of every local
Circle. The table below uses the generic role; read it as applying to either tier.

| Address / role | Used for | Signs? |
|---|---|---|
| **`authority`** (provider; a Squads/Realms multisig in prod) | Circle admin: `initialize_*`, `appoint_seat`, issuance, `set_personhood`, treasury `withdraw` | yes |
| **`worldService`** | parent/root authority — a PDA seed + governing root | no (seed only) |
| **Council seats ×7** (3 servants + 4 elders) | `propose` / `approve` / `cancel_proposal`; a seat signs `create_member_proposal` | yes |
| **member `owner`** (optional, often `default()`) | disclosure / recovery target wallet | only in `member_migrate` |
| **guardian keys ×≤2** | co-sign `recover_membership` / `member_migrate` / `set_recovery` | yes |
| **relayer / payer** | pays fees so the real actor isn't linked (`cast_vote`, `grant_level`, `prove_personhood`) | yes (pays only) |
| **treasury PDA** `["treasury", circle]` | holds donations | program-derived (no key) |
| **mint authority** = Circle PDA | signs the Token-2022 soulbound mint | program-derived |

### Running against a real cluster (devnet) with your own wallets

The suites currently auto-generate + airdrop on **localnet**. To run later against
a funded cluster with addresses **you** control, fill in
[`test accounts.txt`](./test%20accounts.txt) and tell me — I'll wire a
config-driven runner that uses those keypairs instead of airdropped throwaways
(and set `[provider] cluster` accordingly). On devnet, every keypair you list
must be funded (devnet airdrops are rate-limited).

## ZK suite prerequisites (`vote.ts`)

```bash
# 1. compile the circuit  (needs circom 2.x + node_modules/circomlib)
circom circuits/member_vote.circom --r1cs --wasm --sym -l node_modules -o build/
# 2. trusted setup (single-contributor is fine for local testing)
npx snarkjs powersoftau new bn128 13 build/pot13_0.ptau
npx snarkjs powersoftau contribute build/pot13_0.ptau build/pot13_1.ptau -e="…"
npx snarkjs powersoftau prepare phase2 build/pot13_1.ptau build/pot13_final.ptau
npx snarkjs groth16 setup build/member_vote.r1cs build/pot13_final.ptau build/member_vote_0.zkey
npx snarkjs zkey contribute build/member_vote_0.zkey build/member_vote_final.zkey -e="…"
npx snarkjs zkey export verificationkey build/member_vote_final.zkey build/member_vote_vkey.json
# 3. embed the verifying key into the program
node scripts/vk_to_rust.js build/member_vote_vkey.json \
  | sed 's/VERIFYING_KEY/VERIFYING_KEY_VOTE/g' > programs/ayni/src/verifying_key_vote.rs
anchor build
```

`build/` artifacts are git-ignored. The other circuits (`lineage_grant`,
`ack_disclose`) follow the same steps with their own VK files.
