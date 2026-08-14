# Non-Regression Report — 2026-08-14 — Round governance

**Verdict: PASS WITH WARNINGS**

**Scope:** two commits, briefed HEAD `1dfefa1` (HEAD drifted to `114f3af` during
this round — a concurrent, unrelated glossary-content commit; `git show 114f3af
--stat` touches only `frontend/public/glossary.json`, `glossary/glossary_v1.xlsx`,
`scripts/fix-glossary-tags.mjs`; confirmed out of scope, not reviewed here).

1. `2f5a7c4` "fix(governance): a single Council seat could pass any member
   proposal alone" — `programs/ayni/src/{council,errors,proptests,state}.rs` +
   `instructions/{begin_member_epoch,create_member_proposal,execute_proposal,
   finalize_member_proposal,propose}.rs` (9 files, 246 insertions, 18 deletions).
2. `1dfefa1` "test(governance): cover the ballot-integrity fix; reconcile the
   registry" — `tests/{epic2,faucet,maci}.ts`, `BACKLOG.md`, `docs/shipped.md`,
   `frontend/components/Nav.tsx`.

Baseline: previous round `glossary` (`reports/sentinel/NRR-2026-08-14-glossary.md`,
PASS WITH WARNINGS). This is the first round in the session's recent history
where `programs/ayni/src/` genuinely changed, so — per the round brief — a full
`anchor test` and `cargo test` were run, not skipped.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — build health | tsc, cargo test, npm audit ×2 | 24 (cargo) + tsc clean + 0 critical | 0 | cargo test reproduced from scratch this round (previously not run — no program code had changed) |
| C — proof/program (Anchor) | `anchor test` (full suite) | 161 | 0 | governance/ballot-integrity coverage in `tests/epic2.ts`, `tests/faucet.ts`, `tests/maci.ts` |
| D — privacy invariants | `privacy-sweep.sh` + forensic devnet check | 5/5 + 1/1 | 0 | devnet `getProgramAccounts` forensic check (new this round) |
| Traditions / process | commit-content verification, error-code/enum-tag audit | 6 claims checked | 0 defeated | first round to adversarially re-derive a governance exploit chain from the pre-fix commit |
| A/B — e2e/API | not run | — | — | unchanged structural gap (no local Next dev server); see coverage gaps |

## Regressions

**None found that reproduce or reopen the fixed exploit.** No functional
regression in previously-working behavior. Four WARNING-severity findings and
one LOW finding, all documented below, none of which defeats the fix under
review.

### Finding 1 — WARNING — docs/BACKLOG reconciliation gap for the fix itself
`2f5a7c4`, the CRITICAL fix this round exists to review, has **no entry** in
`docs/shipped.md` or `BACKLOG.md`. BACKLOG.md's existing F54 row still
describes `begin_member_epoch` as it was **before** this fix (no mention of
the 4-of-7 gate, `MIN_TURNOUT`, `EPOCH_SETTLE_PERIOD`, or `MIN_ELECTORATE`).
`1dfefa1`'s commit message says "reconcile the registry" and does add F67/F68/
F94 rows — but those reconcile the **prior** round's (glossary/nav-menu)
carried-forward WARNING, not this round's fix.

Reproduction: `grep -rn "ballot.integrity\|BeginMemberEpoch" BACKLOG.md
docs/shipped.md` → no output.

Not scored CRITICAL: the code is sound and independently re-verified end to
end (below), and the fix is exhaustively documented in the **commit message**
itself. But CLAUDE.md requires `docs/shipped.md` and `BACKLOG.md` "kept
reconciled in the same commit as the change," and this is the most
consequential change of the round. Per this spec's own coverage-gap rule
(WARNING in round n, FAIL in round n+1), this must be closed before the next
round touches `programs/ayni` or it becomes FAIL-eligible.

