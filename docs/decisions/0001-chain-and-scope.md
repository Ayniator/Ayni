# ADR 0001 — Chain, and scope-of-chain

## Status

**Accepted** for the chain choice (de facto). **Open** for scope-of-chain — a
direction is set below but the migration is not yet done.

## Context

Ayni runs on **Solana**. This was never voted; it was decided by shipping: a
58-instruction Anchor program is deployed to devnet at program id
`3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw` (`Anchor.toml`,
`programs/ayni/src/lib.rs`). The other chains in the tree are scaffolds. Re-opening
the chain question would discard working code for no stated benefit.

The genuinely undecided half is **what belongs on chain at all**. The Trust
Platform epic wants the chain to hold only *proofs and quipu milestones* — the
minimal public commitments a fellowship needs to be Sybil-resistant and
tamper-evident. Today the program holds a great deal more:

- `Post` (`state.rs:797`) — forum content
- `Message` (`state.rs:613`) — sealed-box DMs, ciphertext + metadata on chain
- `CircleProfile` (`state.rs:263`) — circle metadata and location
- `WingPeer` (`state.rs:396`) — the sponsor edge, **naming both sides**
- `member_count` (`Circle`, incremented in `confirm_admission.rs:54`)

Every one of these is a public, permanent, globally-readable record. The sponsor
edge in particular is called out as a privacy regression (BACKLOG R2): a
public ledger of who vouched for whom is exactly what an anonymous fellowship
must not keep.

## Decision

1. **Chain = Solana.** Ratified. No further evaluation of alternative L1s.
2. **Target scope = proofs + quipu milestones only.** The chain should converge
   toward: membership commitments (Poseidon), ZK nullifiers/proof anchors,
   quipu cords (completed steps), treasury and governance actions. Human content
   — posts, messages, profiles, and the sponsor edge — should move off chain to
   an encrypted transport (see ADR 0005 and epic E7), leaving at most a
   non-enumerable commitment on chain.

## Consequences

- This is a **subtractive** roadmap: the on-chain content types above are
  deprecation targets, not features to extend. New human-content features should
  not add new on-chain account types.
- The sponsor edge (`WingPeer`) is the highest-priority item to get off chain;
  it is both a privacy leak and load-bearing for admission and the faucet, so
  it cannot simply be deleted — it needs the E7 transport and the E10 relayer
  first. Until then its exposure is acknowledged in
  `activate_faucet.rs` as a pilot limitation.
- Message/Post migration is tracked under E7 (`F63` transport + `F32` sunset).
  This ADR records the *why*; those F-numbers own the *how*.
- No layout-breaking change is implied for existing Circles: scope reduction
  happens by adding off-chain paths and sunsetting on-chain writes, not by
  rewriting deployed account layouts.
