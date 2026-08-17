# Non-Regression Report — 2026-08-17 — Round f103-hybrid-pq

Verdict: **FAIL at first run; superseded below — see ADDENDUM: PASS WITH WARNINGS**

Scope: uncommitted working tree on top of HEAD `7f77195d4469fb6c66b62b7db7d940b0ef455021`
(branch `solana`), i.e. F103 — hybrid post-quantum mailbox sealing (X25519 +
ML-KEM-768), ADR 0002 Stage 1. Files: `frontend/lib/mailboxCrypto.ts`,
`frontend/lib/mailbox.ts`, `frontend/lib/mailboxMixing.ts`,
`frontend/app/api/mailbox/route.ts`, `tests/mailbox.ts`,
`tests/sentinel/checklist.yaml`, `package.json`/`frontend/package.json` +
lockfiles, `docs/messaging-migration.md`, `docs/decisions/0002-quantum-resistance.md`,
`docs/shipped.md`, `BACKLOG.md`. `programs/` confirmed untouched
(`git diff HEAD -- programs/` is empty) — no devnet implication.
Previous baseline: `reports/sentinel/NRR-2026-08-16-nav-qr-batch.md` (PASS WITH
WARNINGS), commit `ebc18e3`.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E (build health) | tsc --noEmit (frontend) | 1 | 0 | — |
| B/C (crypto property tests) | `tests/mailbox.ts` (mocha) | 16 | 0 | +7 (F103 describe block) |
| B/C (relay-level property + e2e) | `tests/mailbox-mixing.test.mjs` | 27 | 0 | 0 (not extended for v2 — see gap below) |
| D (privacy sweep) | `tests/sentinel/privacy-sweep.sh` | 5 | 0 | — |
| Checklist F103 `checks:` (static greps) | 7 | 7 | 0 | +7 (new entry) |
| **Adversarial repro (this round, not in either suite)** | v2 envelope round-trip through the real `route.ts` `put`/`get` handlers | 0 | **1** | **CRITICAL — new** |

All committed test files pass exactly as claimed in the task brief. The
failure is a real functional bug in the shipped code that **no existing test
exercises**, found by driving `route.ts`'s actual `POST` handler (the same
`next/server`-stub harness `tests/mailbox-mixing.test.mjs` already uses) with a
genuine v2 (hybrid) envelope end to end.

## Regressions

### CRITICAL — F103 v2 mail is silently destroyed by the relay's `put` handler

- **Epic / feature:** F103 (hybrid post-quantum mailbox sealing), E7 messaging.
- **File:line:** `frontend/app/api/mailbox/route.ts:364`, inside `case "put"`:
  ```ts
  const e = body.envelope as SealedEnvelope;
  const clean: SealedEnvelope = { v: 1, eph: e.eph, nonce: e.nonce, spkEpoch: e.spkEpoch, ct: e.ct, expiresAt: e.expiresAt };
  ```
  This hardcodes `v: 1` and drops `e.kct` unconditionally, for every envelope,
  regardless of what `badEnvelope()` (line ~205) just validated. `badEnvelope`
  correctly requires a v2 envelope to carry exactly one 1088-byte `kct` and
  correctly rejects a v1 envelope that carries one — but the object that is
  actually **persisted to disk** three lines later is always relabeled `v: 1`
  with `kct` stripped, whatever the sender sent.
- **Concrete failure scenario, reproduced live:** a v2 (post-quantum) prekey
  bundle is published; a sender fetches it, calls `sealToBundle` (which
  correctly ML-KEM-encapsulates and returns `{v: 2, kct: "<1452 b64 chars>", ...}`),
  and `put`s it. The relay answers `{ok: true}`. On the very next `get` from
  the legitimate recipient — same request shape the real client
  (`fetchMailboxMessages`) issues — the envelope comes back as `{v: 1}` with no
  `kct` field. `openSealed()` (correctly, per its own contract) takes the `v:1`
  branch, calls `nacl.box.open` against a ciphertext that was actually produced
  by `nacl.secretbox` under the hybrid key, and returns `null`. In
  `frontend/lib/mailbox.ts`'s `fetchMailboxMessages`, a `null` open result is
  silently treated as *"sealed to a prekey this device no longer holds"*
  (`if (!inner) continue;`) and the message is dropped with **no error, no log,
  no user-visible signal of any kind**. The mail is gone for the recipient;
  it sits as undecryptable litter on the relay until the 30-day TTL sweep.
