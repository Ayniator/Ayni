# Non-Regression Report — 2026-08-12 — Round e11-recovery
Verdict: **PASS WITH WARNINGS**

Scope: **F85** (Epic 11 recovery UX — shard ceremony, in-person handover,
recovery wizard) + **F66** (blinded, one-time guardian keys for the F9/F10/F11
on-chain migration path) + small chrome fixes (Nav "Start here" i18n key).
Base commit `b8e7f1d` + working tree (nothing from this round is committed
yet). Previous baseline: `reports/sentinel/NRR-2026-08-12-f82-f83.md` (PASS
WITH WARNINGS — both its warnings independently reconfirmed resolved this
round: `BACKLOG.md` row F84 exists, `docs/shipped.md` has the F84 section).

**This round modifies no committed history** — commit `b8e7f1d` is the base;
everything reviewed here is the working tree on top of it (10 modified files +
8 new files, see `git status` below). Per CLAUDE.md, this round explicitly
**touches the locked recovery positions**, so Layer F is the primary gate and
every one of its assertions is treated as CRITICAL-on-failure, not WARNING.

```
Changes not staged for commit:
	modified:   BACKLOG.md
	modified:   docs/shipped.md
	modified:   frontend/app/me/page.tsx
	modified:   frontend/app/onboarding/page.tsx
	modified:   frontend/components/Nav.tsx
	modified:   frontend/lib/i18n.generated.ts
	modified:   frontend/lib/i18n.ts

Untracked files:
	frontend/app/recovery/                  (page.tsx + setup/page.tsx)
	frontend/components/ShardReceive.tsx
	frontend/components/ShardSend.tsx
	frontend/lib/recoveryKeys.ts            (F66)
	frontend/lib/recoveryUi.ts
	frontend/lib/shardSeal.ts
	frontend/types/qrcode.d.ts
	tests/recovery-keys.test.mjs
	+ tests/sentinel/e11-recovery-check.sh  (new, Sentinel's own gate, this round)
	+ tests/sentinel/checklist.yaml entries F85 / F66 (this round)
```

