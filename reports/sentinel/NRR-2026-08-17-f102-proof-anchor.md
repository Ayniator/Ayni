# Non-Regression Report — 2026-08-17 — Round f102-proof-anchor
Verdict: **PASS WITH WARNINGS**
Scope: working tree on top of HEAD `e4d1fc0` (branch `solana`) — **F102, the
`ProofAnchor` seam** (ADR 0002 Stage 2): `programs/ayni/src/proof_anchor.rs`
(NEW), `lib.rs`, eleven rewired instruction files, plus pre-existing test-drift
repairs (`tests/epic3.ts`, `tests/epic5.ts`, `tests/faucet.ts`,
`tests/relayer.ts`), `tests/sentinel/checklist.yaml`, and docs
(`BACKLOG.md`, `docs/shipped.md`, `docs/decisions/0002-quantum-resistance.md`,
`docs/messaging-migration.md`). Program change; a devnet upgrade follows this
verdict. Previous baseline: `.so` 1,645,680 bytes / IDL = committed
`frontend/lib/ayni.json` (both reconfirmed byte-identical this round).

## Summary table
| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — build health | tsc --noEmit, cargo test, npm audit | tsc clean, cargo 47/47, audit 0 critical/13 high (pre-existing, untouched deps) | 0 | F102 introduces no new deps |
| B — IDL/API contract | IDL diff (fresh `anchor build` vs committed `frontend/lib/ayni.json`) | 1/1 byte-identical | 0 | — |
| C — proof layer | `anchor test` (declared 17-file suite), `node tests/zk-e2e.test.mjs`, F102 checklist `checks:` | 168/168 (anchor), 23/23 (zk-e2e), 6/6 (checklist) | 0 | F102 checklist entry (new this round) |
| C (extra) — off-suite ZK vote path | `tests/karma.ts`, `tests/treasury-orphan.ts` clean; `tests/vote.ts` 1 failing; `tests/f28-election.ts` silently 0 tests (swallowed) | 27 | 1 (+1 silent) | **pre-existing, NOT caused by F102** — see Regression 1 |
| D — privacy/adversarial | `tests/sentinel/privacy-sweep.sh`, `zk-integrity.sh`, forbidden-identifier grep on all 12 rewired sites + new module | 7/7 gates | 0 | — |
| A/gate — process | `tests/sentinel/gate-check.sh`, `idl-sync-check.sh`, `f35r2-wing-gate.sh`, `no-third-party-assets-check.sh` | 4/4 | 0 | — |

## Regressions

None caused by the F102 diff. Two pre-existing findings surfaced by running
beyond the routinely-executed test list; neither is introduced by this round's
changes (confirmed: neither file, nor `Anchor.toml`, appears in `git diff
HEAD`).

**Regression 1 — WARNING (pre-existing, not F102) — `tests/vote.ts` and
`tests/f28-election.ts` are broken and invisible.**
- `tests/vote.ts:96-100`'s `createMemberProposal` call omits the
  `parentCircle`/`parentSeat` accounts that `create_member_proposal.rs:128`
  (`Option<Account<'info, Circle>>`) has required explicit `null` for since
  commit `2f5a7c4` (`fix(governance): a single Council seat could pass any
  member proposal alone`, 2026-08-14 — three days before this round, and
  untouched by it). Repro: `solana-test-validator --reset --quiet
  --bpf-program AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG
  target/deploy/ayni.so & sleep 8; ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
  ANCHOR_WALLET=~/.config/solana/aha-deployer.json
  NODE_OPTIONS=--experimental-global-webcrypto npx ts-mocha -p ./tsconfig.json
  -t 1000000 tests/vote.ts` → `Error: Account 'parentCircle' not provided.`
  `tests/f28-election.ts:43` has the identical omission.
- **Why this predates and is independent of F102**: `create_member_proposal.rs`
  is not one of the eleven rewired files; the working tree diff for this round
  never touches `tests/vote.ts`, `tests/f28-election.ts`, or `Anchor.toml`.
  `maci.ts` (in the declared suite) shows the fix these two files never
  received: it passes `parentCircle: null, parentSeat: null` explicitly
  (`tests/maci.ts:161-162`).
- **Why it was invisible until now**: neither file is in `Anchor.toml`'s
  `[scripts] test` list (which also omits `karma.ts` and
  `treasury-orphan.ts` — both of which DID run clean this round, 27 passing
  combined). `anchor test` / the implementer's "168 passing" claim, and every
  prior Sentinel round's "anchor test" line, never exercises these files.
  `tests/f28-election.ts` makes this worse than a normal failure: it is a
  self-executing async IIFE (`(async () => {...})().catch(e => log("FAIL:",
  e.message))`, line 62) rather than `describe`/`it` blocks, so its failure is
  swallowed to a `console.log` line and mocha reports **zero** tests from the
  file — not a failure, not a skip, just silence. A reviewer scanning the
  "N passing / 0 failing" summary would never see it.