- **Reproduction command** (self-contained, does not require the dev server —
  loads `route.ts` through the same `next/server` stub the existing
  `tests/mailbox-mixing.test.mjs` uses; full script left at
  `/tmp/claude-1000/-home-alkia-Ayni/d86dbd26-cd9f-4ac2-a888-6c46d6fa2a90/scratchpad/repro-v2-relay-bug.mjs`,
  reproducible on request):
  ```
  node <repro-script>.mjs
  # publish v2 bundle: 200 {ok:true}
  # sealed envelope v = 2 has kct: string 1452
  # put v2 envelope: 200 {ok:true}
  # STORED ON DISK: {"v":1,"releaseAt":...,"env":{"v":1,...no kct...}}
  # get result: 200 {"messages":[{...,"envelope":{"v":1,...no kct...}}]}
  # returned envelope v = 1 kct present: false
  # openSealed() result: null
  # *** BUG CONFIRMED: the message is UNREADABLE — silently lost by the relay. ***
  ```
- **Why no existing test caught it:** `tests/mailbox.ts`'s new F103 describe
  block (7 properties) tests `mailboxCrypto.ts` in isolation — `sealToBundle` /
  `openSealed` directly — and never calls `route.ts`. `tests/mailbox-mixing.test.mjs`
  §8 *does* exercise the real `route.ts` `POST` handler end to end (publish →
  put → get → open → ack), which is exactly the right shape of test — but every
  fixture in that section (`myBundle`, `realTo`, `coverTo`) is hardcoded `v: 1`.
  The F103 round added zero lines to that file, so the one test harness capable
  of catching this bug was never pointed at a v2 envelope. The checklist's new
  `F103` entry (`tests/sentinel/checklist.yaml`) also has no `cases:` or gate
  that drives the relay itself — its `checks:` are seven static greps and its
  `cases:` describe crypto-layer properties only, unlike the sibling `F63v2`
  entry immediately below it, which *does* have relay e2e coverage.
- **First bad commit:** not yet committed (working tree). No bisect needed —
  the bug is present in every version of the diff seen this round; it did not
  exist before this round (`route.ts`'s `put` handler had no `v`/`kct` fields
  to mishandle pre-F103).
- **Severity rationale:** this is not a privacy leak, it is total, silent
  delivery failure of the feature this round claims to ship. Given
  `publishMailboxBundle`'s forced-rotation rule (`!spks[0].pqSec` triggers an
  immediate rotation to hybrid), essentially every member who touches
  enrollment after this round ships starts publishing v2 bundles — meaning
  most *new* off-chain mail sent after this deploy would be silently
  undeliverable, a regression far more severe than the feature it was meant to
  extend (F63/F63v2, plain x25519 mail, is unaffected — see below).
- **Secondary consequence (same bug, cover traffic):** `buildCoverEnvelope`
  correctly mirrors a v2 peer's bundle version, so a dummy `put` to a hybrid
  peer is also corrupted by the same code. Recipient-side, `openSealed` returns
  `null` for that row too; `partitionCover` requires a **non-null**, cover-
  marked inner envelope to recognise it as cover (`isCoverInner(null)` is
  `false`), so the corrupted dummy is neither delivered as mail (correct) nor
  swept as cover (incorrect) — it accumulates as permanent litter in the
  recipient's box until TTL, quietly eating into `MAX_PER_BOX` (500) and the
  `maxOutstandingCover` (16) budget for hybrid users. Not a privacy leak, but a
  second, compounding functional defect from the same line.

### Not a regression, but confirm-and-note: F63/F63v2 (v1) unaffected

`tests/mailbox-mixing.test.mjs`'s existing 27/27 (all v1 fixtures) still pass
unchanged — the `clean` object's hardcoded `v: 1` happens to be a correct
no-op for genuine v1 envelopes, which is exactly why the bug is invisible to
every test that ran this round. Plain (non-hybrid) mailbox delivery is not
regressed.

## Privacy-invariant status (Layer D's seven assertions)