`git diff --stat HEAD -- programs/ circuits/` — **empty**. Confirmed: no
program or circuit code was touched this round.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — build health | `npx tsc --noEmit` (frontend) | 1/1 | 0 | re-run, still clean |
| E — build health | `npm audit --audit-level=critical` | 0 critical / 37 total | 0 | total rose 28→37 with **zero** `package.json`/`package-lock.json` diff (git-confirmed) — advisory-database drift, not this round's doing; still 0 critical |
| E — i18n key-existence gate | `bash tests/sentinel/i18n-key-check.sh` | 976/976 | 0 | count unchanged from last round's post-close figure; new keys resolve via the English-fallback chain |
| E/D — F82/F83 regression gate (carried) | `bash tests/sentinel/f82-f83-check.sh` | all pass | 0 | re-run, unchanged |
| D — privacy/Traditions mechanical sweep | `tests/sentinel/privacy-sweep.sh` (5 gates) | 5/5 | 0 | re-run, unchanged |
| C — proof layer | `tests/sentinel/zk-integrity.sh` (9 checks) | 9/9 | 0 | re-run, unchanged; circuits/ untouched |
| **F — Epic 11 recovery (this round's primary gate)** | `bash tests/sentinel/e11-recovery-check.sh` (**new**, 27 assertions) | 26/27 | 1 | new script this round |
| F — F66 unit tests | `node tests/recovery-keys.test.mjs` | 11/11 | 0 | new this round |
| Coverage — F85 | checklist.yaml `F85` entry + new gate script | added this round | — | previously 0 (feature did not exist as UI) |
| Coverage — F66 | checklist.yaml `F66` entry + new gate script | added this round | — | previously 0 |

## Regressions

**None found.** No previously-working behavior broke. One dependency-hygiene
finding (below) is a fragility risk, not a current break, and no CRITICAL
(locked-position or privacy-invariant) violation was found anywhere in this
round's diff.

### Finding 1 — WARNING — `qrcode` is an undeclared direct dependency

`frontend/components/ShardSend.tsx` does `import QRCode from "qrcode"` to draw
the shard-handover QR code locally onto a `<canvas>`. `frontend/package.json`
declares **no** direct dependency on `qrcode` — confirmed by grep and by a
`json.load` check of both the `dependencies` and `devDependencies` blocks
(both `False`). It currently resolves and typechecks cleanly only because
`qrcode` is a **transitive** dependency of `@solana-mobile/wallet-standard-mobile`
(`package-lock.json:1532`, `:5423`) — present in `node_modules` and pinned in
the lockfile by accident of an unrelated package's own dependency tree, not by
a declared intent to use it directly. `npx tsc --noEmit` is silent about this
(it typechecks whatever resolves; it does not check registered dependencies),
and a matching `frontend/types/qrcode.d.ts` ambient module declaration exists
— exactly what a genuinely-undeclared-but-currently-resolving import looks
like from tsc's point of view.

**Why it matters:** if `@solana-mobile/wallet-standard-mobile` ever drops or
version-jumps past its own `qrcode` dependency, or a future `npm install`
(rather than `npm ci`) re-resolves the tree differently, the QR half of the
**entire in-person shard-handover flow** — the only mechanism this system has
for moving a shard between two devices without a network — silently stops
resolving, with no compiler signal pointing at the real cause. (NFC and
manual-entry handover are unaffected either way — they never import `qrcode`.)

**Reproduction:**
```
cd frontend
grep -n 'import QRCode from "qrcode"' components/ShardSend.tsx
python3 -c "import json; d=json.load(open('package.json')); \
  print('deps:', 'qrcode' in d.get('dependencies', {}), \
        'devDeps:', 'qrcode' in d.get('devDependencies', {}))"
# -> deps: False devDeps: False
grep -n '"qrcode"' package-lock.json | head -3
# -> only reachable via node_modules/@solana-mobile/wallet-standard-mobile
```

**Disposition:** not a locked-position or privacy-invariant violation (no
CRITICAL — nothing about this touches a shard's confidentiality, and the
component's own header comment is accurate that rendering is 100% local), and
not yet a functional break (build/typecheck/runtime all currently pass) — so
it does not block this round on its own. It does need a one-line fix
(`"qrcode": "^1.5.4"` added to `frontend/package.json`'s direct dependencies)
before it becomes real debt. Sentinel's new gate (`e11-recovery-check.sh`)
asserts this and will **FAIL** the round once it is genuinely a build break, or
if left unaddressed, escalates per the missing-coverage-style rule.

## Locked-position review (CLAUDE.md §"Locked positions" — the primary gate this round)

All nine assertions below were checked directly against the working-tree code
(not cited from memory), both by hand-reading every new file and by the new
executable gate `tests/sentinel/e11-recovery-check.sh` (26/27 pass — the one
failure is Finding 1 above, unrelated to any locked position).

1. **Recovery emits nothing on chain / no network path.** Grepped
   `app/recovery/page.tsx`, `app/recovery/setup/page.tsx`,
   `components/ShardSend.tsx`, `components/ShardReceive.tsx`,
   `lib/shardSeal.ts`, `lib/recoveryUi.ts`, plus the pre-existing
   `lib/recovery.ts`, `lib/sharding.ts`, `lib/shardCustody.ts`,
   `lib/shardHandover.ts` for `fetch(`, `XMLHttpRequest`, `WebSocket`,
   `sendBeacon`, `RTCPeerConnection`, `EventSource`, `new Image(`, `.src =`,
   `axios`, `http(s).request`, and separately for `@solana/web3.js`,
   `@coral-xyz/anchor`, `wallet-adapter`, `@solana-mobile` — **zero hits** in
   either category, across all 10 files. This is a **stronger** guarantee than
   a spy-based "the send path was never called" test would give: there is no
   `Connection`/`sendTransaction`/socket capability imported anywhere in the
   surface at all, so there is no possible code path to spy on in the first
   place. Additionally ran an **import-graph spot check**: every relative
   (`./`/`../`) import inside these 10 files resolves only to another file
   already inside this same declared surface (or `components/SettingsProvider`,
   the one i18n leaf) — no indirect widening of the surface through a chain of
   imports. **HOLDS.**

2. **Member-present requires a genuine member shard.** `lib/recovery.ts`'s
   `recoverMemberPresent` still throws unless `mine.role === "member"` and
   `sponsor.role === "sponsor"` — but this round adds the **cryptographic**
   teeth Round F's report (`NRR-2026-08-11-F.md`) explicitly flagged as
   missing ("a caller-declared-role check, not cryptographic... real strength
   depends on F74... correctly gating which shard a device may call 'the
   member's own'"): `app/recovery/page.tsx`'s `MemberPresentFlow.unlock()`
   calls `openShard("member", code, sealed)` — `lib/shardSeal.ts`'s
   `sealKeyFor` derives the AES-equivalent key as
   `SHA-256("aha-shard-seal-v1:member:" + code)`, domain-separated per role,
   and `nacl.secretbox.open` **authenticates**: a blob sealed under
   `sponsor-1`/`sponsor-2` cannot open under the `member` key — it returns
   `null`, never garbage-as-success. Two sponsor shards genuinely cannot
   masquerade as member-present; this is now enforced by the encryption, not
   only by a self-reported `role` string. **Round-F gap closed. HOLDS.**

3. **7-day challenge window not client-shortenable.**
   `lib/recoveryUi.ts:loadPendingRecovery()` parses the stored intent but
   **always** re-pins `windowMs: CHALLENGE_WINDOW_MS` regardless of what value
   (if any) was in the stored JSON — a tampered localStorage record cannot
   shorten the window; it is not merely clamped, the stored value is ignored
   outright. `app/recovery/page.tsx`'s completion button is
   `disabled={!elapsed || busy}` where `elapsed` is computed fresh as
   `windowElapsed(pending, now)` on every render, and `now` ticks via a
   `setInterval`-backed hook — a stale closure cannot fake elapsed time. Grep
   for `skip-window`/`dev-shortcut`/`bypass-window`-shaped affordances across
   the whole surface: **zero hits**. **HOLDS.**

4. **No shard on any server, no enumeration.** `lib/shardCustody.ts`
   (pre-existing, re-verified this round) exposes exactly `put`/`get`/`burn` —
   grepped for any `list`/`keys`/`count`/`entries`/`iterate`/`has` method
   definition: **none**. The new UI (`app/recovery/**`) never adds one; the
   sponsor-only recovery intent is written only to `localStorage` on the
   member's own device (`recoveryUi.ts`'s `savePendingRecovery`), keyed by the
   member's own one-time code, never transmitted. **HOLDS.**

5. **Shard handling: vetted libraries, mandatory burn-and-reissue.**
   `frontend/package.json` declares `"shamir-secret-sharing": "^0.0.4"` and
   `"tweetnacl": "^1.0.3"` as **direct** dependencies (unlike `qrcode` — see
   Finding 1). `lib/sharding.ts` imports `split`/`combine` from
   `shamir-secret-sharing` and contains **zero loop constructs of any kind** —
   a pure delegation, not a reimplementation; its header comment's mention of
   "GF(256)" is prose describing the *library's* implementation, not
   hand-rolled code in this file (confirmed by scanning code lines only,
   excluding comments). `lib/shardSeal.ts` seals via `nacl.secretbox`
   exclusively. Burn-and-reissue: `SponsorOnlyFlow.complete()` burns both
   consumed sponsor-shard custody entries (`localShardCustody.burn(...)`)
   **unconditionally**, before the reissue prompt even renders — so those two
   specific shards can never be replayed regardless of what the member does
   next. The `RecoveredPanel` state machine's "done" button is reachable only
   at `stage === "finished"`, which requires completing both fresh sponsor
   handovers of the re-shared set — there is no shortcut inside the wizard
   from "recovered" straight to "done" that skips reissue. (Caveat, not a
   locked-position violation: a member who **abandons the tab** after
   member-present recovery but before clicking "cut new shards" leaves their
   *old* member-shard custody entry unburned on that one device — this is an
   inherent limit of any client-only wizard, not something code can force, and
   does not by itself allow shard reuse since a shard alone reconstructs
   nothing.) **HOLDS**, with that caveat noted for the record.

6. **Provisional-member disclosure, both surfaces.** `app/onboarding/page.tsx`
   step 3 of 3 (`StepFace`, the **final** onboarding step) unconditionally
   renders the F78 card (`onboarding.f78.title` etc.) — not gated behind
   attestation count, so every member sees it before finishing, honest members
   and provisional members alike. `app/recovery/setup/page.tsx`'s
   `StepProvisional` consults the **shared** `sponsorRecoveryAvailable(1)`
   guard from `lib/recovery.ts` (not a re-derived local rule) and refuses to
   run a fake ceremony for a 1-sponsor split, routing instead to an honest
   dead-end screen. **HOLDS.**

7. **F66 is architecturally separate from local recovery, and unlinkable.**
   `lib/recoveryKeys.ts` derives `HKDF-SHA-512(sponsorSecret, salt=
   "AHA-F66-recovery-v1", info=memberCommitment‖u64le(epoch)) →
   Keypair.fromSeed` — a one-way function; without `sponsorSecret` nothing
   computable links a blinded pubkey to its sponsor. Grepped every file in the
   local-recovery surface for any reference to `recoveryKeys`: **zero hits** —
   F66 is not imported from `app/recovery/**`, `components/Shard*.tsx`,
   `lib/shardSeal.ts`, `lib/recoveryUi.ts`, or `lib/recovery.ts`. The module
   exports no storage/enumeration helper (grepped for `localStorage`/
   `indexedDB`/`sessionStorage` and for `list`/`enumerate`/`getAll`/`dump`
   exports: none). **Critically confirmed:** `frontend/lib/member.ts` still
   contains **2** occurrences of `PublicKey.default` (line 88, the dev-fixture
   signer, and line 251, the real `issueMembership` call site) — F66 is not
   silently wired into what lands on chain at issue time this round; per
   `tests/recovery-keys.test.mjs`, 11/11 unit tests pass independently.
   **HOLDS.**

8. **Secret hygiene.** Grepped the entire surface for `console.*`: **zero**
   hits. Grepped for `location.`/`URLSearchParams`/`router.push`/
   `searchParams`: **zero** hits — no secret material ever touches a URL. The
   reconstructed master secret in `app/recovery/page.tsx` lives only in a
   `useRef` (`masterRef`), never `useState`, and is `fill(0)`-wiped on
   unmount, on `backHome()`, and after re-sharing completes. Counted 21
   `fill(0)`/`wipe(...)` call sites across the round's 4 new files — matches
   `BACKLOG.md`'s own claim. `localStorage` usage in the surface is limited to
   exactly the two documented, expected sinks: `lib/recoveryUi.ts` (the local
   pending-intent record) and `lib/shardCustody.ts` (sealed opaque blobs,
   pre-existing) — `ShardSend.tsx`/`ShardReceive.tsx` themselves call neither.
   **HOLDS.**

9. **Seal-derivation consistency.** Both `/recovery` and `/recovery/setup`
   import `sealShard`/`openShard`/`openSponsorShard` from the single shared
   `frontend/lib/shardSeal.ts` (verified via import-path grep) — no duplicated
   or drifted key-derivation logic between the ceremony and the recovery
   wizard. The domain tag `"aha-shard-seal-v1:<role>:<code>"` appears in
   exactly the one production derivation line
   (`shardSeal.ts:sealKeyFor`). **HOLDS.**

## Standard layers re-verified

- `bash tests/sentinel/privacy-sweep.sh` — 5/5 gates pass (no analytics SDK,
  no tracking pixel, no logging macro in the Anchor program, no `console.*` of
  identity material, no score/rating/rank/karma/reputation field).
- `bash tests/sentinel/zk-integrity.sh` — 9/9 (vkey/zkey/rs triples for all 3
  circuits still match; `circuits/` untouched this round — `git diff --stat
  HEAD -- circuits/` is empty).
- `bash tests/sentinel/i18n-key-check.sh` — 976/976 keys resolve to an English
  fallback (see the i18n propagation gap noted below — this gate only proves
  no raw key/crash, not full localization).
- `bash tests/sentinel/f82-f83-check.sh` — carried-forward gate, still passes,
  unrelated files untouched this round.
- `git diff --stat HEAD -- programs/ circuits/` — **empty**, confirmed both
  ways (grep and diff), satisfying CLAUDE.md's requirement that Epic 11
  recovery never touches the chain.
- Traditions grep (score/rating/rank/karma/tier/badge/count) over every new
  file this round: only two matches, both in `lib/shardCustody.ts`'s own
  comments *describing the absence* of `list()/keys()/count()` — i.e. the
  match is the invariant being documented, not violated.

## Privacy-invariant status (the seven Layer D assertions)

Unchanged from the last full Layer D pass (still no adversarial dump-simulation
suite exists in this repo — the long-standing, disclosed gap). This round adds
a new instance of assertion 7 in spirit (a faucet-shaped parrain→neophyte
unlinkability claim), now also for shard custody:

| # | Assertion | Status |
|---|-----------|--------|
| 1 | sponsor identity / sponsor→member edge | unchanged: VIOLATED overall (named `attest_admission.rs` pilot path + `WingPeer` + fee-payer deanonymization), IMPROVED for the ZK path — pre-existing, not this round's scope |
| 2 | trust list / chosen-ones list | n/a (feature not built) |
| 3 | message content / who-messaged-whom | unchanged: VIOLATED (content sealed, recipient+timing public) |
| 4 | biometric material | PASS — re-confirmed this round: grepped the entire recovery surface for `biometric`/`attestationObject`/`rawId`/`PublicKeyCredential`: zero hits. Recovery never gates on, reads, or transmits a biometric byte, exactly per the locked position ("the passkey never gates recovery on its own") |
| 5 | circle roster | unchanged: VIOLATED (pre-existing, not this round's scope) |
| 6 | hidden content | untestable (feature not built) |
| 7 | faucet parrain→neophyte link | unchanged from last full pass (out of this round's scope); **new sub-case this round, shard custody→member link: HOLDS by code inspection** — `lib/shardCustody.ts`'s storage is keyed by a SHA-256 hash of the one-time code, holds only opaque base64 blobs, no name/pubkey/commitment/timestamp beside a blob; still not backed by an automated dump-and-inspect test (coverage gap, carried forward) |

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

**None found in this round's files.** Grepped every new/modified file for
`/(score|rating|rank|karma|tier|badge|count)/i`: the only two hits
(`shardCustody.ts`) are comments *asserting the absence* of an enumeration
surface, not an instance of one. No new file ranks, compares, aggregates,
names a sponsor, or leaks a relationship. The recovery surface is, by
construction, incapable of naming a sponsor to anyone but the two people
physically present at handover (shard bytes are indistinguishable; roles live
only in local, per-device custody, never published).

## Baseline changes this round

**None.** No file under `tests/sentinel/baselines/` was touched. Two new
Sentinel artifacts were added (not baseline changes, new coverage):
`tests/sentinel/e11-recovery-check.sh` and the `F85`/`F66` entries in
`tests/sentinel/checklist.yaml`.

## Coverage gaps (must shrink each round)

1. **No Playwright/e2e suite exists in this repo** (long-standing, all
   rounds). None of Layer A's asks for this feature — a real QR round-trip
   between two browser contexts, NFC on real hardware, camera
   `BarcodeDetector` against a live video feed, or the full
   ceremony→handover→recovery→reissue wizard clicked through end to end —
   run anywhere. Everything in this round's coverage is static/grep + the
   pre-existing property tests (`tests/sharding.ts`) + this round's new
   mechanical gate. Unchanged systemic gap, not new to this round.
2. **No adversarial dump-simulation test** automatically inspects a real
   `localStorage` dump post-ceremony/post-recovery to prove no structure
   links a shard to a member — verified by Sentinel code-reading this round
   (as in Round F), not by an automated dump-and-inspect test. Carried
   forward, unchanged, two rounds running now.
3. **18-locale translation propagation had not landed as of this review.**
   All 203 new i18n keys this round (`recovery.*`, `shard.send.*`,
   `shard.receive.*`, `onboarding.f78.*`, `me.recovery.*`) exist **only** in
   the English block of `frontend/lib/i18n.generated.ts` — confirmed by exact
   count (0/203 present across the other 18 locale blocks; the small
   `nav.start` key is likewise only in the curated `lib/i18n.ts` English
   source, 0 in the generated file). This was explicitly disclosed by the
   main agent as an in-progress, parallel workflow at task hand-off, and does
   not break anything today — `i18n-key-check.sh`'s `DICT[lang] ?? en`
   fallback chain means every non-English viewer currently sees correct
   English text on these new screens, never a raw key or a crash. It is real
   product-completeness debt, tracked as a **WARNING this round**; per the
   missing-coverage rule (Sentinel spec §4) it becomes a **FAIL next round**
   if still materially incomplete.
4. **`qrcode` dependency-declaration gap** — see Finding 1. Tracked in the
   checklist this round so it cannot silently drop off the diff.
5. `member_migrate`/`recover_membership` (the F9/F10/F11 on-chain path F66
   ultimately feeds) has no end-to-end test against a local validator that
   actually exercises `proveRecoveryControl`'s signature as a co-signer — a
   pre-existing gap in F9/F10/F11 coverage, not introduced this round, noted
   here because F66 makes it newly relevant.

## Verdict rationale

This round asked Sentinel to check something specific and serious: does the
new recovery screen actually keep the promises CLAUDE.md locked down —
nothing leaves the device, nothing goes on chain, a sponsor can't pretend to
be the member, the 7-day wait can't be rushed, nobody's phone can be searched
to find out who they're sponsoring, and a member with only one sponsor is told
the truth instead of being sold a fake safety net. Every one of those promises
held up under direct inspection of the code, not just a claim taken on trust —
and one of them (a sponsor's shard genuinely cannot pretend to be the member's
own shard) is now backed by real encryption where last week's review found it
was only a polite convention. The blinded-key feature that will eventually let
a sponsor help move a lost wallet on-chain was checked too, and it correctly
stays out of the local recovery flow entirely, exactly as designed. The one
real problem found — a QR-code library the app depends on that was never
formally added to the project's ingredient list — is not a privacy or safety
issue today; it is a "this could quietly break later" risk that takes one line
to fix. The bigger open item is that translations for all these new screens
into the other 18 languages have not landed yet, which the team already knew
and flagged; non-English members will see clear English text in the meantime,
not broken text, but this must close by the next round. Given no locked
position was breached and no user-facing feature currently misbehaves, this
round is a **PASS WITH WARNINGS**, not a FAIL — but both warnings (the
dependency and the translations) need to be closed, not carried forward again.
