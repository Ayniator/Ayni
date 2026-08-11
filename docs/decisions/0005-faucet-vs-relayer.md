# ADR 0005 — Faucet vs. relayer

## Status

**Accepted** — **hybrid**: a faucet for first gas, a relayer for proof
submission. The faucet is shipped (pilot); the relayer is not yet built.

## Context

A brand-new member has an empty wallet and cannot pay for a single transaction.
Two different problems hide inside "how do they transact":

1. **Bootstrap gas.** They need a tiny amount of SOL to exist on chain at all.
2. **Fee-payer anonymity.** For any *anonymous* action — a ZK vote, an anonymous
   attestation, a message — whoever pays the fee is named in the transaction, so
   if the prover pays, the proof is deanonymized.

These are not the same problem and one mechanism does not solve both.

- **Faucet (shipped, `F35`).** A parrain-side first-gas grant, with an encrypted
  codes-only treasurer ledger (`F47`) and randomized disbursement timing (`F48`).
  It solves bootstrap. It does **not** solve anonymity — jitter blurs timing but
  the drop-box still observes arrival order (`docs/faucet.md` says so plainly).
- **Relayer (not built, `F55`).** Verified gap: `frontend/lib/zk-vote.ts` and
  `frontend/lib/messaging.ts` both set `payer: wallet.publicKey`, so the prover
  pays and is named. The anonymity that `docs/member-voting.md` and the program
  comments describe **is not yet implemented**. A relayer that submits the proof
  as fee-payer is what closes this.

## Decision

Adopt a **hybrid**:

- **Faucet** handles first-gas bootstrap. Keep it; it is the right tool for
  getting an empty wallet onto the chain.
- **Relayer** handles anonymous-action submission (votes, attestations,
  messages), paying the fee so the prover is not named. Build it (F55); it is a
  prerequisite for E0's anonymous form, E2's whole premise, and E7's interim
  mitigation.

## Consequences

- Until the relayer ships, every "anonymous" on-chain action is **not**
  anonymous at the fee-payer layer, and the product must not claim otherwise.
  This ADR makes that gap an owned, named blocker rather than an implied feature.
- The relayer must not become a new deanonymizer or a single point of censorship:
  it sees the proof and the timing. Its own ADR (owned by F55/E7) must state the
  metadata it can observe and how batching/blinding limits it. This document only
  fixes the *hybrid split*, not the relayer's internals.
- The faucet's timing-privacy is explicitly *pilot-grade* (tab-bound jitter); the
  relayer supersedes it. Do not invest further in faucet-side timing tricks.
