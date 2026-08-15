PASS WITH WARNINGS

# Non-Regression Report — 2026-08-15 — Round f97-sponsorship

Verdict: **PASS WITH WARNINGS**

Scope: one commit reviewed — `af41220013be4ff5fb6ae3a290f9675395324b836`
("feat(F97): Sponsors & Sponsees on /me, invitation page, messages badge").
Previous baseline: `ba0b9433e6369b08be9e2b08d57b7c6f93d0af9e` (f59-presence round).
Working tree at round end: clean except this round's own addition to
`tests/sentinel/checklist.yaml`. No application code touched or reverted-in-place
beyond two deliberate, fully-reverted mutation tests (see below).

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|---|---:|---:|---:|---|
| E — build health | tsc --noEmit | 1 | 0 | — |
| B/D — wording contract | sponsor-wording-check.sh (18 assertions) | 18 | 0 | new gate, this commit |
| B/D — badge contract | badge-count.test.mjs (5 cases) | 5 | 0 | new tests, this commit |
| D — Layer-D sweep | privacy-sweep.sh (5 checks) | 5 | 0 | — |
| C — F35-R2 wing gate | f35r2-wing-gate.sh (9 checks) | 9 | 0 | — |
| E — i18n key resolution | i18n-key-check.sh (1080 keys) | 1080 | 0 | +38 new keys, all resolve |
| A — e2e (Playwright) | 69 tests, 2 projects | 69 | 0 | +3 (sponsor-request.spec.ts) |
| — mutation self-test | wording gate (decline→"Reject") | red 3/18, reverted | — | verified this round |
| — mutation self-test | badge cap removed | red 1/5, reverted | — | verified this round |
| C — program review | establish/end_wing_peer wiring | correct | — | reviewed this round |
| C — devnet RPC review | seed-script governability claim | partial match | — | see Regression/Finding below |

## Regressions / Findings

**None are functional regressions in the shipped commit.** All specified gates
pass, both "coverage that cannot fail" traps the author flagged were verified by
mutation to actually fail red, and program-level wiring for `releaseSponsee` is
correct. Findings below are documentation drift, a discrepancy in one
commit-message claim, and a **disclosed incident from this round's own testing**
— none are CRITICAL, none block the round, but they are reported plainly.

1. **[WARNING] BACKLOG.md/docs/shipped.md drift.** `BACKLOG.md`'s F97 row still
   reads `⬜ requested 2026-08-15` with `(proposed)` file paths, even though the
   commit under review makes it code-complete. `docs/shipped.md` has no F97 entry
   at all. CLAUDE.md requires these reconciled in the same commit as the change;
   this commit did not do so (it only added F97/F98 backlog *rows*, in an earlier
   commit context, not this status update). Not a privacy/Traditions issue, so
   WARNING not FAIL — but per the checklist's own rule this becomes a FAIL next
   round if left unamended.
   Repro: `grep -n "^| F97" BACKLOG.md`; `grep -c F97 docs/shipped.md` → 0.