### Finding 2 — WARNING (residual, does not defeat this fix) — `vote_passes` foot-gun via `set_circle_config`
`set_circle_config` remains any-seat gated (unchanged by this commit).
`vote_passes(yes, no, p_num, p_den)` with `p_num=0, p_den>0` — reachable by a
single seat setting `CircleConfig` — makes **every** ballot with turnout ≥ 2
"pass" regardless of the actual yes/no split (including 0 yes / 2+ no),
because `yes*p_den >= p_num*turnout` degenerates to `0 >= 0`. `MIN_TURNOUT`
still requires two distinct real voters, so this **cannot** reproduce the
single-seat-alone exploit this round fixes — but it is a real, previously
unexamined foot-gun in config-tunable pass thresholds, untouched by this
commit's stated scope. Recorded for a future round.

### Finding 3 — WARNING (residual, does not defeat this fix) — self-dealt parent for `MIN_ELECTORATE`
`initialize_circle`'s `parent` account is an `UncheckedAccount` — no
constraint requires it to already exist as a Circle. `Circle.parent`'s
immutability is verified TRUE (grepped every write site under
`programs/ayni/src/instructions/*.rs`: the only assignment is
`initialize_circle.rs:40`, at creation, never again), which does make the
commit's stated claim — "a captured seat cannot redirect its Circle at a
parent it controls" — true as stated. But it is incomplete: an attacker
**founding** a new Circle can also found and fully control its "parent,"
self-satisfying the supposedly-external co-sign gate for that Circle for its
entire life. `MIN_TURNOUT=2` still independently blocks a lone human even
through this route (a self-dealt parent still cannot manufacture a second
distinct *child-circle* voter), so this does not reopen the exploit. Recorded
for awareness; a stricter `initialize_circle` parent check (require the
parent to already be an initialized `Circle` account, or a documented root
sentinel) is reasonable future hardening.

### Finding 4 — WARNING — no frontend path for a small Circle to supply a parent co-signer
`frontend/lib/admin.ts` and `frontend/lib/faucet.ts`'s `createMemberProposal`
callers pass no `parentCircle`/`parentSeat` accounts. For a Circle at or above
`MIN_ELECTORATE` (the common case) Anchor's optional-account omission handles
this fine — confirmed via `tsc --noEmit` clean and the IDL marking both
accounts `optional`. But there is **no UI path** for a Circle below
`MIN_ELECTORATE` to supply a parent co-signer: such an admin would hit a bare
`ElectorateTooSmall` on-chain error with no way to proceed from the app. New
gap introduced by this fix, undisclosed in the commit message. Not a
regression (no existing flow broke), but should be wired up before a real
small Circle encounters it.

### Finding 5 — LOW (documentation only) — `errors.rs` doc comment is wrong
The updated `InvalidVotingPeriod` doc comment claims member proposals are
bounded by "MIN_VOTING_PERIOD..=MAX_VOTING_PERIOD, 3–30 days." No
`MIN_VOTING_PERIOD` constant exists anywhere in the codebase (`grep -rn
MIN_VOTING_PERIOD programs/` → zero hits), and the actual enforced range is
`voting_period > 0 && voting_period <= MAX_VOTING_PERIOD` where
`MAX_VOTING_PERIOD = 90 days` — matching `state.rs`'s own comment on that
constant ("90 days, matching the Council child proposals"), not "30." The
doc comment self-contradicts `state.rs` within the same commit. Comment-only;
does not affect behavior, error codes, or any test.

## Verification performed (what was independently re-derived, not accepted on the commit's word)

**Reword claim (process disclosure):** `git diff 2f5a7c4 6cf0841` is **empty**
(0 lines); `git show 6cf0841 --stat` is byte-identical to `git show 2f5a7c4
--stat` (same 9 files, 246/18). TRUE: only the commit message changed.

