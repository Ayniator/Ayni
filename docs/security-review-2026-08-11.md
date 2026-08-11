# Security review — 2026-08-11 (66-instruction build)

Adversarial audit of the whole `programs/ayni/` surface, run as a multi-agent
workflow: four subsystem finders (governance, treasury/faucet, membership+ZK,
content/messaging/directory/federation) each producing candidate findings, then a
skeptical **verify** pass per subsystem that opened the cited code and defaulted
to FALSE_POSITIVE unless a concrete exploit held against the real account
constraints and signer checks. Supersedes the 2026-06-10 `SECURITY_REVIEW.md`,
which predated the faucet, MACI, child-federation, messaging, posts, two-sponsor
admission and E11 work.

The verify pass rejected/downgraded several overstated candidates (e.g. a claimed
double-approval threshold drop — false, because `seat_of` returns only the first
seat index; and an "open floodgate" framing of the distinct-persons gap —
overstated, since the confirming party must hold one of 7 seats). What follows is
what survived verification.

## Fixed this round

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | **CRITICAL** | `propose/execute_child_close` never checked `child.parent == foundation`. `foundation` is a caller-supplied `Account<Circle>`; since Circle creation is permissionless, an attacker seats a Circle 4-of-7 themselves and closes **any** Circle (incl. the root), stealing its rent and destroying its council/config. | Bind genuine parentage: `constraint = child.parent == foundation.key()` at **propose** (the vote can only be created for a real parent→child) and re-assert at **execute**. `parent` is immutable after `initialize_circle`. |
| 2 | **CRITICAL** | `execute_child_rotation` authorized when `child.parent == foundation.parent`, and `foundation.parent` is attacker-chosen — a hostile self-seated Circle seizes any Circle's Council (then treasury/mint/membership). | Dropped the `foundation_parent` branch; require strictly `child.parent == foundation.key()` (direct-parent-only, matching the documented model), plus the propose-time parentage constraint. |
| 3 | **HIGH** | `member_migrate` gated only on `is_member_key` (owner **or** a guardian), so a lone stolen guardian key instantly rebinds `owner`, then rewrites the guardian set via `set_recovery` — permanent takeover, defeating `set_recovery`'s own owner-only invariant. | Mirror `set_recovery`: when `owner` is set, **only the owner** may `member_migrate`. Guardian-mediated recovery of a genuinely lost owner goes through the contestable, time-locked Council path `recover_membership` (with member cosignature when `require_cosign`). Anonymous (owner==default) memberships still let a member key seed the owner. |
| 4 | MEDIUM | `initialize_circle` stored a caller-supplied `recovery_timelock` with no validation; a **negative** value makes `eligible_at = 1` (always elapsed), silently deleting the contest window for every MigrateWallet/WithdrawTreasury/RotateSeat. | Reject negative timelocks (`InvalidTimelock`). `0` remains a documented **explicit opt-out** (instant execution) for small/pilot circles; production circles set a real window. |
| 5 | MEDIUM | Tokens sent via `donate_token` were **permanently locked** — the treasury token account is owned by the `["treasury", circle]` PDA, but no instruction ever signed a token CPI with those seeds, and `ProposalAction` had no token-move variant. | Added `ProposalAction::WithdrawTreasuryToken { mint, amount, recipient }` and the `withdraw_treasury_token` instruction (signs `transfer_checked` with the treasury PDA), gated on an executed 4-of-7 proposal, the one-shot `drained` guard, and the same `treasury_allowlist` check as the SOL path. |
| 6 | LOW | `MigrateWallet` execution was the one seat-mutating path lacking the one-holder-per-seat dedup, so a recovery whose `new_wallet` already sat on the Council silently collapsed two seats onto one key. | When `old_wallet` holds a seat, reject a `new_wallet` that already occupies a different seat (`seat_of(new_wallet).is_none()`). Skipped when `old_wallet` holds no seat, so it never blocks a pure membership migration. |
| 8 | LOW (doc) | The two-sponsor distinct-persons rule (`confirm_admission`) is a **key-level** check; one human with two keypairs (a member wallet + a different seat wallet) can satisfy it. The docstring implied a stronger person-level guarantee. | Made the docstring honest: the durable one-human bound is `require_personhood`; this check catches the common key-reuse case; the confirming party must in any case hold one of 7 seats. |

Every fix has a regression test: `tests/federation.ts` (the two CRITICALs),
a guardian-cannot-seize case in `tests/cosign.ts` (#3), and `tests/audit-fixes.ts`
(#4 negative-timelock rejection, #6 MigrateWallet seat-dedup, and a full
`donate_token → withdraw_treasury_token` e2e proving #5's fund-lock is fixed,
including the one-shot replay guard).

## Open / deferred (documented, not yet fixed)

- **#7 (LOW)** — a `MemberProposal` has no on-chain kind/action discriminator, so
  a faucet-refill-authorizing proposal is byte-indistinguishable from a generic
  idea proposal; the human-readable prose lives off-chain and only a client that
  checks `H(prose) == description_hash` catches a mismatch. Outflow is
  ceiling-bounded (≤0.2 SOL) and passing still needs a real member vote, so this
  is a defense-in-depth / UX-binding gap. Durable fix: a `ProposalKind` enum with
  a `FaucetRefill{amount}` variant that `refill_faucet` requires. Deferred (a
  schema change touching the member-proposal flow).
- Pre-existing architectural items from earlier Sentinel rounds (public roster
  R1, sponsor edge R2, message metadata R4, post authorship R5) are unchanged —
  they are what E2/E5/E7 exist to redesign, not point fixes.

## Notes

- `recovery_timelock == 0` is now an explicit, documented waiver of the contest
  window (the cosign/other test circles use it to avoid waiting). A production
  Circle SHOULD set a real window; a Council-governed setter with a floor is a
  reasonable future hardening.
- The `member_migrate` tightening removes an *instant* guardian owner-rebind. The
  guardian recovery **capability** is preserved through `recover_membership`
  (Council 4-of-7, time-locked, contestable, member-cosigned when opted in),
  which is the safe path.
