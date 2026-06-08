# Ayni — security review

A design-level review of the `ayni` program. Findings are split into **fixed in
this pass**, **operational requirements** (must hold at deploy), and **known
residual risks** (tracked in `BACKLOG.md`). The program is **unbuilt** — this is
a design audit, not a build/fuzz audit.

## Fixed in this pass

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| S1 | High | **`verify_disclosure` access bypass.** Gate requirements were caller-supplied, so a downstream resource checking only "an AccessPass exists for gate G" could be satisfied by a pass minted under *weaker* predicates. | Bind the policy: `requirements_hash = keccak(requirements)` is verified on-chain, stored on the `AccessPass`, **and** is part of its PDA seed. A consumer derives the PDA from the hash of *its own* required policy — a weaker pass lands at a different address. |
| S2 | High | **No recovery for a lost/compromised Circle `authority`.** The Council could recover member/seat keys but not the authority that gates issuance and config — a single point of failure. | New `ProposalAction::SetAuthority` lets the Council rotate `authority` by **4-of-7 + time-lock + contest** (same protection as wallet migration). |
| S3 | Medium | **Duplicate Council seats.** One wallet could occupy several seats (shrinking the effective Council; enabling a double-approval across a rotation, since `seat_of` returns the first index). | `appoint_seat` and `RotateSeat` reject a holder already seated elsewhere (`occupied_elsewhere`). |
| S4 | Medium | **Tree depth could mismatch the circuit.** `initialize_member_tree` / `initialize_lineage` accepted any depth; the circuits are compiled for depth 20, so a wrong depth silently breaks every inclusion proof. | Pin to `merkle::CIRCUIT_DEPTH` (== 20). |

## Properties verified (no change needed)

- **Cross-account isolation.** Privileged actions are gated by `has_one =
  authority`/`circle` plus PDA-derived treasuries/trees, so a forged `Circle`
  only affects the attacker's own Circle — no cross-Circle reach.
- **ZK roots are on-chain, not caller-supplied.** `grant_level`,
  `issue_acknowledgment`, `cast_vote`, `prove_personhood` verify against roots
  read from program accounts; commitments/levels are bound as public inputs.
- **Replay protection.** Every ZK action spends an `init`-created nullifier PDA
  in its own namespace (`nullifier` / `ack_nullifier` / `vote_nullifier` /
  `personhood`), so a proof can't be reused.
- **One vote / one membership.** Votes are nullified per `(member, proposal)`;
  memberships are PDA-unique per commitment; personhood is unique per
  `(human, Circle)`.
- **Arithmetic.** Counters use `saturating_add`; `overflow-checks = true` in the
  release profile makes term arithmetic panic-on-overflow (fails closed).
- **No reentrancy** in the Solana model; CPIs are to System / Token-2022 only.

## Operational requirements (MUST hold at deploy)

1. **Real verifying keys.** All `verifying_key*.rs` are zeroed **placeholders**.
   Run the trusted-setup ceremonies and regenerate them. Confirm the verifier
   **fails closed** with the real keys before mainnet. **Do not deploy with
   placeholders.**
2. **`authority` is a multisig.** Hand `Circle.authority` to a Squads/Realms
   governance PDA after bootstrap. It gates issuance and config; a single hot key
   there is the biggest practical risk (now recoverable via S2, but prevention is
   better).
3. **Genesis lineage key in MPC / multisig.** It roots all lineage proofs and has
   no on-chain recovery (docs/zk-lineage.md §7).
4. **Treasury rent-exemption.** Keep the treasury PDA above the rent-exempt
   minimum so it isn't reaped.
5. **Pin predicate roots.** Consumers of `AccessPass` must check
   `requirements_hash` against their own policy hash (S1).

## Known residual risks (see BACKLOG.md)

- **Social trust at the edges.** A colluding 4-of-7 Council, or a compromised
  multisig `authority`, can still act within the time-lock/contest limits.
  Mitigations: distinct-trust-domain elders, `require_cosign` memberships,
  RotateSeat-purge hardening (open).
- **Ballot privacy.** `choice` is public per ballot (voter hidden, vote visible);
  full coercion-resistance needs MACI (open).
- **Relayer censorship.** A relayer can withhold a vote/grant tx; use multiple
  relayers or self-submit. ZK integrity is unaffected.
- **Metadata.** Timing/funding correlation can deanonymize without disciplined
  relayer/account-abstraction use.