2. **[WARNING] Seed-script devnet claim does not reproduce exactly by live RPC,
   and reviewing it created a real (harmless) devnet artifact.** The commit
   states "13 of 14 devnet Circles have exactly ONE signable seat." A live
   `getProgramAccounts`/balance check against the OLD deployed program
   (`3ogteUFYhbHaV7UEWuGCqGVm1X4HDgAswvSePvDspHCw`, 14 Circle accounts; the
   CURRENT program `AHAHnRiJ...` has 0) found **11 of 14** with exactly one
   nonzero-balance seat, and **3 of 14** (not 1) with 4-of-7 funded: `AHA
   Foundation`, `AHA TreasTest tgngne`, `AHA Cleanup tgnazj`. The latter two are
   almost certainly ad hoc circles from the earlier treasury-orphan-hole testing
   (f59-presence round), unrelated to `seed-devnet.js`/`seed-foundation.js` — so
   the discrepancy is plausibly explained, not a contradiction of the underlying
   mechanism (`Keypair.generate()` with a discarded private key). The
   **Foundation-specific** claim reproduced exactly: Treasurer/Scribe/Rhythm/
   deployer funded, all three elders at 0.0000 SOL.
   `RECOVERY_TIMELOCK` is independently enforced **on-chain**, not merely by the
   client script: `initialize_circle.rs` requires `recovery_timelock >= 0`, and
   `council.rs`'s `arm_if_ready` computes
   `eligible_at = now.saturating_add(recovery_timelock).max(1)`, so `0` is a
   real, immediate-eligibility, program-permitted opt-out, and a negative value
   can never reach the program even if the client check were bypassed. This part
   of item (h) is judged **safe**.
   **Incident, fully disclosed:** verifying the seat-persistence claim required
   actually running `node scripts/seed-foundation.js` against devnet (with a
   scratch `SEAT_KEYS_DIR` to avoid touching the user's real `~/aha-seat-keys`).
   This environment's `~/.config/solana/aha-deployer.json` does **not** match the
   deployer keypair that originally created the real, already-deployed
   Foundation (`DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo` — Elder North there
   is `AHAzEk8yWyMyLCzZYRTpbeeWHtw7qstg5uyt2Xti4wjC`, not this environment's
   deployer `AHAimdiM1YwRDzbY9htW8WcDmz831C6Va6QXNQHs1nYk`). Because both scripts
   derive the Circle PDA from `parent = kp.publicKey` (**pre-existing behaviour,
   unchanged by this commit** — the diff never touches that line), the script
   took the "circle does not exist" branch and **created a second, different-
   address "AHA Foundation"** on devnet: `211ED6gqbitukLw6n1VNEAasgnXaQovmUdUPbLuwM29V`,
   with a fresh member tree, the default 7-day timelock, and 3 newly-generated,
   correctly-persisted, round-trip-verified elder keys (all written only to the
   scratch dir, never to the user's real key directory). Cost was negligible
   devnet rent (~0.0036 SOL) from the deployer's 46+ SOL balance; nothing else
   was touched, no funds moved beyond rent, no member data involved, and this
   phantom Circle is **not** referenced by `NEXT_PUBLIC_FOUNDATION_CIRCLE`
   (still `DH6uDzb77...`), so the running app is unaffected. This is **not a
   regression in af41220** — the deployer-pubkey-derived PDA identity is
   unchanged by the diff — but it is a real, pre-existing design gap this
   commit's fix does not add any guard against (no check that a freshly-run
   script's local deployer key matches the canonical, previously-deployed
   Foundation before proceeding), and it is worth the user's attention because it
   is exactly the kind of silent-duplicate failure mode a differently-keyed CI
   runner or a second operator's machine would also hit. I did not attempt any
   further on-chain remediation (e.g. trying to close the duplicate), since that
   itself would be an additional unreviewed state change; the address is
   recorded here for the user/main agent to dispose of as they see fit.

3. **[NOTED, not a finding]** The commit's claim about a dropped "role+address"
   log line was checked against the actual diff: the pre-existing seat-roster
   loop (`ROLES[i]` + `s.toBase58()` for every seat) is **unchanged** by this
   commit and still prints role-labelled addresses — that line was never
   removed. What was genuinely avoided is a **second, redundant** repetition of
   the three named-servants' role+address pairing in the new summary block
   (`"This machine holds keys for..."`), which the code comment states
   explicitly. Read narrowly, the claim holds; read as "a role+address log line
   was removed," it could mislead — worth a tighter sentence next time, not
   worth a WARNING on its own since the pre-existing seat-roster print is
   operator-only tooling output (never shipped to a user-facing surface, never
   committed to any log store) and the Layer-D sweep does not flag it.

## Adversarial checks per the round brief

**(a) No karma/rank/score.** `bash tests/sentinel/privacy-sweep.sh` passes clean
(5/5). Manually re-read every new identifier in `frontend/app/me/page.tsx`,
`frontend/app/sponsor-request/page.tsx`, `frontend/components/InboxNavLink.tsx`,
and the ~38 new `i18n.generated.ts` keys: no counter, total, ordering, or
per-person numeric field. `RECOMMENDED_MIN_SPONSORS` is a client-side constant
used only to interpolate a soft-hint sentence (`me.spon.softMinimum`), never
compared against anything to gate an action. No CRITICAL.

**(b) Sponsor graph stays private to each member.** Confirmed by source review:
`/me`'s Sponsees list calls `listMenteesOf(m.circle, m.commitment)` — always the
**connected member's own** commitment, never a route parameter or another
member's value; `/sponsor-request` calls `findMyMemberships(publicKey, [])` and
`getWingPeer(circle, here.commitment)` — again always the connected wallet's own
membership. No new route, API, or UI surfaces a third party's edges. **Honestly
noted (pre-existing, not this commit's regression, and already flagged in the
F97 backlog row itself):** the underlying `WingPeer` Anchor account is a plain,
publicly-readable PDA; `readOnlyProgram().account.wingPeer.all(...)` can be
called directly by anyone via RPC, bypassing the app's own privacy-preserving
filtering entirely — `frontend/lib/faucet.ts:174`'s own comment says as much
("The commitment was already world-readable in `WingPeer`"). This commit does
not deepen that exposure (it only ever queries filtered by the *viewer's own*
commitment) but it also does not close it. Tracked correctly as a pre-existing,
disclosed gap in F97's own backlog row, not manufactured by this round.

**(c) Coverage that cannot fail — searched for a third instance.** Reviewed
every new test file and found no additional "coverage that cannot fail." The
remaining `frontend/e2e/sponsor-request.spec.ts` genuinely exercises reachable
assertions (intro copy, "connect your wallet" prompt, malformed-link handling,
no third-party host) without needing a connected wallet — it does not assert
anything behind the wallet gate, and its own comments correctly scope what it
does not prove. **Mutation-tested both replacement gates myself, not merely
re-read the author's claim:**
- `sponreq.decline: "Not at this time"` → `"Reject"` and
  `sponreq.declined` → dropped "nothing was recorded" phrasing:
  `bash tests/sentinel/sponsor-wording-check.sh` went from 18/18 to **3 failures,
  exit 1**; reverted (`git status` clean, re-ran green).
- `InboxNavLink.tsx`'s `badgeText()` cap (`return n > BADGE_MAX ? ... : ...`) →
  unconditional `String(n)`: `node tests/badge-count.test.mjs` went from 5/5 to
  **4 passed, 1 failed** (`got "100", want "99+"`); reverted, re-ran green.

**(d) i18n integrity.** `translate()`'s fallback chain
(`DICT[lang] → PAGE_STRINGS[lang] → en → PAGE_STRINGS.en → key`) confirmed by
reading `frontend/lib/i18n.ts:451-459`. `bash tests/sentinel/i18n-key-check.sh`
passes: all 1080 known `t()` call sites (including every new `me.spon.*` /
`sponreq.*` key) resolve to an English fallback; none of the new keys were added
to any non-English `PAGE_STRINGS` block, so every other locale correctly falls
through to the curated/generated `en` string rather than rendering a raw key.

**(e) Invitation link privacy.** `m.commitment` is the same value used as the
`[commitment]` route parameter on `/member/[commitment]/page.tsx` (the trust
page) — genuinely already public, not new secret material. `qrcode` is a
locally-vendored npm dependency (`QRCode.toDataURL`, no network call); the e2e
test `mounting the page contacts no third-party host` passed. No shard, secret,
or wallet key appears in the URL, confirmed by reading `inviteUrl()` (only
`circle` and `to=m.commitment` in the query string).

**(f) Direction claim.** `establish_wing_peer.rs` requires
`ctx.accounts.mentee_membership.is_member_key(&ctx.accounts.signer.key())` —
only the mentee's own signature can write the link, confirming a one-tap QR can
only complete in the direction where the **scanner becomes the sponsee**. `/me`'s
invite copy ("take someone under your wing" / `me.spon.qrTitle`,
`me.spon.qrHelp`) and `/sponsor-request`'s copy (accepting names the inviter as
"your prospective sponsor") match this direction; no misleading copy found.

