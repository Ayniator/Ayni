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

## Status
Scaffolding pending: Anchor workspace, membership program, ZK lineage circuits.