Not independently re-run against a full adversarial dump this round (out of
scope: F103 is frontend/tests/docs only, touches no on-chain state, and no
sponsor/message-content/roster model changed). Spot-checked the parts F103
actually touches:

1. Sponsor identity / sponsor→member edge — unaffected, F103 touches no
   sponsorship code. ✔ (unaffected)
2. Trust/chosen-ones list — unaffected. ✔ (unaffected)
3. Message content / who-messaged-whom metadata — **no new leak found**: the
   corrupted-storage bug destroys messages, it does not expose them; the relay
   still cannot open v2 ciphertext (it never had a key to). `kct` is bounded
   and validated before persistence in `publish` (pqk length-checked pre-sig)
   and in `put` (`badEnvelope` bounds `kct` to exactly `MLKEM_CT_LEN` before
   the corrupted `clean` object is built) — no amplification/oversized-storage
   vector. ✔
4. Biometric material — untouched. ✔ (unaffected)
5. Circle roster — untouched. ✔ (unaffected)
6. Hidden-content roster — untouched. ✔ (unaffected)
7. Faucet parrain→neophyte unlinkability — untouched. ✔ (unaffected)

No new forbidden identifier, telemetry, or console.log of identity material
introduced (`tests/sentinel/privacy-sweep.sh` 5/5; manual grep of the diff for
`fetch(`/`XMLHttpRequest`/`sendBeacon`/analytics — none found, matching the
static test in `tests/mailbox.ts` that already asserts `mailboxCrypto.ts` has
no network sink).

## Traditions check

No ranking, comparison, sponsor-naming, or relationship-leaking surface in this
diff. karma (F98/F100, waived) untouched. None found ✔.

## Crypto scrutiny (the point of the round) — results

- **Downgrade resistance, bundle side:** confirmed by reading + the test suite.
  A v2 bundle relabeled v1 fails (`spkSignedBytesV2` bytes ≠ `spkSignedBytes`
  bytes → signature mismatch, `mailboxCrypto.ts:112-114`, `verifyBundle`). A v1
  bundle carrying a smuggled `pqk` is refused outright
  (`mailboxCrypto.ts:107-108`, checked before signature verification). The
  relay's `publish` path bounds `pqk`'s length before calling `verifyBundle`
  (`route.ts` ~line 254), so a garbage/oversized field cannot reach the
  signature check as an amplification vector, and `verifyBundle` itself is the
  only gate that persists a v2 bundle — a pqk the signature does not cover is
  never written (`route.ts` `clean` object in `publish`, correctly conditional
  on `b.v === 2`, unlike the `put` bug above). **This path is correct.**
- **Downgrade resistance, envelope side:** relabeling a captured v2 envelope as
  v1 (dropping `kct`) and handing it to `openSealed` takes the v1 branch
  (`nacl.box.open` against a `nacl.secretbox` ciphertext) — this fails
  authentication with overwhelming probability and returns `null`, never
  garbage. Confirmed both by code reading and by the passing test
  `"tampering with the KEM ciphertext or transcript yields null, never
  garbage"` (`v2→v1 envelope downgrade` case, `tests/mailbox.ts`). **Correct at
  the crypto-module level** — the CRITICAL above is a relay/storage bug, not a
  cryptographic weakness in `mailboxCrypto.ts`.
- **Hybrid soundness:** `hybridKey` (`mailboxCrypto.ts:196-206`) hashes
  `domain tag ‖ xShared ‖ kemShared ‖ ephPub ‖ kemCt ‖ spk ‖ pqk` — both shared
  secrets and the full public transcript are bound, so a mix-and-match of parts
  from two envelopes cannot yield a valid key (confirmed by the passing
  cross-envelope-`kct` test). ML-KEM's implicit rejection (bad `kct` →
  pseudorandom `sharedSecret` → wrong key → `secretbox.open` MAC failure →
  `null`) means there is no decapsulation oracle; confirmed by the "wrong KEM
  secret opens nothing" / "wrong x25519 secret opens nothing" tests, both of
  which correctly return `null` rather than a distinguishable error type.