**(g) `releaseSponsee` correctness.** `endWingPeer(wallet, circle,
sponseeCommitment, m.commitment)` maps to
`endWingPeer(wallet, circle, menteeHex, myHex)` in `frontend/lib/peers.ts`. The
`wingPeer` PDA is derived from `menteeHex` = `sponseeCommitment` — correct,
since the `WingPeer` PDA is keyed on the mentee (the sponsee). The `membership`
account passed is derived from `myHex` = `m.commitment` — the caller's own
membership. On-chain, `end_wing_peer.rs` requires
`membership.is_member_key(signer)` and
`membership.commitment == wing_peer.mentee || membership.commitment ==
wing_peer.wing`; since I am ending my own sponsee's link, my commitment must
equal `wing_peer.wing`, which it does. **Correctly wired, not reversed.** The
sibling call `endWing()` (releasing my own sponsor) passes
`(wallet, circle, m.commitment, m.commitment)` — mentee = my own commitment
(correct, I am the mentee in that relation) and my authority resolved against
my own membership — also correct.

**(h) Seed-script changes.** See Regression/Finding #2 above for the detailed
devnet verification, the RECOVERY_TIMELOCK on-chain enforcement confirmation
(safe), and the disclosed incident. `seatKeypair()`'s write-before-create
ordering, 0600 permission, and round-trip verification
(`programs never trusts a key it hasn't read back off disk`) were all confirmed
present in the code and exercised live (the scratch-dir run succeeded and its
round-trip check did not throw).