**The exploit chain**, re-derived against `7a10a48` (pre-fix): confirmed
`begin_member_epoch` was `require_any_seat` and emptied `MemberTree` +
zeroed `member_count`; `reinsert_member` is permissionless (`Signer`, no seat
gate); `create_member_proposal` had no `require!` on `voting_period`;
`quorum_threshold(1,..)` is `.max(1)` = 1, so a manufactured one-leaf tree's
single `yes` met quorum and passed, reaching `refill_faucet` and every
member-vote-gated action. All five steps read and confirmed against the
pre-fix source.

**The four cuts:**
- (a) `MIN_TURNOUT=2` is a hardcoded constant in
  `finalize_member_proposal::member_vote_outcome`, **not** read from
  `CircleConfig` — confirmed no single-seat-controlled path, including
  `set_circle_config` (still any-seat, unchanged), can lower it, because it
  is not config-driven at all.
- (b) `voting_period` bounded `> 0 && <= MAX_VOTING_PERIOD` in
  `create_member_proposal`, previously unchecked.
- (c) `EPOCH_SETTLE_PERIOD` (30d) read via a seed-bound `UncheckedAccount`
  (`recent_roots`), not `Option<Account>`. Confirmed the seeds constraint
  (`seeds=[b"roots", circle]`) makes the address program-derived and
  non-substitutable, and that an account that has never been written
  (`data_is_empty()`) is treated as settled (the check is skipped) rather
  than as a bypass — correct, since a Circle that never rebuilt has no
  manufactured electorate to guard against.
- (d) `begin_member_epoch` requires `proposal.executed` on a
  `ProposalAction::BeginMemberEpoch` proposal bound to the same Circle via
  `has_one = circle`, and burns it via `drained` before touching state.
  Reproduced directly: 3-of-7 refused, 4-of-7 + elapsed contest window
  succeeds, replay of the same executed proposal refused (see `anchor test`
  reproduction below).

**Defeat attempts (all checked, none succeeded):**
- Two colluding seats: still short of the 4-of-7 needed to authorise
  `begin_member_epoch`.
- `set_circle_config` lowering quorum/pass thresholds: quorum's `.max(1)`
  floor remains reachable by one seat (unchanged), but `MIN_TURNOUT` is not
  part of `CircleConfig`, so turnout < 2 still refuses regardless of tuning —
  confirmed by reading the code and by the `a_single_voice_never_passes_a_
  member_ballot` proptest, which varies quorum tuning across the full
  0..1000 range and still refuses a lone `yes`. See Finding 2 for the
  residual (non-defeating) issue this surfaced.
- Circle with exactly 2 or 3 members: 2 triggers the `MIN_ELECTORATE`
  parent-co-sign gate at *creation*; 3 does not, but `MIN_TURNOUT=2` at
  *finalize* still requires two distinct valid membership-commitment votes
  either way — a single human needs two genuine memberships in the same
  Circle's tree to pass anything alone, a separate, pre-existing
  admission/personhood concern this commit neither introduces nor worsens.
- Proposing before a rebuild rather than after: the epoch-settle check is
  skipped entirely (`rr_ai.data_is_empty()`) for a Circle that has never
  rebuilt — correct, not a bypass.
- `MIN_ELECTORATE=3` + parent co-sign, "`Circle.parent` is a PDA seed and
  immutable": VERIFIED TRUE, but see Finding 3 for the residual self-dealing
  gap this surfaced (does not defeat the fix).
