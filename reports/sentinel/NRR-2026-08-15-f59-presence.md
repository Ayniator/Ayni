# Non-Regression Report — 2026-08-15 — Round f59-presence

Verdict: **PASS WITH WARNINGS**

Scope: two substantive commits reviewed —

- `351af80` feat(F59): wire the presence attestation on chain, with the proofs tested
- `88116c6` docs(foundation): a test plan, and the treasury hole it turned up

(`a9ed797` between them is the prior round's own bookkeeping and is exempt per
`REVIEWED.md`'s bookkeeping carve-out.)

HEAD at round end: `88116c6d7817013ce5017629038fcf6acbbb598c`.
Previous baseline: `reports/sentinel/NRR-2026-08-15-connect-and-cluster.md` (`a9ed797`).

No `git checkout --`, `stash`, `clean`, or `reset` was run this round. The one
working-tree mutation made (item **b** below, collapsing the two presence
domain tags to the same literal) was applied with `sed` to a single line,
confirmed red on the intended tests, and reverted with `sed` back to the exact
original text; `git status --short` and `git diff` were empty before writing
this report.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | `cargo test`, `cargo build-sbf`, `npm audit` (frontend) | 36 Rust + build clean; 28 audit vulns (0 new, 0 critical, unchanged from last round) | 0 | 36 Rust tests are new to this branch (F59) |
| C — Proof layer | `node tests/presence-zk.test.mjs`; `zk-integrity.sh`; independent mutation of the two domain tags | 12 proof tests + 9 zk-integrity checks; mutation confirmed red (2 Rust + 2 JS) then reverted green | 0 | 12 proof tests new (F59) |
| C — F35-R2 wing-gate script | `f35r2-wing-gate.sh` | 8 | 1 | **1 new failure** — stale caller-allowlist, see Findings |
| B — Sentinel gate scripts | `gate-check.sh`, `glossary-check.sh`, `e12-wallet-check.sh`, `i18n-key-check.sh`, `no-third-party-assets-check.sh`, `privacy-sweep.sh` | 13+10+23+1(1051 keys)+4+5 = all pass | 0 | 0 |
| A — UX/e2e (Playwright) | full suite, 8 files, 2 projects | 66 | 0 | 0 (no new spec files in scope; both commits leave `frontend/e2e` untouched) |
| D — Privacy/Traditions sweep | `privacy-sweep.sh` clean + planted-string negative test; grep for forbidden field names in F59's new files; grep for UI wiring of `Presence` | all clean | 0 | 0 |
| On-chain (local validator) | `tests/treasury-orphan.ts` against a freshly deployed local `solana-test-validator` | 6 | 0 | re-run, not new — proves a pre-existing gap (see Findings) |
| Ground-truth verification (devnet) | independent `getProgramAccounts`/`solana balance` RPC calls, not taken on the document's word | all claims confirmed exactly | — | — |

## Regressions

**None found attributable to `351af80` or `88116c6`.** Both commits do what
they say: `351af80` wires previously-uncommitted, already-designed code with
its tests, and `88116c6` documents a gap and proves it without introducing it.

### CRITICAL (severity) — pre-existing, not introduced by either reviewed commit, now proven with a passing test and independently reproduced this round
**A closed Foundation-child Circle's treasury is reachable by anyone who
re-registers the same (parent, name) pair.** `execute_child_close`
(`programs/ayni/src/instructions/execute_child_close.rs`) closes the child
`Circle` account (`close = recipient`) but never touches or checks the
separate `["treasury", circle]` PDA, and every spend instruction
(`withdraw_treasury`, `withdraw_treasury_token`, `refill_faucet`) requires the
`Circle` account to deserialise, which fails once it is closed. Because
`Circle` is a PDA of `(parent, name)` and `initialize_circle` is permissionless
with **caller-chosen seats**, a stranger can re-register the identical
`(parent, name)`, seat themselves 4-of-7, and draw the orphaned treasury with
its own governance vote. This is exactly what `docs/testing-foundation.md`
claims and `tests/treasury-orphan.ts` demonstrates.
- Epic: F34 (Foundation-led federation governance).
- Not a regression of either reviewed commit: `execute_child_close` and
  `initialize_circle` predate this round; `88116c6` only documents and proves
  the gap (explicitly "No fix is included here… the choice is the user's").
- **Independently reproduced this round, not taken on the author's word**:
  built the current program (`cargo build-sbf`, clean), stood up
  `solana-test-validator -r --ledger /tmp/aha-sentinel-ledger`, airdropped and
  deployed the current program (`AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`)
  fresh, ran `tests/treasury-orphan.ts` unmodified:
  `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
  ANCHOR_WALLET=$HOME/.config/solana/aha-deployer.json npx ts-mocha -p
  ./tsconfig.json -t 1000000 tests/treasury-orphan.ts` → **6 passing**,
  matching the commit's claim exactly. Validator killed afterward.
- **The doc's devnet ground-truth claims were independently verified, not
  trusted**: `getProgramAccounts` on the current program
  (`AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`) filtered by the `Circle`
  discriminator returns **0** accounts; the same call against the old program
  (`3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw`) returns **14**, including
  `DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo`, which matches
  `frontend/.env`'s `NEXT_PUBLIC_FOUNDATION_CIRCLE` exactly. Went one step
  further than the document itself: derived all 14 circles' `["treasury",
  circle]` PDAs under the old program ID and read their live balances —
  **0.1, 0.205 and 0.08 SOL**, three funded treasuries, exactly the three
  amounts the document states. Nothing in the document's ground-truth section
  is wrong.
- This is not run against devnet — only the local-validator drain sequence
  was executed, per the brief's explicit instruction never to run this test
  against devnet because it really moves funds.
- **Recommendation for the team, not a fix Sentinel is making**: the cheapest
  closure named in the doc — require `treasury.lamports == 0` (or that the
  Council has withdrawn it first) in `execute_child_close` — should be treated
  as urgent given three real treasuries are reachable today, however small.
- **Disclosure gap noted**: `BACKLOG.md`'s F34 row is still `✅` with no
  mention of this finding, and `docs/shipped.md` does not carry it either —
  the only place this is recorded is `docs/testing-foundation.md`. Given the
  finding is now proven (not merely suspected), the canonical status tables
  should point at it so a reader of `BACKLOG.md` alone does not miss it.
- **Why this does not by itself flip the round's verdict to FAIL**: Sentinel's
  auto-FAIL categories are privacy-invariant violations, Traditions
  violations, and silent baseline changes. This is none of the three — it is
  a fund-safety bug that predates both reviewed commits, and both commits
  handle it exactly the way the process wants (disclose, prove, do not
  quietly patch a governance-shaped decision without the user's sign-off).
  It is recorded here at full severity because Sentinel's job is to report,
  not to soften what it finds.

## Adversarial checks specifically requested, and what each established

**(a) The distinct-persons rule (shared external nullifier).** Read
`attest_presence_zk.rs` line by line: `external` is computed **once**, on
chain, from `(circle, subject_commitment, month_index)`
(`presence_external_nullifier`), and that single value is used as the public
input for **both** the subject's and the witness's Groth16 verification
(`subject_inputs[2] = external`, `witness_inputs[2] = external`). The caller
supplies `subject_nullifier` and `witness_nullifier` (the nullifier *outputs*)
but never supplies a per-proof external nullifier — there is no argument that
would let a caller feed the two proofs different `E`s. `require!(subject_nullifier
!= witness_nullifier, ...)` therefore genuinely proves two different secrets
produced valid proofs under one shared `E`, matching `docs/presence.md`'s
claim. `tests/presence-zk.test.mjs`'s test 6 ("the shared E is load-bearing")
demonstrates the attack this design prevents. **Confirmed sound.**

**(b) Domain separation between attesting and erasing — mutation-tested
independently, not taken on the commit's word.** Collapsed
`clear_presence.rs`'s tag from `"AHA-presence-clear"` to `"AHA-presence-month"`
(`sed -i '31s/.../.../''`), leaving the Rust source's only difference from
`attest_presence_zk.rs`'s tag gone. Result: `cargo test` → **2 Rust tests red**
(`attesting_and_erasing_never_share_a_nullifier`, `the_preimages_are_frozen`),
`node tests/presence-zk.test.mjs` → **2 JS tests red** ("an attestation proof
does not verify as an ERASURE proof — attest and clear proofs are
interchangeable — CRITICAL", and "this file's external nullifier agrees with
the program's, byte for byte"). This exactly matches the commit's claim.
Reverted the single line (`sed -i '31s/.../.../''` back to
`b"AHA-presence-clear"`), re-ran both suites: 36/36 and 12/12 again.
`git status --short` and `git diff` empty throughout. **Confirmed sound, and
genuinely load-bearing** — the JS test that goes red at the proof level (not
just the frozen-vector check) is the one that would matter in production.

**(c) `single_leaf_root` must never enter `RecentRoots`.** Grepped every
caller of `single_leaf_root` across `programs/ayni/src`: `activate_faucet_zk.rs`
(pre-existing, F35-R2) and now `attest_presence_zk.rs` / `clear_presence.rs`
(F59). Neither new file ever calls `rr.push`, `RecentRoots::push`, or writes to
a `RecentRoots` account at all — `attest_presence_zk.rs` only *reads*
`recent_roots.contains(&witness_root)` (an `Option`, may be absent), and
`clear_presence.rs` does not reference `RecentRoots` at all. The only writer of
`RecentRoots` in the whole crate remains `note_root.rs`
(`rr.push(ctx.accounts.member_tree.root)`), which pushes a genuine tree root,
never a synthetic single-leaf root. **Invariant intact.** See the WARNING
below about the gate script that watches this, though — it now fails
mechanically for an unrelated, cosmetic reason.

**(d) `clear_presence`'s account close — do the PDA seeds genuinely bind?**
`ClearPresence`'s `presence` account is constrained by `seeds = [b"presence",
circle.key().as_ref(), subject_commitment.as_ref()], bump = presence.bump`
with `close = payer`. Since the PDA address is a one-way function of exactly
`(circle, subject_commitment)`, a caller cannot substitute a different
`presence` account for a given `(circle, subject_commitment)` pair — the
address wouldn't match. And in the reverse direction, supplying a different
`circle` derives a *different* address, so it will not match the caller's
actual, previously-written `Presence` PDA — Anchor's seeds+bump check fails
closed either way. Consent is still gated by the Groth16 proof against
`single_leaf_root(subject_commitment)`, so even a caller who supplies the
exact right seeds cannot close a record without the secret behind that
commitment. **Binding confirmed sound**, `has_one` genuinely being impossible
here as the code comment states (the struct stores neither field).

**(e) Epic 4 live-state properties.** `state.rs`'s `Presence` struct is
`{ last_month: u32, bump: u8 }`, `SPACE = 8 + 4 + 1 = 13` — verified by
reading the struct and the constant directly, not the doc's summary. No
timestamp, count, streak, `first_month`, `Vec`, witness identity, or
`circle`/`member` field. Grepped the struct and both new instruction files for
`/(score|rating|rank|karma|tier|badge|count)/i`: the only hits are the
substring `count` inside the English word `account(s)` and prose explaining
why such a field does *not* exist — no forbidden field was introduced.
**Confirmed.**

**(f) `month.rs` boundary constants — independently recomputed, not
re-derived from the code under test.** Used `date -u -d @<epoch>` (a
calendar implementation with no relationship to `civil_from_days`) against
both corrected constants: `1_775_001_599` → `2026-03-31T23:59:59Z`,
`1_775_001_600` → `2026-04-01T00:00:00Z`. Both match the test's comments
exactly. Also spot-checked `1_772_323_200` → `2026-03-01T00:00:00Z`,
`1_709_208_000`/`1_709_251_200` (leap day 2024) and
`951_782_400`/`951_868_800` (leap year 2000) — all correct. **Confirmed
sound**; the corrected constants are right, and the original bug (a day-early
constant that passed while asserting something weaker than its comment
claimed) is fixed.

**(g) `tests/treasury-orphan.ts` and its finding — judged, not merely
replayed.** Read the file in full: it is not an artifact of its own setup.
The Circle PDA is deterministic from `(parent, name)` and the treasury PDA is
deterministic from the Circle address, so re-registering the identical
`(parent, name)` under `initialize_circle`'s genuinely permissionless,
caller-chosen-seats design necessarily reproduces the same treasury address
with its funds intact — this is not something the test's particular donation
amount, timelock value, or seat count could accidentally manufacture.
Cross-checked directly against `execute_child_close.rs`'s account list: it has
no `treasury` account at all, so there is no way for the instruction to have
touched it even implicitly. Independently re-ran the test end to end (see
CRITICAL finding above): 6/6, matching the commit's claim. **The finding is
real, not overstated, and not an artifact of the test's setup.**

**(h) `docs/testing-foundation.md`'s devnet-state claims.** All verified
directly against RPC calls this round issued, not taken on the document's
word (see the CRITICAL finding above for the exact calls and results): 0
Circle accounts under the current program, 14 under the old one including the
exact Foundation address configured in `frontend/.env`, and even the specific
three funded-treasury amounts (0.1 / 0.205 / 0.08 SOL) match to the
lamport. **No inaccuracy found in the document's ground-truth section.**

## Privacy-invariant status (the seven assertions of Layer D)

This repo has no database/server to "dump" in the generic sense the spec
assumes (it is an on-chain program + a static frontend); the seven assertions
are read here as they apply to F59 specifically, which is the only privacy-
relevant surface in scope this round.

1. Sponsor identity / sponsor→member edge — n/a to F59 (no sponsor concept in
   presence; witness is anonymous by construction, never stored). ✔
2. Trust list / chosen-ones list — n/a, not touched. ✔
3. Message content / metadata — n/a, not touched. ✔
4. Biometric material — n/a, not touched. ✔
5. Circle roster — F59 introduces no new roster-revealing surface; `Presence`
   stores no member list. ✔
6. Whether a member has hidden content — n/a, not touched. ✔
7. Faucet parrain→neophyte link — n/a, not touched by either commit; the
   `AHA-presence-*` tags were checked and confirmed distinct from
   `AHA-faucet-grant` both in this round's own grep and in
   `presence_does_not_collide_with_the_faucet_tag`, which re-ran green. ✔

**Ledger-archaeology residual (F59's own accepted risk, per `docs/presence.md`
§1 and the user's 2026-08-14 decision):** `getSignaturesForAddress` on a
derivable `Presence` PDA yields an exact count of a member's attested months,
and iterating commitments yields a ranked table of a whole Circle from the
ledger, though never from live state. **This round honours the instruction to
record it as waived / accepted risk rather than re-raising it as CRITICAL.**
Re-verified only that the *live-state* properties the amendment actually
promises still hold (item e above) — they do.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found in either commit. `attest_presence_zk`/`clear_presence` never rank,
never total, never name the witness, and the account holds one overwritten
scalar. The one thing the design explicitly does **not** achieve — ledger
archaeology enabling an external aggregation — is the disclosed, user-accepted
residual above, not a silent violation.

## Baseline changes this round

None. No `tests/sentinel/baselines/` file was touched by either reviewed
commit.

## Findings, not regressions (by severity)

### WARNING — F59's shipped code has no `tests/sentinel/checklist.yaml` entry
`grep` of the checklist finds only `F59-DOC` (`docs/presence.md`, from the
`gate-fix` round, doc-only, "code not yet landed"). There is no entry covering
`attest_presence_zk`, `clear_presence`, `month.rs`, or
`tests/presence-zk.test.mjs`, all of which shipped in `351af80`. Per the
checklist's own header and `CLAUDE.md`: "missing coverage is a WARNING in
round n and a FAIL in round n+1." This round (n) records the WARNING; an
entry must be added before the next round touching this area or it becomes a
FAIL. Sentinel did not add it itself this round — the brief for this round
restricts writes to report files (plus the reverted mutation in item b).

### WARNING — `tests/sentinel/f35r2-wing-gate.sh` now fails mechanically (exit 1), for a documented, intentional reason
The script's caller-allowlist for `single_leaf_root` (`grep -rln
'single_leaf_root' programs/ayni/src | grep -vE
"(merkle.rs|activate_faucet_zk.rs|proptests.rs)$"`) was not widened for F59's
legitimate, documented reuse of the same F35-R2 trick
(`docs/presence.md` §2 explicitly cites "the F35-R2 trick from
`activate_faucet_zk`"). Real, reproducible exit code: `bash
tests/sentinel/f35r2-wing-gate.sh; echo $?` → **1**. The script's own comment
anticipated this ("Callers outside … are a review trigger, not automatically
wrong — so this reports, loudly"), and this round's own review (item c above)
confirms the underlying invariant it protects (`single_leaf_root` never
entering `RecentRoots`) is intact. But a gate script that stays red is a live
regression risk for CI (§6 of the sentinel spec blocks merge on FAIL), and
nothing in `351af80` or `88116c6` updated its allowlist or otherwise
acknowledged it. Needs a one-line allowlist widening (or an explicit,
committed note) in the next round touching this area.

### WARNING — the treasury-orphan finding is not reflected in `BACKLOG.md`'s or `docs/shipped.md`'s canonical status tables
See the CRITICAL finding above. `BACKLOG.md`'s F34 row remains `✅` with no
pointer to `docs/testing-foundation.md` or the now-proven gap. A reader
consulting only the canonical tables would miss it.

## Coverage gaps (must shrink each round)

- F59's on-chain code (this round's own shipment) — no `checklist.yaml` entry
  yet (WARNING above; becomes FAIL next round if still missing).
- No browser prover, no QR handoff screen, and no `/member` UI reads a
  `Presence` account — explicitly disclosed as "not claimed" by `351af80`
  itself, and confirmed absent by this round's own grep
  (`frontend/app/member/[commitment]/page.tsx` only carries a placeholder
  comment and an `i18n` string saying it is not yet wired). Not a gap this
  round introduced; carried forward until that UI ships.
- `tests/sentinel/f35r2-wing-gate.sh`'s allowlist is stale (WARNING above).
- The pre-existing treasury-orphan gap (CRITICAL finding above) has no
  automated regression gate of its own beyond `tests/treasury-orphan.ts`
  itself, which is not wired into any CI script under `tests/sentinel/`.
- Carried from prior rounds, unchanged by this one: `docs/shipped.md`'s route
  table is still stale (pre-existing, previously disclosed); the T6
  2-of-5 wallet-endorsement tension is unchanged; `isIOS()`'s touch-Mac
  false positive is now *disposed* (comment added by `88116c6`, logic
  argued sound in this round's own read of `isInWalletBrowser()` — an
  extension-carrying Mac is suppressed by the injected-provider check before
  `isIOS()` is even reached) but remains a narrow, accepted, non-fixed
  limitation for a Mac with neither an extension nor a touch display's
  disambiguating feature.

## Verdict rationale

Both reviewed commits do exactly what they say they do, and nothing more.
`351af80` finishes wiring code that was already designed and sitting
uncommitted — the two ZK instructions genuinely enforce "two different
people" and "attesting is not erasing" the way the design promises, the
account genuinely holds nothing but one overwritable number, and a boundary
date bug the author found in their own test was fixed and independently
re-checked against a real calendar rather than trusted. `88116c6` is a
document, and unusually for a document it is more important than most code
changes this round: while writing down how to test the Foundation, it found
that closing a funded child Circle leaves real money sitting at a predictable
address that a stranger can walk up and claim, and it proved this on a local
validator instead of merely arguing it — this round repeated that proof from
a clean deploy and got the same six green checks, and went further to
independently confirm the document's claims about the live devnet chain,
down to the exact lamport balances of three real treasuries sitting exposed
today. Neither commit tries to hide or minimize what it found; the document
says plainly that it is not fixing the bug and that the fix is a governance
choice for the user to make. Because of that honesty, and because the hole
predates both commits rather than being introduced by them, this round's
mechanical verdict is PASS WITH WARNINGS rather than FAIL — but the warnings
include the loudest finding this report contains, and a trusted servant
reading only this paragraph should know: there is real money reachable by a
stranger on devnet right now, it is small, and it should be fixed soon rather
than treated as background noise because the round technically passed.