- **Consequence specific to F102**: no currently-running test exercises a
  genuinely *successful* real-proof call to `cast_vote` (the positive path
  through the rewired `verify_anchored_proof(ProofKind::MemberVote, ...)` at
  that specific call site) — only `tests/vote.ts`'s broken test attempted
  this, and it never reaches `castVote` (it fails earlier, in
  `createMemberProposal`). The same `ProofKind::MemberVote` dispatch IS proven
  correct with real proofs, post-refactor, through six *other* call sites that
  DO pass in the declared suite (`attest_admission_zk`, `activate_faucet_zk`,
  `maci_signup`, `attest_presence_zk` ×2, `clear_presence`,
  `verify_fellow_member`'s negative case) — so the seam function itself is not
  in doubt; only `cast_vote`'s own positive-path wiring lacks a passing test.
  `tests/vote.ts`'s "rejects a double vote" test is also a false-positive: a
  bare `try { … } catch { threw = true }` with `assert.isTrue(threw, ...)`
  passes on *any* thrown error, including this unrelated one — nullifier-reuse
  rejection for the plain (non-MACI) ballot path is not actually being
  verified right now.
- **Recommendation** (not actioned — Sentinel does not fix code): add
  `parentCircle: null, parentSeat: null` to both call sites; add all four
  omitted files to `Anchor.toml`'s `[scripts] test`; replace
  `f28-election.ts`'s IIFE with real `describe`/`it` blocks so a future break
  fails loudly.

**Regression 2 — WARNING (process, recurring) — `anchor test` teardown hang,
still open past its two-round resolution window.** `anchor test` and the
manually-driven extra suite both printed their correct final tallies (168
passing/0 failing; 27 passing/1 failing) and then did not exit — the
mocha/ts-mocha process hung on a dangling handle (same signature as
`governance-anchor-test-teardown`, first quarantined
`NRR-2026-08-14-governance.md`, not yet resolved three rounds later, violating
this spec's own two-round quarantine rule). I killed both hung process trees
after transcribing the pass/fail counts from the log; my detached
verification script (which has no such judgement) recorded these as
`FAIL anchor test (declared list)` and `FAIL extra test files` purely as an
artifact of that intervention — **the true results are the counts above, read
from the log before any kill**, not the script's own FAIL lines. Flagging so
this artifact isn't mistaken for a second functional regression, and so the
open quarantine item gets escalated rather than re-discovered next round.

## Privacy-invariant status (Layer D)
1. Sponsor identity / sponsor→member edge — ✔ (no new code path touches this; `proof_anchor.rs` carries no identity material)
2. Trust list / chosen-ones list — ✔ (unaffected; the seam changes verification plumbing only)
3. Message content / who-messaged-whom — ✔ (untouched by this diff)
4. Biometric material — ✔ (untouched)
5. Circle roster — ✔ (untouched)
6. Hidden-content roster — ✔ (untouched)
7. Faucet parrain→neophyte link — ✔ (`activate_faucet_zk`'s rewiring preserves the exact same VK/error; `f35r2-wing-gate.sh` — the gate proving `activate_faucet_zk` never reads `member_tree.root` and derives the expected root only from `wing_peer.wing` — passes unchanged, 9/9)

`tests/sentinel/privacy-sweep.sh`: 5/5 (no analytics/telemetry SDK, no
tracking pixels, no logging macros in the Anchor program, no `console.*` of
identity material, no score/rating/rank/reputation field — karma waived,
F98). `tests/sentinel/zk-integrity.sh`: 9/9 (all three verifying keys —
`member_vote`, `lineage_grant`, `ack_disclose` — byte-identical between the
committed zkeys and the Rust constants `proof_anchor.rs` imports unchanged).
Grep of `proof_anchor.rs` and all 11 rewired instruction files for
`/(score|rating|rank|karma|tier|badge|count)/i`: only pre-existing,
diff-untouched hits (`signup_count` in `maci_signup.rs`, "crank"/"cranked"
substring matches of `/rank/i` in doc comments) — none new, none in this
diff's added lines (confirmed against `git diff HEAD` per file).

## Traditions check
No ranking, comparison, aggregation, sponsor-naming, or relationship-leak
found. F102 is a pure verification-plumbing refactor; it touches no
member-facing data model. Karma waiver (F98) not re-litigated per standing
instruction.

## Baseline changes this round
None requiring justification. `.so` size: **1,645,680 bytes**, matching the
implementer's claimed baseline exactly (own fresh `anchor build`, not taken on
trust). IDL: `target/idl/ayni.json` vs committed `frontend/lib/ayni.json` —
byte-identical (`JSON.stringify` equality, own fresh build). `checklist.yaml`
gained one new entry (F102, 6 `checks:`) — this is the required "new feature
gains coverage in the same round" addition, not a silent change; all 6 checks
independently re-run and pass.

## The seam — verified, not inferred
- `grep -rn "Groth16Verifier::new" programs/ayni/src --include="*.rs" | grep -v proof_anchor` → **empty**. Total.
- Per-site VK/error diff against `git show HEAD` for all 11 files (12 call sites): every site passes the identical `ProofKind`→VK pair and identical `AyniError` variant it used before the refactor. Checked explicitly: `cast_vote`→`ProofKind::MemberVote`/`VoteProofInvalid` (was `VERIFYING_KEY_VOTE`/`VoteProofInvalid`), `grant_level`→`LineageGrant`/`InvalidLineageProof` (was `VERIFYING_KEY`/`InvalidLineageProof`), `verify_disclosure`→`AckDisclose`/`DisclosureProofInvalid` (was `VERIFYING_KEY_ACK`/`DisclosureProofInvalid`), `attest_presence_zk` both calls→`MemberVote`/`VoteProofInvalid` (was `VERIFYING_KEY_VOTE`/`VoteProofInvalid` twice), plus `activate_faucet_zk`, `attest_admission_zk`, `prove_personhood`, `issue_acknowledgment`, `verify_fellow_member`, `clear_presence`, `maci_signup` — no swap found in any.
- No leftover `groth16_solana`/`verifying_key*` imports anywhere in `programs/ayni/src/instructions/*.rs`.
- Negative path exercised through the seam (not an earlier `require!`):
  `tests/epic2.ts` "verify_fellow_member rejects a garbage proof against a
  genuine anchor" — the anchor entry is genuine (`entry.root != 0` passes;
  `publishMemberRoot` ran first) so the only remaining check that can reject
  the all-zero proof is `verify_anchored_proof`'s own Groth16 verification,
  and the assertion (`assert.include(String(e), "VoteProofInvalid")`) matches
  the seam's mapped error — passed, 3707ms.
- Karma-account test repair faithful: `KarmaAward::lo`/`hi`
  (`state.rs:1494-1499`, `a <= b` on `[u8;32]`) and
  `establish_wing_peer.rs:140-145`'s seed order (`["karmaaward", circle, lo,
  hi]`) mirror the repaired `tests/{epic3,epic5,faucet}.ts`'s `Buffer.compare
  <= 0 ? [a,b] : [b,a]` exactly, matching the pre-existing helper in
  `tests/karma.ts:46-48`. Corroborated independently by
  `cargo test`'s `state::karma_tests::the_award_pair_seed_is_order_independent`
  (passed).
- `tests/relayer.ts`'s `computeUnits: undefined` addition matches
  `frontend/lib/relayPolicy.ts:259,330`'s ok-shape (`computeUnits?: number`,
  only populated for the presence entry — `cast_vote` correctly carries
  `undefined`).

## Coverage gaps (must shrink each round)
- `tests/vote.ts` / `tests/f28-election.ts` broken + `Anchor.toml`'s
  `[scripts] test` omitting 4 files (see Regression 1) — **new finding this
  round**, must shrink starting next round.
- `governance-anchor-test-teardown` flake — open since 2026-08-14, now past
  its two-round resolution window (see Regression 2) — escalate.
- F102's own checklist entry has no `uncovered:` section; given the above, one
  belongs there next round, naming `tests/vote.ts`'s missing positive-path
  `cast_vote` coverage explicitly.
- docs/shipped.md's F102 entry states "168 passing / 0 failing... previous
  best 157" without disclosing that four test files sit outside that count —
  true as far as it goes, but the "full anchor suite" framing invites the
  same false confidence this round found. Not a false claim (it is scoped to
  the declared script), but worth a one-line disclosure next time this area
  is touched.

## Verdict rationale
The refactor itself is clean: every one of the twelve places that used to
build its own proof verifier now goes through one function, and — checked by
diffing against the code before the change, not by reading the new code in
isolation — each site still uses the exact same cryptographic key and reports
the exact same error it always did. The compiled program is byte-for-byte the
size the implementer said it would be, and the interface the website talks to
(the IDL) did not change by a single byte, which is the strongest evidence a
member's app will not notice this happened. The full regression suite (168
tests), the real cryptographic proof round-trips (23 tests), and the
program's own internal math tests (47 tests) all pass. Nothing here touches
who a sponsor is, what a message says, or how many cords are on anyone's
necklace, so none of the platform's privacy promises are at risk from this
change. While verifying, this round also ran two old test files that are
normally skipped and found they have been quietly broken for three days by an
unrelated fix — one of them so quietly that its failure never even shows up
as a failure, just a swallowed error message. That is not this round's fault
and not blocking this refactor, but it does mean nobody has actually watched a
real anonymous vote succeed end-to-end in the automated tests in a while, and
that gap should close soon. Recommend: proceed with the devnet upgrade; open a
follow-up item for the two broken vote-election test files and the
still-unresolved test-teardown hang.
