# Non-Regression Report — 2026-08-12 — Round f60-f61-usability-reround

**Verdict: PASS WITH WARNINGS**

Scope: re-round of `reports/sentinel/NRR-2026-08-12-f60-f61-usability.md` (FAIL).
Same working-tree diff on top of HEAD `2c49722` (branch `solana`, in sync with
`origin/solana`), now including the previously-stashed `programs/` change
(`git stash pop` since applied — `git stash list` is empty). Files in scope:
`programs/ayni/src/instructions/{set_visibility,create_post,tie_quipu_cord,
establish_wing_peer,attest_admission}.rs`, `frontend/app/{api/relay/route.ts,
board/page.tsx,create/page.tsx,me/page.tsx,recovery/page.tsx,
recovery/setup/page.tsx}`, `frontend/lib/{admission,ayni.json,peers,posts,
relayPolicy,relayer,visibility,visibilityCrypto,daily-reflections-default}.ts`,
new `frontend/lib/{masterSecret,shielded}.ts`, `tests/{epic1,epic3,epic5,
faucet,relayer}.ts`, `tests/sentinel/checklist.yaml`, `BACKLOG.md`,
`docs/{shipped,visibility}.md`, `daily_reflexions/daily_reflexions.xlsx`
(unrelated F82 data-only change, checked separately for privacy inertness).
Previous baseline: `reports/sentinel/NRR-2026-08-12-f60-f61-usability.md` (FAIL,
headline finding below).

## Headline finding — RESOLVED, verified independently

The previous round's CRITICAL — "the five instructions still have the member
as their own rent-payer; the matching Rust change sits unapplied in
`git stash@{0}`" — is fixed and the fix is genuine, not merely claimed:

- `git stash list` is empty; `git show 5a0b5f6` no longer exists as a dangling
  stash reference; the separate-`payer` structs are now in the working tree at
  the five file locations the previous report cited.
- Read all five `#[derive(Accounts)]` structs in full. Each now has
  `payer = payer`, a `#[account(mut)] pub payer: Signer<'info>` distinct from
  the authority (`member` / `author` / `sponsor` / `signer` / `parrain`), and
  the authority signer's own `require!(...is_member_key...)` /
  `membership.owner == ...` check is unchanged and still present.
- `anchor build` — clean (only pre-existing `AccountInfo::realloc` deprecation
  warnings, unrelated).