- **No version oracle at the relay (traffic-shape level):** `rememberCoverPeer`
  (`mailbox.ts:167-176`) and `selfCoverTarget` (`mailbox.ts:179-190`) both
  thread `pqk`, and `buildCoverEnvelope` (`mailboxMixing.ts:186-195`) mirrors
  the target's bundle version — correct, and independently confirmed by the
  static gate `grep -q "pqkB64" frontend/lib/mailboxMixing.ts`. **However**: the
  request-block-size honesty question the task asked about is real and
  **undisclosed**. `MBX_REQ_BLOCK` moved 2048→4096
  (`mailboxMixing.ts:84`, comment: *"Uniform for every op, so the property
  'all ops are one size' survives the upgrade"*) and
  `docs/messaging-migration.md`'s F103 paragraph says pads *"grew uniformly (2
  KiB → 4 KiB blocks)"* — true post-rollout, but during a rolling deploy a
  browser tab still running the previous JS bundle pads to the *old* 2048
  constant while the relay (already upgraded) and new tabs pad to 4096, which
  **is** a client-version distinguisher on the wire for as long as the rollout
  window lasts. Neither `docs/messaging-migration.md` nor `docs/messaging.md`
  §5 (the residuals section) discloses this transitional skew.
  **WARNING**, not CRITICAL, per the task's own framing — it is a temporary,
  deploy-window residual, not a standing design flaw, but the docs currently
  read as if the uniformity is unconditional. Should be added to
  `docs/messaging.md` §5's residuals list.
- **Secret hygiene:** `saveSpks` (`mailbox.ts:103-106`) slices the whole
  `StoredSpk` array (which carries `pqPub`/`pqSec` inline on the same record as
  `sec`/`pub`) to `SPK_KEEP=2`; deleting an epoch deletes both halves together
  by construction — confirmed by reading, no separate delete path exists to
  drift. No new network sink in `mailboxCrypto.ts` — confirmed by the passing
  static test (`"the crypto module has no network sink"`).
- **Relay storage bounds:** `badEnvelope` (`route.ts`) bounds `kct` to exactly
  `MLKEM_CT_LEN` (1088 bytes) before persistence would occur, and `publish`
  bounds `pqk` before `verifyBundle`. `MBX_REQ_MAX_PAD` (8192) still bounds the
  padded request body containing a v2 envelope (a v2 put's real padded body is
  4096 — one block — well under the 8192 cap). These bounds are correctly
  enforced *before* the CRITICAL bug's `clean` object is built, so the bug is
  pure data loss, not a storage-amplification or injection vector.

## Baseline changes this round

None. No `tests/sentinel/baselines/` file was touched by this diff.

## Coverage gaps (must shrink each round)

1. **New, and the direct cause of the CRITICAL above:** no test drives a v2
   (hybrid) envelope through the real `frontend/app/api/mailbox/route.ts`
   `POST` handler end to end. `tests/mailbox-mixing.test.mjs` §8 has exactly
   the right harness (`next/server` stub, real `route.ts` load) and needs only
   a second fixture (a `v:2` bundle + `sealToBundle` to it) exercised through
   `publish` → `put` → `get` → `openSealed` → `ack`, mirroring its existing v1
   relay-e2e block. This is the coverage that would have caught today's
   finding before it shipped.
2. `tests/sentinel/checklist.yaml`'s new `F103` entry has no relay/e2e gate and
   no `uncovered:` section (unlike its sibling `F63v2` entry immediately below
   it, which names its gaps explicitly) — the missing v2-relay coverage above
   was not even disclosed as a known gap.
3. Carried forward, unrelated to this round: `docs/shipped.md`'s route table
   (§4) has not been reconciled since F93/F94 (pre-existing, noted in the doc
   itself); F63v2's "no adversarial/statistical traffic-analysis suite" gap
   (pre-existing); the pre-existing `tests/sentinel/checklist.yaml` YAML-parse
   issue (`yaml.safe_load` fails at the same relative offset before and after
   this diff — not introduced by F103, not investigated further this round).

## Verdict rationale

