# Ayni — AHA on Solana

**Implementation of:** [AHA](./PROJECT.md) — Ancestral Humanity Anonymous.
**Chain:** Solana.
**Name meaning:** *Ayni* — Andean principle of sacred reciprocity / mutual
giving; reflects the gift-economy, self-supporting nature of the fellowship.

This branch holds the **Solana-specific** realization of the chain-agnostic
AHA model. Nothing here changes the AHA definition on `main`.

## Stack

| Concern | Tool |
|---|---|
| Governance / proposals / voting | **Realms (SPL Governance)** — one Realm per Circle |
| Treasury | **Squads Protocol v4** multisig (treasurer = signer) |
| Membership token | **Token-2022** `NonTransferable` (soulbound) |
| Yearly expiry | **Custom Anchor program** (checks `expiry` timestamp) |
| Progress / levels | **Solana Attestation Service** or **Metaplex compressed NFTs** |
| Servant roles | Squads member permissions + Realms council tokens |
| Federation | World Service Realm holds authority over Circle Realms |
| Forking | New Realm per Circle under the shared governance program |
| Privacy / ZK | **Light Protocol** (ZK compression) / **Arcium** (confidential compute); on-chain Groth16 |

## Trade-off
Sub-cent fees and easy forking, but the anonymous-credential layer
(membership, voting, lineage proofs) is built largely from scratch —
no Semaphore/MACI/Privado equivalent ships on Solana today.

## Anchor workspace (`ayni` program)

```
Anchor.toml                  workspace + program id config
Cargo.toml                   Rust workspace
programs/ayni/
  Cargo.toml · Xargo.toml
  src/
    lib.rs                   #[program] entrypoint
    state.rs                 Circle, Membership, LevelGrant, Lineage, Nullifier
    council.rs               Council (7 seats), Proposal, ProposalAction
    errors.rs                AyniError
    instructions/
      initialize_circle.rs   fork a Circle under World Service
      issue_membership.rs    soulbound yearly membership (by ZK commitment)
      renew_membership.rs    extend a term on donation
      appoint_seat.rs        seat the 7-member Council (bootstrap)
      propose / approve / execute_proposal   4-of-7 Council vote
      recover_membership.rs  rebind membership owner under a migration
      grant_level.rs         shamanic level along an anonymous lineage (ZK)
tests/ayni.ts                init Circle + issue membership
tests/resilience.ts          7-seat Council: rotate seat + migrate wallet (4/7)
migrations/deploy.ts
```

Build (requires the Solana + Anchor toolchain, not installed in this repo):

```
yarn install        # or npm install
anchor build
anchor test
```

## ZK shamanic lineage (implemented)

Anonymous, ZK-verified level grants. Full design in
[docs/zk-lineage.md](./docs/zk-lineage.md).

```
circuits/lineage_grant.circom    Groth16 circuit: Merkle inclusion + level rule + nullifier
circuits/README.md               compile + trusted-setup ceremony + vk export
programs/ayni/src/
  merkle.rs                      on-chain incremental Poseidon Merkle tree (Bn254X5 syscall)
  verifying_key.rs               embedded Groth16 vk (PLACEHOLDER — regenerate via ceremony)
  instructions/initialize_lineage.rs   seat the World Service genesis credential
  instructions/grant_level.rs    verify proof → spend nullifier → append credential → set level
app/lineage/poseidonTree.ts      off-chain tree mirror (auth paths)
app/lineage/prove.ts             assemble witness + format proof for the program
scripts/vk_to_rust.js            verification_key.json → verifying_key.rs
```

How it works: each level is a Poseidon credential leaf in an append-only tree
whose root is on-chain. A grant proves, in zero-knowledge, that *some* hidden
credential of sufficient level — chaining back to the World Service root —
authorized it, emitting a nullifier to prevent replay. The granter's identity is
never revealed; a relayer pays so their wallet isn't linked either.

## Resilience: 7-seat Council & 4-of-7 key recovery (implemented)

Full design in [docs/resilience.md](./docs/resilience.md). Each Circle (and the
World Service Circle) carries a `Council` of **7 seats** (3 named servants + 4
elders) with a **threshold of 4**. Two recovery actions, each 4-of-7:

- **RotateSeat** — replace a seat's wallet (lost key / end of term); executes
  immediately at 4-of-7 (reversible).
- **MigrateWallet** — definitive `walletA → walletB`: `execute_proposal` rebinds
  all 7 Council seats (bounded, atomic); `recover_membership` rebinds each
  membership `owner` (and the levels hanging off it) under the same authorized
  proposal. Approvals are a 7-bit bitmask, so each seat votes once.

**Anti-collusion safeguards.** A migration is *armed* when it hits 4-of-7 but
executes only after a per-Circle **time-lock** (`recovery_timelock`, set at
`initialize_circle`; default 7 days). During that contest window **any single
seat** can `cancel_proposal` to block it. Safety over liveness for irreversible
recovery. (RotateSeat has no time-lock.)

**Member co-signature & self-recovery.** A membership carries an optional
guardian `recovery_key` and a `require_cosign` policy (set at `issue_membership`
or later via `set_recovery`). With `require_cosign`, `recover_membership` also
needs the member's signature (`owner` or `recovery_key`) — so no Council majority
can migrate an opted-in member. A member holding a key can `member_migrate` their
own membership with no vote and no time-lock. `owner` may stay `default()` (fully
anonymous) while a guardian key is set.

Tests (no ZK): `tests/resilience.ts` — 3-of-7 fails / 4-of-7 executes, time-lock
hold-then-execute, single-seat contest. `tests/cosign.ts` — council-only
migration of a `require_cosign` membership is blocked then succeeds with the
guardian; member self-migration.

## Status
- Resilience: **code complete, unbuilt** (runnable via `anchor test` once the
  toolchain is present — no ceremony needed, it's pure on-chain logic).
- ZK lineage: **code complete, unbuilt.** Needs the Solana+Anchor+circom
  toolchain (absent here) to `anchor build` and a **trusted-setup ceremony** to
  replace the placeholder `verifying_key.rs`. The snarkjs→Solana proof byte
  encodings in `prove.ts`/`vk_to_rust.js` must be validated against the
  installed `groth16-solana` version.
- Still stubbed: Token-2022 soulbound mint CPI (`issue_membership`) and the
  donation transfer into the Squads treasury (`renew_membership`).