- The stated `MIN_ELECTORATE` consequence ("a Circle with fewer than 3
  members whose parent is not a real Circle account cannot open member
  ballots at all") independently confirmed REACHABLE: `initialize_circle`
  accepts literally any pubkey as `parent`, no existence/type check.

**No error-code renumbering:** confirmed by reading the full `AyniError`
enum — every pre-existing variant keeps its original position;
`InvalidVotingPeriod` appears exactly once; the two new variants
(`EpochNotSettled`, `ElectorateTooSmall`) are appended at the very end.

**`ProposalAction::BeginMemberEpoch` appended, not inserted:** confirmed —
it is the last variant in the enum, after `WithdrawTreasuryToken`. No borsh
tag shift for any pre-existing variant or already-stored `Proposal` account.
`ProposalAction::MAX_SIZE` and `Proposal::SPACE` are unchanged (a
zero-payload unit variant cannot grow the max, which is still sized for
`WithdrawTreasuryToken`).

**Proptests:** `a_single_voice_never_passes_a_member_ballot` and
`two_voices_suffice_when_quorum_allows` are non-vacuous (assert real,
distinguishable pre/post conditions over the full quorum-tuning range, and
over `e<=6`, respectively) and independently reproduced passing.
`quorum_boundary`'s correction (unconditional `prop_assert!` →
`prop_assert_eq!(outcome, q>=MIN_TURNOUT)`) is correct: the prior
unconditional assertion was false whenever `qn==0` forces `q==1` — exactly
the exploit's arithmetic, a genuine latent flake, not a style change.

**Full regression, reproduced from scratch** (a stray, already-finished but
non-exiting `anchor test --skip-build` process from a concurrent session was
found running at round start, using a `target/deploy/ayni.so` whose mtime
misleadingly predated the source edits; `strings` on that binary already
showed the new error text and `Instruction: BeginMemberEpoch`, so it was very
likely genuine, but this round did **not** rely on it — the stray was
cleared with `pkill -f '[s]olana-test-validator'` per CLAUDE.md's own memory
guidance, and both suites were reproduced independently end to end on a
freshly built binary):
- `PROPTEST_CASES=2048 cargo test -p ayni --lib`: **24 passed, 0 failed**,
  320.78s — exact match to the commit's claim.
- `anchor build && anchor test` (genuinely fresh SBF binary): **161 passing,
  0 failing** — exact match to the commit's claim, including the
  `begin_member_epoch` 3-of-7-refused/4-of-7-succeeds/replay-refused test in
  `tests/epic2.ts`.
- `cd frontend && npx tsc --noEmit`: clean.
- `npm audit` root: 0 critical (26 total: 13 low/8 moderate/5 high, same
  shape as the prior baseline). frontend: 0 critical (28 total).
- `tests/sentinel/privacy-sweep.sh`: 5/5 pass.
- Devnet forensic check: `getProgramAccounts` filtered on the
  `MemberProposal` discriminator (`[4,231,192,158,99,212,96,254]`) against
  `AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG` on devnet returns **zero
  accounts** — `MIN_TURNOUT`'s retroactive tightening (an in-flight
  one-voter ballot that would have passed before now cannot) has **no blast
  radius on current devnet state**, because no `MemberProposal` exists there
  yet.

**Registry honesty (F67/F68/F94):** consistent with prior rounds' own
independent findings, not merely this round's say-so — the `nav-menu` round
independently confirmed F68 existed and was reachable before this round
reconciled the registry to say so; the `f67`/`f67-r2` rounds independently
confirmed the F67 component existed with the hardcoded-wallet defect live.
F94 correctly cites the `glossary` round's own verification. No
overclaiming found.

## Privacy-invariant status (Layer D)

| # | Invariant | Status |
|---|-----------|--------|
| 1 | No sponsor identity / sponsor→member edge recoverable from a full dump | ✔ (unchanged by this commit; no sponsor data touched) |
| 2 | No trust list / chosen-ones list recoverable | ✔ (unchanged) |
| 3 | No message content / who-messaged-whom metadata recoverable | ✔ (unchanged) |
| 4 | No biometric material recoverable | ✔ (unchanged) |
| 5 | No circle roster recoverable | ✔ (unchanged) |
| 6 | Hidden-content existence not detectable | ✔ (unchanged) |
| 7 | Faucet parrain→neophyte link not recoverable; timing/amount uniform | ✔ (unchanged; `FAUCET_MAX_REFILL_GRANTS`/uniform-amount logic untouched by this commit) |