This round's own tests all pass, and the cryptography itself — the hybrid key
construction, the downgrade-resistant signatures, the implicit-rejection
handling — is sound and matches the claims in the ADR and the docs. But the
feature does not work: a one-line bug in the mailbox relay throws away the one
new field (`kct`) that hybrid post-quantum mail depends on, the moment a
message is stored. Every hybrid-sealed message a member sends after this round
ships would silently vanish before its recipient ever sees it — not corrupted
visibly, not bounced with an error, just gone, with the client's own code
misinterpreting the failure as an old, already-rotated key. No test in the
diff would have caught this because the one test file capable of catching it
(which really does load and call the real relay code) was never given a
hybrid message to carry. This is a plain functional break of the exact feature
this round claims to ship, and it fails the round regardless of the otherwise
correct cryptography around it. The fix is a one-line change to
`frontend/app/api/mailbox/route.ts`'s `put` handler (preserve `v` and `kct`
from the validated envelope instead of hardcoding `v: 1`), plus a v2 fixture
added to `tests/mailbox-mixing.test.mjs`'s relay-e2e section so this exact
failure mode cannot silently return.

---

## ADDENDUM (2026-08-17, same day) — re-verification of the fix; superseding verdict

**Superseding verdict: PASS WITH WARNINGS** (was: FAIL)

Re-run at commit `df8741e0fe45f6c9385fdae90b792519638d43f9` (branch `solana`,
pushed, working tree clean). This addendum documents an independent
re-verification — nothing below is taken on the fix commit's own say-so.

### What was independently re-checked (not just re-read)

1. **The fix itself** (`frontend/app/api/mailbox/route.ts:364-374`, commit
   `35f5641`): `case "put"`'s field-allowlist now branches on `e.v === 2` and
   preserves `kct`; the `v:1` branch is byte-identical to before. Read against
   `badEnvelope`'s existing validation (unchanged) — the fix does not weaken
   any bound, it only stops discarding fields `badEnvelope` already validated.
2. **Full battery re-run by this session:** `npx ts-mocha tests/mailbox.ts` →
   **16/16**; `node tests/mailbox-mixing.test.mjs` → **28/28** (the new case,
   *"relay e2e: a HYBRID (v2) envelope survives the relay intact"*, included);
   `cd frontend && npx tsc --noEmit` → clean.
3. **Red/green independently reproduced, not trusted from the commit message.**
   This session copied the pre-fix `route.ts` from `7f77195` over the working
   file, leaving every other file (including the new test) at HEAD, and re-ran
   `tests/mailbox-mixing.test.mjs`:
   ```
   FAIL  relay e2e: a HYBRID (v2) envelope survives the relay intact —
         kct is not dropped, v is not relabeled — the relay relabeled a
         v2 envelope (got 1, want 2)
   1 test(s) FAILED.
   ```
   The fixed file was then restored (`git diff` on the file returned empty —
   byte-identical to HEAD) and the suite re-run: **28/28**, the new case
   included. This confirms the "red-proven" claim in commit `35f5641` and in
   `reports/sentinel/OVERRIDES.md`'s entry for it, independently rather than
   by trusting the message.
4. **The original repro script re-run against the fixed code** (same script
   left at `/tmp/claude-1000/-home-alkia-Ayni/d86dbd26-cd9f-4ac2-a888-6c46d6fa2a90/scratchpad/repro-v2-relay-bug.mjs`,
   unmodified): stored envelope is now `{"v":2,...,"kct":"<1452 chars>",...}`;
   `get` returns it unchanged; `openSealed()` now returns the full inner
   envelope (`from`, `ts`, `body: "hello from the post-quantum future"`,
   `sig`) instead of `null`. **The mail survives.**
5. **The WARNING's closure, read at source:** `docs/messaging-migration.md`
   §F103 now reads *"'uniform' holds per client build — during a rolling
   deploy a stale cached client still pads to the old 2 KiB block, so the
   relay can tell old-build from new-build requests until caches turn
   over... it is the unavoidable cost of any wire-format change"* — this
   states the residual plainly, matches what this round found, and does not
   claim the skew is mitigated (it isn't, and doesn't need to be — it is a
   deploy-window property, not a design flaw). Closed.
6. **The checklist gap's closure, read at source:**
   `tests/sentinel/checklist.yaml`'s `F103` entry gained
   `- cmd: node tests/mailbox-mixing.test.mjs` and a grep for the new case
   name as `checks:`, a `cases:` line naming the relay round-trip regression,
   and an `uncovered:` section (previously absent) naming the two remaining
   gaps honestly (no browser-level Playwright hybrid send; the transitional
   padding skew disclosed-not-mitigated). Closed as claimed.
