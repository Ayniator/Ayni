# Ayni — Security Review & Applied Fixes

**Scope:** the `ayni` Anchor program (`programs/ayni/src/`), the Circom circuits, and the project
concept. **Method:** multi-agent review — a concept-coherence pass plus three adversarial security
auditors (Anchor/Solana, ZK/crypto, governance/economic), each finding pipelined into an independent
skeptical verifier that tried to refute it. 22 candidate findings → **16 confirmed, 6 refuted.**

This document records the verdict and the fixes applied to the **critical + high** findings.

---

## Concept verdict (summary)

Conceptually sincere, structurally **more custodial than the docs claim**: the 7-seat Council is the
on-chain authority while member votes are advisory (`finalize_member_proposal` records `passed`,
which no instruction consumes). The headline correction is to *decide sovereignty explicitly* —
either bind treasury/seat actions to binding member votes, or align the docs with the
Council-is-authority reality. `IMPLEMENTATION.md` now states this model plainly (Council = recovery/
treasury authority; membership = direction by vote). Full conceptual notes live in the review thread.

---

## Findings & status

### Fixed (critical + high)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | 🔴 Critical | **`WithdrawTreasury` replayable → unlimited drain.** Permissionless call, no consumed flag — an executed proposal could be looped to empty the treasury. | Added a one-shot `drained` flag on `Proposal`, set (before the CPI) in `withdraw_treasury`; require `!drained`; assert `amount > 0`; proposal is now `mut`. |
| 2 | 🟠 High | **`mint_membership_token` had no authorization** — anyone could mint soulbound tokens to any account. | Added a `treasurer: Signer` and `require_seat(SEAT_TREASURER)`. |
| 3 | 🟠 High | **Instant `RotateSeat` purge** — a 4-of-7 majority could rotate out the honest minority instantly, then migrate/withdraw uncontested. | `arm_if_ready` now applies the contest window to **every** action (RotateSeat included), so honest seats remain to `cancel_proposal`. |
| 4 | 🟠 High | **Zero-wallet / mass migration seizure** — `MigrateWallet { old_wallet: default() }` would match every anonymous membership (`owner == default`). | `propose` rejects `MigrateWallet`/`WithdrawTreasury` with default or equal wallets, zero amount; `recover_membership` also rejects `old_wallet == default()`. |
| 5 | 🟠 High | **Stolen guardian key hijack** — a backup guardian could overwrite the other guardians and flip `require_cosign` on, locking out the owner and blocking Council recovery. | `set_recovery` now requires the **owner** key (not a guardian) whenever an `owner` is set; only fully-anonymous memberships let a guardian seed recovery. |
| 6 | 🟠 High | **`verify_disclosure` never bound `dateLowerBound`** — a prover could set it to 0 and pass any recency gate. | Added `expected_date_lower_bound` to `DisclosureGate` and bound `public_inputs[12]` to it when `require_date_ok`. |
| 7 | 🟠 High | **Placeholder all-zero verifying keys** for `lineage_grant` and `ack_disclose` — the ZK credential layer was non-functional / forgeable. | Generated **real** keys from a dev trusted setup (circom + snarkjs; `pot13` for lineage, `pot15` for ack_disclose) and embedded them via `scripts/vk_to_rust.js`. *Production still requires a multi-party ceremony.* |

### Open (medium / low — tracked in `BACKLOG.md`)

- **M** `renew_membership` requires no payment/authority — wire a treasury donation.
- **M** lineage proof replayable across `grant_level` / `issue_acknowledgment` (shared VK + layout) — add a domain-separator input.
- **M** lineage Merkle root has no history buffer — add a known-roots ring (in-flight proofs can be griefed).
- **L** `personhood_root` is mutable by one Secretary seat — bind to an externally-rooted unique-human set.
- **L** ack root not bound to `member_commitment`; weak `voting_period`/quorum bounds; caller-chosen proposal nonce griefing; no enforced minimum `recovery_timelock`.

### Refuted (false positives — verified and dismissed)

- Grantee-expiry / level-jump "flaw" — matches the documented monotonic lineage model.
- `issue_membership` personhood binding — anonymity by design (credentials are per-human counters).
- Unchecked `i64` arithmetic — `[profile.release] overflow-checks = true` aborts on overflow.
- Personhood vs voting nullifier collision — 2⁻¹⁹², and non-exploitable (separate roots + PDAs).
- Per-level PDA collision blocking higher grants — contradicted by `granted_level > level` + distinct PDAs.
- Permissionless proposal execution — intentional, standard governance pattern.

---

## Verification

- **Builds clean.** `anchor build` succeeds with the real verifying keys embedded; the Rust unit
  tests pass.
- **Known gap — TypeScript integration tests are stale.** `tests/*.ts` still use the pre-refactor
  API (`appointSeat`, the old 3-arg `initializeCircle`) and these fixes added new signers
  (`treasurer` on `mint_membership_token`), tighter auth (`set_recovery` owner-gating), and a new
  `DisclosureGate.expected_date_lower_bound` field. The TS suite must be rewritten to the current API
  before `anchor test` runs green end-to-end. Tracked as the next task.

**This is a pre-audit review, not a substitute for a professional audit.** Before any production
deployment: run a multi-party trusted-setup ceremony, rewrite/restore the integration tests, address
the open medium/low items, and obtain an external audit.