Mechanical sweep (`tests/sentinel/privacy-sweep.sh`): 5/5 — no analytics/
telemetry SDK, no tracking pixels, no logging macros in the Anchor program,
no `console.*` of identity material, no new `/(score|rating|rank|karma|tier|
badge|count)/i`-matching member-facing field. This commit adds no new
member-facing state field at all (only governance-mechanics constants and a
zero-payload enum variant).

## Traditions check

Rank/compare/aggregate/name-a-sponsor/leak-a-relationship: **none found**.
This commit is pure governance-mechanics (Council quorum/threshold logic);
it touches no member-facing display, no profile field, no visibility tier.

## Baseline changes this round

**None silently made.** `MIN_TURNOUT` is an intentional, disclosed (in the
commit message) retroactive tightening of on-chain vote-finalization logic —
an in-flight ballot with exactly one voter that would previously have passed
now will not. This is judged **correct security behavior** (a patched
program should not honor an in-flight exploit-shaped vote) and, per the
devnet forensic check above, currently affects **zero** live accounts. Not
scored as a "silent" baseline change in the Sentinel-baseline sense (no
`tests/sentinel/baselines/` snapshot changed), but recorded here for
completeness since the round brief asked it to be judged explicitly.

## Coverage gaps (must shrink each round)

- **NEW:** no `BACKLOG.md`/`docs/shipped.md` entry for the ballot-integrity
  fix itself (Finding 1). WARNING this round; FAIL-eligible next round per
  this spec's own escalation rule if still missing.
- **NEW:** no Playwright/e2e coverage of the 4-of-7 `begin_member_epoch`
  flow or the parent-co-sign `create_member_proposal` path in a real
  browser — same structural blocker as every round this month (no local
  Next 16 dev server available in this environment). Substituted with the
  `anchor`/`cargo` test reproduction above, which does exercise both paths
  on-chain.
- STILL OPEN: no automated T6 endorsement-check script exists (carried
  forward, first flagged `f67` round).
- STILL OPEN: wallet-list shuffle fairness has no persisted automated test
  (carried forward, 2026-08-12).
- STILL OPEN: `/settings-security` page-body localisation gap (carried
  forward, `f67-r2`).

## Known flaky (quarantine)

- `governance-anchor-test-teardown`: `anchor test` (both the concurrent
  session's stray run and this round's own from-scratch run) prints its
  final "NNN passing" line and then does not exit on its own — the
  mocha/ts-mocha process hangs on a dangling handle (most likely an
  un-closed `@solana/web3.js` `Connection`/WS subscription) after all tests
  have genuinely completed. Not a test failure (0 failing both times); a
  teardown-only flake, worked around by killing the process tree after
  confirming the pass count in the log. Should be resolved within two
  rounds per spec §3.

## Verdict rationale

The security fix does what it claims. I independently re-derived the
original exploit against the pre-fix code, confirmed all four defensive
cuts actually close it, tried the specific bypass routes the round brief
asked about (colluding seats, small-electorate circles, config manipulation,
timing tricks, self-dealt parents) and found no route that lets a single
Council seat pass a member proposal alone — the closest thing to a surviving
issue (a config-tunable pass-threshold foot-gun, and a self-founded "parent"
Circle) both still require a second genuine, distinct voter, which is exactly
what this fix set out to guarantee. I did not take the test results on trust:
I re-ran the full Rust property-test suite and the full on-chain Anchor test
suite from a clean build myself, on a machine tight enough on memory that I
had to clear a stray, non-exiting process from a concurrent session first —
both runs matched the commit's claims exactly (24/24 and 161/0), and I
checked the compiled program's bytes directly before trusting anything. The
program is safe to upgrade on devnet on the code's own merits. What holds
this back from a clean PASS is process, not security: the round's own commit
message says it "reconciles the registry," but the one entry that actually
matters — the fix itself — is missing from `BACKLOG.md` and
`docs/shipped.md`, and a small circle would hit a dead end in the app UI if
it tried to use the new small-electorate escape hatch today. Those should be
closed before or alongside the deploy, not because the deploy is unsafe, but
because the paper trail and the UI should say what the chain now enforces.