7. **Privacy/traditions:** unchanged from the original round's findings —
   `tests/sentinel/privacy-sweep.sh` re-run, 5/5. The fix touches only which
   fields are preserved on an already-validated, already-length-bounded
   envelope; it introduces no new storage-amplification or content-exposure
   vector (confirmed by re-reading `badEnvelope`, unchanged, still bounds
   `kct` to exactly `MLKEM_CT_LEN` before either code path runs).

### Not independently re-verified this addendum (scope note, not a finding)

- **Live container serving the fix, HTTP 200** — the coordinator's message
  states this; this session has no known deployment URL in scope to curl
  independently and did not chase one down. Recorded as *reported, not
  independently confirmed* rather than silently treated as verified.
- **Browser-level (Playwright) hybrid send/receive between two real wallet
  sessions** — does not exist yet, honestly named in the checklist's new
  `uncovered:` section. Same gap class F63v2 already carries; not a new
  omission introduced by this fix.

### Review of the two OVERRIDES.md entries added this session

Both entries (`46a83c3`, for `7f77195`+`ebc18e3`; `df8741e`, for `35f5641`)
were read in full. Nothing dishonest found:

- The `7f77195, ebc18e3` entry accurately scopes what was locally verified
  before that push (16/16, 27/27 — the **pre-F103v2-relay-fixture** count,
  correct for what existed then — tsc clean, 7/7 checklist gates) and, notably,
  **does not claim** the relay round-trip was verified for v2 — which matches
  reality (it wasn't, that's the CRITICAL). It states plainly that "the round's
  independent verification... had no second pair of eyes reported yet." No
  overclaim found.
- The `35f5641` entry's claim that the regression test "fails on the pre-fix
  code and passes on the fix, run in this session both ways" is now
  **independently confirmed** by this addendum (§3 above), not merely taken on
  trust.
- Both entries correctly invoke the 2026-08-12 accepted-risk waiver for
  attribution and correctly scope what was/was not reviewed at push time. No
  finding.

**Process observation (not a technical regression, not blocking PASS given the
standing waiver):** this is the second time in one round that code was pushed
and deployed to the live container ahead of a Sentinel verdict on the same
working tree (`7f77195`/`ebc18e3` before the first verdict; the live container
rebuilt again after `35f5641` before this addendum). CLAUDE.md's accepted-risk
waiver explicitly covers pushing ahead of a verdict and fixing forward — this
is exactly that pattern, twice, and both times correctly logged in
`OVERRIDES.md` before Sentinel was asked to re-look. Naming it here because the
pattern is worth the user's attention even though no rule was broken: a round
that finds a CRITICAL after the code is already live is real user-facing
exposure for the gap between deploy and fix, however short. Not a finding
against this round.

### Updated summary table (this addendum)

| Layer | Tests | Pass | Fail |
|-------|------:|-----:|-----:|
| E (build health) | tsc --noEmit (frontend) | 1 | 0 |
| B/C | `tests/mailbox.ts` | 16 | 0 |
| B/C | `tests/mailbox-mixing.test.mjs` | 28 | 0 |
| D (privacy sweep) | `tests/sentinel/privacy-sweep.sh` | 5 | 0 |
| Checklist F103 `checks:` | 9 | 9 | 0 |
| Red/green independent re-proof of the new regression case | 2 (red + green) | 2 | 0 |

### Updated regressions list

The CRITICAL from the original round (`route.ts:364`, v2 envelopes silently
destroyed) is **RESOLVED**, independently confirmed. No new regression found
in the fix. The WARNING (transitional padding-size distinguisher undisclosed)
is **RESOLVED** (now disclosed). No CRITICAL remains open.

### Updated coverage gaps

1. Browser-level (Playwright) e2e of an actual hybrid send between two real
   wallet sessions — still absent, honestly disclosed in the checklist's
   `uncovered:` section. Carried forward.
2. The transitional padding-size distinguisher during a rolling deploy —
   disclosed, not mitigated (by design; it is a deploy-window property). Not
   expected to shrink; it is not a standing gap so much as an accepted,
   temporary, self-closing residual — but flagged again here so it does not
   quietly stop being named in a future round.