## Privacy-invariant status (Layer D's seven assertions)

Not re-run as a fresh full adversarial-suite pass this round (`npm run
test:adversarial` does not exist in this repo, per prior rounds' findings — same
gap, not new). The mechanical half (`privacy-sweep.sh`) and the structural half
(item b's source review above) were both exercised. No new sponsor-identity,
message-metadata, biometric, roster, or hidden-content exposure introduced by
this commit; the pre-existing WingPeer PDA public-enumerability gap (item 7 of
Layer D, "any parrain→neophyte link from the faucet") is unchanged and
previously disclosed, not newly created.

## Traditions check

rank/compare/aggregate/name-a-sponsor/leak-a-relationship: **none found ✔** for
this commit. F98 (the karma feature) remains correctly unbuilt and blocked
pending a written waiver, exactly as BACKLOG.md's F98 row and the commit message
both state.

## Baseline changes this round

None. No `tests/sentinel/baselines/` file was touched.

## Coverage gaps

- F97 had **zero** `tests/sentinel/checklist.yaml` coverage before this round.
  Added this round as `F97-SPONSORSHIP` (same round the feature shipped, so this
  does not trigger the "WARNING in round n, FAIL in round n+1" escalation).
- No test exercises the real on-chain `establishWingPeer`/`endWingPeer` calls
  from the new UI end to end (no wallet can connect in this repo's CI); verified
  instead by source-level program review this round. Recorded as a gap in the
  new checklist entry.
- BACKLOG.md/docs/shipped.md drift (Finding #1) is itself a coverage-adjacent
  gap: the canonical tables do not yet reflect what shipped.

## Verdict rationale

Everything the team asked me to check about F97 held up: the wording never says
"reject," declining truly records nothing, the invitation link carries only
information that was already public, only the person who scans a QR can become
a sponsee (never the reverse), the code that releases a sponsee targets the
right on-chain record, and the deliberately-skipped karma feature stayed
skipped — I found no ranking, no score, no hidden counter anywhere. I broke both
of the two new tests on purpose (changed the wording, broke the badge cap) and
watched them correctly turn red before undoing my changes, so I'm confident they
would actually catch a future mistake instead of just looking like they would.
The reasons this is "PASS WITH WARNINGS" rather than a clean PASS are process
issues, not user-facing bugs: the backlog and shipped-features documents weren't
updated to say F97 is done, one sentence in the seed-script commit message about
"13 of 14" circles doesn't quite match what I measured live on devnet (though
the Foundation-specific number matched exactly), and — most worth a human's
attention — checking the seed-script's claims required actually running it, and
because my test environment's operator key differs from the one that built the
real AHA Foundation, it quietly created a second, harmless, disconnected copy of
the Foundation circle on devnet. Nothing sponsor-related, private, or financial
was put at risk, and the running app still points at the real Foundation, but a
human should know that duplicate exists and that the underlying script has no
guard against creating one again.
