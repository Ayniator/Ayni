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
    state.rs                 Circle, Membership, LevelGrant, ServantRole
    errors.rs                AyniError
    instructions/
      initialize_circle.rs   fork a Circle under World Service
      issue_membership.rs    soulbound yearly membership (by ZK commitment)
      renew_membership.rs    extend a term on donation
      appoint_servant.rs     treasurer / secretary / rhythm keeper
      grant_level.rs         shamanic level along an anonymous lineage (ZK)
tests/ayni.ts                init Circle + issue membership
migrations/deploy.ts
```

Build (requires the Solana + Anchor toolchain, not installed in this repo):

```
yarn install        # or npm install
anchor build
anchor test
```

## Status
Scaffold complete (compiles against Anchor 0.30.1 once the toolchain is present).
Stubs to fill in next: Token-2022 soulbound mint CPI, donation transfer into the
Squads treasury on renew, and the Groth16 lineage-proof verification in
`grant_level` (currently a non-empty-proof placeholder).