3. Everything else carried forward unchanged from the original round (docs
   route-table reconciliation; F63v2's traffic-analysis statistical suite gap;
   the pre-existing `checklist.yaml` YAML-parse issue) — none introduced or
   worsened by this fix.

### REVIEWED.md updates

Per `reports/sentinel/REVIEWED.md`'s own stated convention (top of that file):
*"Commits touching nothing but Sentinel's own bookkeeping
(`reports/sentinel/**`, `tests/sentinel/checklist.yaml`) are exempt"* from
needing an entry, because such a commit cannot cite its own SHA. Checked all
five commits named by the coordinator against that rule:

- **`7f77195`** (the F103 feature) and **`35f5641`** (the fix) touch real
  application code — entries added below.
- **`ebc18e3`**, **`46a83c3`**, **`df8741e`** touch *only*
  `reports/sentinel/**` (two are pure `OVERRIDES.md` additions; `ebc18e3` is a
  prior round's own report + `REVIEWED.md` + `latest.md` bookkeeping commit) —
  **exempt under the file's own rule**, so no entry was added for these three.
  Noting this as a deviation from the coordinator's literal request rather
  than silently complying: adding spurious entries for bookkeeping-only
  commits would contradict the registry's stated purpose (it exists so a
  commit cannot launder itself via a prose mention; a bookkeeping-only commit
  has no code to review in the first place) and would set a precedent of
  entries for commits that, by the file's own definition, need none. If the
  intent was specifically to have the push-gate *see* these SHAs mentioned
  somewhere under `reports/sentinel/`, they already are — in this addendum,
  in the OVERRIDES.md entries themselves, and in `df8741e`'s own commit
  message — which is what the exemption rule anticipates.

REVIEWED.md entries appended for the two substantive commits:

```
- 7f77195d4469fb6c66b62b7db7d940b0ef455021 feat(F103): hybrid post-quantum mailbox sealing — X25519 + ML-KEM-768 (ADR 0002 Stage 1)
  Covered by NRR-2026-08-17-f103-hybrid-pq.md, original round: FAIL (one
  CRITICAL — route.ts's put handler hardcoded v:1 and dropped kct, silently
  destroying every hybrid envelope; found by driving the real relay handler,
  not the crypto-only unit tests). The crypto layer itself (mailboxCrypto.ts)
  was independently sound at this commit: downgrade-resistant signatures
  (spkSignedBytesV2 covers spk+pqk together), hybrid key binding both shared
  secrets + full transcript, ML-KEM implicit rejection confirmed to yield
  null never garbage, no network sink, no forbidden identifier. 16/16
  tests/mailbox.ts, 27/27 tests/mailbox-mixing.test.mjs (all v1 fixtures —
  the gap that let the CRITICAL ship), tsc clean, lockfile diff clean (one
  MIT dependency, @noble/post-quantum, matching the ADR's audited-library
  rule). Superseded by the 35f5641 entry below.

- 35f564122793e4d44eb7fd90c4e6f370d48ecf1a fix(F103 CRITICAL): the relay preserved v1 shape only — hybrid mail was silently destroyed
  Covered by the addendum to NRR-2026-08-17-f103-hybrid-pq.md
  (superseding verdict: PASS WITH WARNINGS). Independently re-verified in
  that session, not taken on the commit's own claims: reverted route.ts to
  the pre-fix (7f77195) version with every other file at HEAD and confirmed
  the new relay-e2e test (tests/mailbox-mixing.test.mjs) fails with "the
  relay relabeled a v2 envelope (got 1, want 2)"; restored the fixed file
  (git diff empty against HEAD) and confirmed 28/28 green. Re-ran the
  original repro script against the fixed code: a v2 envelope now survives
  put→get with kct intact and openSealed() returns the real message instead
  of null. tsc clean. docs/messaging-migration.md's transitional
  padding-skew disclosure and tests/sentinel/checklist.yaml's new gate +
  uncovered: section both read and confirmed present and accurate. The two
  OVERRIDES.md entries this round's push relied on (46a83c3, df8741e) were
  reviewed for honesty — no overclaim found in either.
```