- `frontend/lib/ayni.json` (committed) is **byte-identical** to a freshly
  rebuilt `target/idl/ayni.json` (`diff` — no output). The IDL now genuinely
  reflects the committed Rust source, closing the previous round's secondary
  finding ("a committed artifact that silently asserts a shape the source does
  not produce").
- Started a **fresh** local validator (after `pkill -f solana-test-validator`
  and confirming `free -m` had headroom — this box has ~3.8 GB RAM) and ran
  `anchor test`, which runs the full glob from `Anchor.toml`'s `[scripts]
  test` (18 files, includes `tests/{ayni,resilience,cosign,faucet,epic1,epic3,
  epic5,profile,federation,audit-fixes,epic2,relayer,mailbox,jazzicon,sharding,
  quipu,maci-machine,maci}.ts`):

  **160 passing, 0 failing, in ~3 minutes.** No `fetch failed` / OOM symptoms
  this run (memory was freed before starting; `free -m` showed ~2.1 GB
  available beforehand).

  Confirmed by name in the log that the exact tests the previous round listed
  as failing now pass:
  - `epic5.ts`: `lets the member set their per-element visibility` ✔,
    `refuses anyone but the member to set their visibility` ✔,
    `a shielded member still sets their own visibility — derived key signs,
    someone else pays` ✔, `a shielded member still posts, and the post names
    no wallet` ✔, `a shielded member is still a usable sponsor: wing, cord,
    and admission attestation` ✔, `refuses a shielded member's write signed by
    the wallet they shielded away from` ✔.
  - `epic1.ts` (Epic 1, previously regressed): `before` hook now completes;
    `parrain attests; newcomer enters provisionally` ✔, `distinct persons`
    ✔, `confirm accepts a null parrainMembership only for an anonymous
    attestation` ✔ — all downstream cases that previously cascaded from the
    `InvalidProgramId` failure now pass.
  - `epic3.ts` (Epic 3, previously regressed): `before all` hook no longer
    throws; `lets the sponsor tie a cord for a completed step` ✔, `refuses
    anyone but the member's wing (the sponsor) to tie` ✔.
  - `faucet.ts` (Epic 0, board-posting adjacent via wing-peer fixtures):
    all 24 cases pass, including `pays the neophyte exactly one uniform
    grant, triggered by their parrain` and the wing-peer/cord fixtures the
    faucet suite depends on.
  - `relayer.ts`: 12/12, unchanged from the previous round (this suite never
    touched a validator, so it was never evidence either way — now it is
    additionally corroborated by the on-chain suites passing too).

Reproduction commands (unchanged from the previous report, for the record):
```
pkill -f solana-test-validator
anchor build
anchor test   # runs the full 18-file [scripts] test glob from Anchor.toml
```

**Conclusion: the fix is real and complete.** Every previously-shipped feature
this round had regressed (board posting, admission, quipu, wing peers) is
green again, and the new F61-R2 shielded-write paths this round set out to
ship now work end to end against the actual deployed program shape.

## Authorisation-weakening audit (payer ≠ authority)

Read all five instructions' account structs and handler bodies in full
(`programs/ayni/src/instructions/{set_visibility,create_post,tie_quipu_cord,
establish_wing_peer,attest_admission}.rs`). For every one:

- The authority account (`member` / `author` / `sponsor` / `signer` /
  `parrain`) is a separate `Signer<'info>` from `payer`, and the handler's
  authorisation check runs against the **authority**, never the payer:
  `set_visibility.rs:22` `member_membership.is_member_key(&ctx.accounts.member.key())`;
  `create_post.rs:32` `membership.owner == ctx.accounts.author.key()`;
  `tie_quipu_cord.rs:26` `sponsor_membership.is_member_key(&ctx.accounts.sponsor.key())`
  plus the `wing_peer.wing == sponsor` check; `establish_wing_peer.rs:10`
  `mentee_membership.is_member_key(&ctx.accounts.signer.key())`;
  `attest_admission.rs:23` `parrain_membership.is_member_key(&ctx.accounts.parrain.key())`.
- Confirmed in the IDL (`frontend/lib/ayni.json`, cross-checked with a small
  script) that **both** the authority slot and the payer slot are
  independently marked `signer: true` for all five instructions. This means
  the Solana runtime itself refuses any transaction where the payer signs but
  the true authority does not — "missing required signature" is enforced
  before the program's business logic ever runs; there is no code path by
  which a payer's signature could be mistaken for or substituted for the
  authority's.
- `tests/relayer.ts` independently pins the same property at the relay-policy
  layer: `"every co-signed entry pins a signer index the IDL agrees is a
  signer"` and `authority !== payerIndex` for all five, plus `"refuses the
  relayer as the authority"` and `"refuses a co-signed request with the
  authority slot unsigned"`.

**Verdict: no weakening found.** Splitting authority from rent-payer did not
let the payer stand in for the authority, anywhere.

**Coverage gap (worth naming, not a security finding):** no on-chain test in
`tests/epic1.ts`, `tests/epic3.ts`, or `tests/epic5.ts` constructs a raw
transaction where the payer signs and the true authority is *absent from the
signer set entirely* (as opposed to the existing tests, which cover a *wrong*
key occupying the authority slot and signing — e.g. `epic5.ts`'s "refuses
anyone but the member to set their visibility" and "refuses a shielded
member's write signed by the wallet they shielded away from"). The underlying
protection is a fundamental Anchor/Solana guarantee (both accounts are
independently typed `Signer<'info>`), not application logic, so this is a low
residual risk — but an explicit test of "payer-only, authority slot present as
a pubkey but not signed" would close the gap completely and should be added
alongside the next touch of these five instructions.

## Locked-position re-check (CLAUDE.md)

- **Master secret as credential of record** (`frontend/lib/masterSecret.ts`,
  read in full): one fixed keystore blob name (`"master"`), sealed via
  `lib/keystore.ts`'s `unlock()`; no `list`/`keys`/`count` operation exists on
  the keystore or this module; `getOrCreateMaster()`/`adoptMaster()` never
  invent a second identity per device. Matches the locked position exactly.
- **Recovery emits nothing on chain**: `adoptMaster()` (called from
  `recovery/page.tsx:733`) only calls `cacheView()` (a local derivation) and
  `ks.seal()` (local keystore write) — no `Connection`, no `sendTransaction`,
  no import of `@solana/web3.js`'s network primitives anywhere in
  `masterSecret.ts`. The on-chain suite's own dedicated test,
  `"the recovery + custody + sharding modules contain NO network sink"`, and
  `"any TWO of three shards reconstruct the master exactly"` /
  `"member-present fast path requires a genuine member shard"` /
  `"sponsor-only recovery waits out the 7-day window and honours
  cancellation"` / `"provisional members (one sponsor) have no sponsor
  recovery"` all pass in this run's 160/160.
- **No shard on any server / no network code path**: grepped
  `frontend/lib/{shardCustody,shardSeal,shardHandover}.ts` for
  `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`axios`/`http.`/`https.` —
  zero hits beyond each file's own header comment asserting the absence. The
  on-chain suite's `"ShardCustody exposes no enumeration path (static)"` and
  `"a corrupted or truncated handover payload fails LOUDLY"` both pass.
- **Provisional members have no sponsor recovery**: covered and passing
  (`"provisional members (one sponsor) have no sponsor recovery"`), unchanged
  by this round's diff.
- **`frontend/lib/shielded.ts` does not re-group what shielding un-grouped**:
  read in full. `memberAuthority()` only ever *derives* candidate keys from a
  cached viewing secret and compares them locally to the on-chain `owner` —
  it never queries or indexes anything, so it introduces no new correlation
  surface. `sendMemberTx()`'s fallback path (no relayer configured) does put
  the member's wallet and the derived key in one transaction — but this is the
  **pre-existing, honestly disclosed** limitation ("only a relayer makes
  shielding fully private"), stated in `shieldingIsFullyPrivate()` and in the
  Shield UI, not a new leak introduced silently.
- **Relay route does not learn or log member-linkable data**: `grep -n
  "console\." frontend/app/api/relay/route.ts` — zero hits. The new F61
  co-signed path (`route.ts:199-241`) only ever receives a base64 signature, a
  pubkey, and a blockhash window for the authority slot; `tx.serialize()`
  (which defaults to verifying all signatures) runs before
  `sendRawTransaction`, so a forged co-signature is rejected locally and never
  reaches the network — matches the code comment's claim and the previous
  round's independent verification of the same property.

## Reflections data path (F82, unrelated feature shipped this round)

`frontend/lib/daily-reflections-default.ts` (7,720 lines, generated, no
hand-editing) exports one `Record<string, DefaultReflection>` keyed `"MM-DD"`.
No imports beyond its own type; no `fetch`/`console`/network call anywhere in
the file. Its only consumer, `frontend/lib/reflections.ts`, looks the entry up
by date/language key alone — no wallet, member, or circle identifier ever
touches this path. `daily_reflexions/daily_reflexions.xlsx` is the source
spreadsheet the generator reads from; a binary diff only, not reviewed
byte-for-byte, but it is not shipped to the client (only the generated `.ts`
is). **Confirmed inert on privacy.**

## Docs/checklist reconciliation

- `docs/shipped.md` and `BACKLOG.md` both gained an honest "F61-R2" entry this
  round (diffed and read in full) describing exactly what shipped, what
  remains open, and — notably — a **pre-existing, non-regressing defect found
  while auditing this round**: `MemberProfile.enc_pub` is derived as
  `SHA-256("aha-vis-enc-v1" ‖ viewing_secret)` with **no Circle in the input**
  (confirmed by reading `frontend/lib/visibilityCrypto.ts:216` — unlike
  `ownerTagFor`/`shieldedKey`/`elementKey`/`dropIdFor`, which all mix in
  `circle.toBuffer()`, `encKey()` does not). A member who publishes a profile
  in two Circles writes identical 32 bytes in both — a memcmp handle that
  regroups exactly the memberships `shield_membership` stopped grouping. This
  is disclosed, not concealed: it appears in `docs/shipped.md`,
  `docs/visibility.md` §4, and `tests/sentinel/checklist.yaml`'s new
  `F61-R2.known_open_not_regressions`. Not fixed this round (the fix strands
  every published profile/drop and needs a migration round) — flagging it here
  as a **WARNING**, not a CRITICAL, because it predates this round and is
  loudly stated rather than silently shipped, but it is real and should be
  prioritised: it weakens the roster/relationship-unlinkability invariant
  (Layer D assertion 5) for any member active in more than one Circle.
- `tests/sentinel/checklist.yaml` gained a full `F61-R2` entry (`covered_by`,
  `what_to_re_verify`, `known_open_not_regressions`) in the same round the
  feature shipped — satisfies the "new features must gain Sentinel coverage
  in the same round" rule.
- `docs/visibility.md` §3b/§4 tabulates the new account shapes and the
  `enc_pub` defect consistently with the above.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | `anchor build`, `frontend: npx tsc --noEmit`, IDL byte-diff, `npm audit` (root+frontend) | 4 | 0 | IDL now matches source (was the secondary finding) |
| E — Build health | root `tsc --noEmit -p tsconfig.json` | — | known pre-existing (node_modules `.d.ts` parse errors, unrelated to this diff, documented in checklist.yaml line 503) | not new |
| B — API contract / relay policy | `tests/relayer.ts` (part of full run) | 12 | 0 | unchanged from previous round |
| C — Proof/contract, on-chain (full `anchor test`) | 18-file suite incl. `epic1/epic3/epic5/faucet/relayer/...` | 160 | 0 | **all previously-listed failures now pass** |
| D — Privacy invariants (static) | grep for analytics/telemetry/console.log of identity, forbidden field names, network sinks in shard/master files | pass | 0 | clean; "badge" hits are pre-existing CSS classes, not new fields |
| D — Privacy invariants (dynamic, in-suite) | shard/master-secret network-sink tests, enumeration-path tests, zero-lamport shielded-key tests, hidden≡absent tests | pass (part of 160) | 0 | — |
| F — Sponsor recovery / master secret | recovery emits nothing on chain; no shard network path; no enumeration; provisional-no-recovery; challenge window | pass (part of 160 + direct file review) | 0 | — |

## Regressions

None found this round. The previous round's sole regression (the headline
finding) is resolved and independently reproduced as fixed.

## Privacy-invariant status (Layer D's seven assertions)

Full adversarial DB/log dump simulation (`npm run test:adversarial`) does not
exist as a runnable script in this repo (`package.json`/`frontend/package.json`
have no such target — carried-forward gap, matches every prior round's note).
What was verified directly this round, against the current diff:

1. Sponsor identity / sponsor→member edge — ✔ unchanged by this diff.
2. Trust list / chosen-ones list — ✔ unchanged by this diff.
3. Message content / who-messaged-whom — ✔ unchanged by this diff; mailbox
   suite (`"the crypto module has no network sink"`, padding/length tests)
   passes as part of the 160.
4. Biometric material — ✔ `masterSecret.ts`/`shielded.ts` never read or
   transmit anything passkey/biometric; passkey remains a device-local
   *unlock*, never a recovery gate.
5. Roster of any circle — ✔ for the `owner`-memcmp leak the shield mechanism
   closes (previous round's concern — "can't use shielding without breaking
   the membership" — is now false: shielded writes work end to end). **⚠
   partially open** via the `enc_pub`-not-circle-bound defect above (disclosed,
   pre-existing, tracked).
6. Whether a member has hidden content — ✔ `"leaves an outsider with an
   address they cannot compute — hidden ≡ absent"` passes.
7. Parrain→neophyte faucet link — ✔ unchanged by this diff; faucet suite
   (uniform-grant, nullifier, wing-only-arithmetic-disclosure tests) passes.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found. Same conclusion as the previous round: `Tier` in
`frontend/lib/visibility.ts` is the existing 0/1/2 visibility setting, not a
ranking; the "badge" CSS class occurrences in `board/page.tsx`/`me/page.tsx`
are pre-existing UI status pills (not touched by this round's diff — confirmed
via `git diff` showing no hits), not member-facing score/rank fields. No new
field matching `/(score|rating|rank|karma|tier|badge|count)/i` was added to
any member-facing model this round.

## Baseline changes this round

None requiring a waiver. `frontend/lib/ayni.json` changed, but it now
correctly matches the `programs/` source it was always supposed to match —
this closes, rather than opens, a baseline-integrity problem the previous
round correctly flagged.

## Coverage gaps (shipped behavior not yet under Sentinel test) — carried forward, must shrink

- Layer A (Playwright e2e) has only 4 basic specs
  (`frontend/e2e/{smoke,i18n,dark-mode,twelve}.spec.ts`); the Shield UI's
  pre-commit disclosures and the `relayed: false` "paid by your wallet"
  disclosure remain unasserted at the DOM level (carried forward, not
  re-verified this round — time budget went to the on-chain fix
  verification, which was this round's explicit purpose).
- `npm run test:adversarial` and `npm run test:api` do not exist as scripts in
  this repo at all (not merely "not run this round" — there is no target to
  run). This should be logged as a growing gap, not just carried forward
  silently, since the spec calls for it every round.
- **NEW this round, named above**: an explicit on-chain test for "payer signs,
  true authority slot present but unsigned" (as distinct from "wrong key
  signs as authority", which is covered) — low risk given the Anchor/Solana
  signer-enforcement guarantee, but currently untested directly.
- `MemberProfile.enc_pub` cross-circle regrouping (disclosed defect, not
  fixed) — should get its own Sentinel test asserting two profiles for the
  same member in different Circles currently DO share `enc_pub` bytes (a
  "known-failing" assertion, so a silent fix doesn't go unnoticed either).

## Verdict rationale

The critical problem from the last round is genuinely gone, and I checked
that independently rather than taking the fix on faith: the Rust the frontend
was written against is now actually in the tree, `anchor build` and the full
160-test on-chain suite both come back clean against a freshly started
validator, and the specific tests the last round named as broken — plain
visibility-setting, admission, quipu, and the new shielded-write paths — all
pass by name in this run's log. I also checked the part the last round didn't
have time for: whether separating "who pays the rent" from "who is allowed to
act" could let a payer sneak into the authority's seat. It can't — both are
independently required signatures, enforced by the blockchain itself before
the program even runs, and every authorisation check still compares against
the real authority. The recovery and shard-handling rules from CLAUDE.md hold
up under direct file review. The one thing worth watching, and it is not new
this round, is that a member's encrypted-profile key is currently the same
across every circle they belong to, which lets someone with database access
link a member's presence across circles — the team found this themselves,
wrote it down honestly in three separate places, and left it open with a
stated reason (fixing it needs a migration). Because it is disclosed rather
than hidden, and it predates this round, it is a WARNING to prioritise rather
than a reason to fail this round. Net result: ship it — the round did what it
said it would do, and said clearly what it still does not do.
