# Non-Regression Report — 2026-08-12 — Round F81 (i18n) — R1 Recheck
Verdict: **PASS**

Scope: re-verification of the **F81 full-page localisation** unit after the
R1 fix. Files under test: `frontend/lib/i18n.generated.ts` (working-tree
diff on top of commit `cd4ef34`: +4,636/−4,636 lines, a pure key-rename),
`frontend/lib/i18n.ts` (unchanged this round, re-read for the resolution
chain), `frontend/app/admin/CircleAdmin.tsx` + `frontend/app/admin/page.tsx`
(unchanged this round, call sites re-checked against the fixed dictionary).
Commit under test: `cd4ef34` + working tree (`i18n.generated.ts` only).
Previous report: `reports/sentinel/NRR-2026-08-12-f81-i18n.md` (FAIL, commit
`5d9b6ce` + working tree). No other file changed between the two reviews —
confirmed by `git status --porcelain` (single modified file) and
`git diff --stat` (100% of the diff is `i18n.generated.ts`).

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — build health | `npx tsc --noEmit` (clean) | 1/1 | 0 | re-run, still clean |
| E — build health | `next build` | n/a | env-blocked (Node 18.20.5 < Next's required ≥20.9.0) | unchanged env limitation, not a regression |
| E — build health | `npm audit --audit-level=critical` | 0 critical / 28 total | 0 | unchanged shape vs. baseline |
| E — i18n key-existence regression gate | `bash tests/sentinel/i18n-key-check.sh` | 765/765 | 0 | **flipped FAIL → PASS this round** |
| E (Sentinel-added, this recheck) — real `translate()` resolution-chain simulation for all 244 previously-broken keys × 19 locales | custom Node harness replaying `DICT[lang] ?? PAGE_STRINGS[lang] ?? en ?? PAGE_STRINGS.en ?? key` exactly as `lib/i18n.ts` implements it | 4636/4636 | 0 | **new, deeper check than the static gate — confirms real UI resolution, not just key presence** |
| E (this recheck) — rename-purity diff analysis | every removed bare-key line paired against its added `admin.`-prefixed counterpart | 4636/4636 pairs: value-identical, correctly prefixed | 0 mismatches | new analysis this round |
| E (this recheck) — collision check | do any `admin.*` keys pre-date the rename (would be clobbered)? | 0 pre-existing `admin.*` keys found | n/a | new analysis this round |
| E (this recheck) — orphan-reference check | are any of the 244 old bare keys still called literally by non-admin `t()` sites? | 0 found | n/a | new analysis this round |
| D — privacy/Traditions mechanical sweep | `tests/sentinel/privacy-sweep.sh` (5 gates) | 5/5 | 0 | unchanged, re-run |
| C — proof layer | `tests/sentinel/zk-integrity.sh` (9 checks) | 9/9 | 0 | unchanged, re-run |
| F — sponsor recovery (Epic 11) | grep for touched `shard*`/`recovery*`/`programs/`/`circuits/` files | 0 files touched | 0 | untouched, confirmed |
| Docs reconciliation | `BACKLOG.md` F81 row (🟢), `docs/shipped.md` F81 section — claim re-tested now that the gate passes | claim now holds | 0 | R2 resolved (same underlying defect as R1, now fixed) |

## Regressions

**None found this round.** R1 (Circle Administration console rendering raw
i18n keys) is resolved; no new regression was introduced by the fix.

### R1 — RESOLVED — Circle Administration console now renders real text in all 19 languages

**What was wrong (recap):** `CircleAdmin.tsx`/`admin/page.tsx` call
`t("admin.<sub>")` for 244 distinct keys, but `i18n.generated.ts` stored the
same strings under bare keys (`config.add`, `council.title`,
`faucet.jarBalance`, …) with no `admin.` prefix, in all 19 locale blocks —
`translate()`'s full fallback chain found none of them and returned the raw
key.

**What changed:** `frontend/lib/i18n.generated.ts` was regenerated, renaming
exactly the 244 bare keys to `admin.<sub>` in all 19 locale blocks.

**Verification performed this round (beyond re-running the gate script):**

1. **Diff-purity check.** Parsed the full working-tree diff
   (`git diff -- frontend/lib/i18n.generated.ts`, 4,636 insertions / 4,636
   deletions). Paired every removed line against its corresponding added line
   positionally: **all 4,636 pairs have byte-identical values**, and **all
   4,636 added keys equal `"admin." + removed key`**, with zero exceptions.
   This is a pure, mechanical rename — no value drift, no accidental content
   edit riding along with the key change.
2. **Distinct-key count.** Exactly **244** distinct bare keys were removed
   and exactly **244** distinct `admin.*` keys were added — matches the
   claimed scope precisely (244 keys × 19 locales = 4,636 line-pairs, which
   is exactly what the diff contains).
3. **Collision check.** Loaded the pre-fix `i18n.generated.ts` (`git show
   HEAD:frontend/lib/i18n.generated.ts`) and checked whether any `admin.*`
   key already existed in `en` before the rename. **Zero** — nothing was
   clobbered by introducing the new namespace.
4. **Orphan-reference check.** Grepped every literal `t("...")` call site
   app-wide (`app/`, `components/`, `lib/`) for the 244 old bare key names.
   **Zero** non-admin call sites reference any of the renamed bare keys —
   confirming the previous report's safety claim ("renaming — not
   duplicating — was safe") is empirically correct, not just asserted.
5. **Exact call-site match.** The set of `admin.*` keys called literally in
   source (244) is **identical, element-for-element**, to the set of
   `admin.*` keys added by the rename (244) — no unresolved call site left
   over, no unused dictionary entry left dangling.
6. **Real resolution-chain simulation (deepest check).** Rather than trusting
   the static presence check alone, re-implemented `translate()` exactly as
   written in `lib/i18n.ts` (`DICT[lang] ?? PAGE_STRINGS[lang] ?? en ??
   PAGE_STRINGS.en ?? key`) in a standalone harness, loading both the curated
   chrome dict and the generated `PAGE_STRINGS`, and ran it for **all 244
   admin keys × all 19 locales = 4,636 (locale, key) pairs**. **Zero**
   pairs resolve to the raw key — every single one produces real, distinct,
   correctly-localised text (spot-checked in the report body: `en`/`fr`/
   `es`/`zh`/`ar`/`qu` for `admin.config.add`, `admin.council.title`,
   `admin.faucet.jarBalance`, `admin.redirect.moved`,
   `admin.administrationOf` — all read as genuine translated strings, not key
   echoes).
7. **Locale-count sanity.** All 19 locale blocks (`en, fr, es, se, th, hi,
   zh, de, sv, nb, da, ar, lo, dz, bo, my, vi, tl, qu`) carry exactly 244
   `admin.*` keys each — no locale was missed. Total key counts per locale
   are internally consistent with the pre-existing, already-verified pattern
   (`en` = 749 page keys; each non-English locale = 749 + 8 `msg.*` keys =
   757 — this 8-key delta is pre-existing curated-chrome-dict behavior,
   unrelated to and unaffected by this round's rename, confirmed by diffing
   `en` vs. `fr` key sets: the only difference is the 8 `msg.*` keys, exactly
   as in the prior round's baseline).

**Conclusion: R1 is fully and correctly resolved.** The admin console reads
real, correctly-localised text again, in English and in all 18 non-English
locales, with values preserved from the original (pre-mismatch) source
strings.

### R2 — RESOLVED — "Done" status and the fallback-safety claim are now accurate

The prior report's R2 finding was that `BACKLOG.md` (🟢) and
`docs/shipped.md`'s F81 section were edited to claim completion, and to
assert *"resolution degrades to English, never to a raw key,"* while R1's
244-key failure disproved that exact claim. Both documents are unchanged in
this round's working tree (only `i18n.generated.ts` was touched — confirmed
by `git status --porcelain` showing a single modified file) — they still say
🟢/"Done" and still contain the same fallback-safety sentence. That is now
correct rather than premature: this round's verification (above, item 6 in
particular) proves the "never a raw key" claim genuinely holds for the
previously-failing keys, across every locale, via the actual resolution
function the app runs. R2 required no doc edit to resolve — it required the
underlying code to become true, which it now is. No further action needed on
`BACKLOG.md` or `docs/shipped.md`.

## Privacy-invariant status (the seven Layer D assertions)

Unchanged from both the Round 7 baseline and the prior F81 report's finding —
this recheck's diff touches only `frontend/lib/i18n.generated.ts` (translation
string values/keys), nothing else changed:

1. sponsor edge — unaffected (`git diff --stat` shows 100% of the change is
   in `i18n.generated.ts`; no `programs/`/`state.rs` touched). ✔
2. trust list — n/a, unaffected. ✔
3. message content/metadata — unaffected; `msg.inbox.*` string *values* are
   untouched by this round's key-rename (only `admin.*` keys were renamed;
   confirmed the 244-key diff list contains zero `msg.*`/`inbox.*` entries). ✔
4. biometric — no biometric code exists; unaffected. ✔
5. circle roster — unaffected. ✔
6. hidden content — unaffected. ✔
7. faucet↔parrain link — `admin.faucet.*` translation **keys** are among the
   244 fixed keys (now displaying correctly), but this is a display-layer fix
   only; re-ran `tests/sentinel/privacy-sweep.sh` (0 forbidden patterns) and
   confirmed no `programs/faucet*` or ledger-decryption code was touched —
   the underlying faucet anonymity properties are untouched by this round. ✔

`tests/sentinel/privacy-sweep.sh` re-run this round: 5/5 gates pass (no
analytics/telemetry SDK, no tracking pixels, no logging macros in the Anchor
program, no `console.*` of identity material, no
score/rating/rank/karma/reputation field). `tests/sentinel/zk-integrity.sh`
re-run: 9/9 checks pass (verifying-key/vkey integrity for `member_vote`,
`lineage_grant`, `ack_disclose` all intact, browser prover and on-chain
verifier still agree).

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found. Grepped this round's entire diff
(`git diff -- frontend/lib/i18n.generated.ts`) for
`/(score|rating|rank|karma|tier|badge|count)\b/i` — zero hits (the diff is
pure translation-string key renames and their unchanged values; no new
field, no new copy referencing rank/score/tier/badge/count was introduced).
No sponsor name exposure, no relationship leak, no new ranking/scoring
surface. ✔

## Locked recovery positions (Epic 11) — spot confirmation

Not touched, as expected for a translation-key rename. Confirmed
mechanically: `git status --porcelain` shows a single modified file
(`frontend/lib/i18n.generated.ts`); no file matching `shard*`, `recovery*`,
under `programs/` or `circuits/` appears anywhere in the working tree diff.
The seven Layer F invariants (recovery emits nothing on chain, no shard on
any server, no member-linkable shard structure, no enumeration path, fast
path requires a genuine member shard, passkey never gates recovery alone /
no biometric byte read, shard freshness + challenge window) are all
architecture-level guarantees unrelated to i18n string tables and are
unaffected by this round's diff. No re-run of the Layer F adversarial suite
was needed or performed since Epic 11 code was not touched this round
(consistent with spec: Layer F re-verification is triggered by changes to
`shard*`/`recovery*`/`programs/`, none of which occurred here).

## Baseline changes this round

None claimed, none found. `tests/sentinel/baselines/npm-audit.json` shape
unchanged (0 critical, 28 total, matches this round's live `npm audit`
output). No program/circuit baseline touched.

## Coverage gaps (must shrink each round)

Carried forward from the prior report, unchanged by this recheck (this round
was a targeted fix-verification, not a coverage-expansion round):

- No Playwright/`test:e2e` suite exists, so nothing actually renders `/me`,
  `/admin`, `/board`, `/inbox` in a browser and asserts on visible pixels —
  this round's verification (the real `translate()` resolution-chain
  simulation) is the closest proxy available without a browser runtime, and
  is materially stronger than the static key-existence gate alone, but it is
  still not a rendered-DOM assertion. Highest-value next investment for F81,
  as noted last round.
- `next build` still cannot run in this sandbox (Node 18.20.5 vs Next's
  required `>=20.9.0`) — environment limitation, unchanged, not this round's
  fault. No bundle-size snapshot possible until resolved.
- Non-English translation *quality* (as opposed to key existence/resolution)
  remains spot-checked only (this round added `en`/`fr`/`es`/`zh`/`ar`/`qu`
  spot checks on 5 representative `admin.*` keys, all read as genuine,
  distinct, sensible translations — not a full linguistic review of all 757
  strings × 18 non-English locales).
- `npm run lint` (prettier --check) still fails on files touched by the
  original F81 commit (unrelated to this recheck's diff, which touches only
  `i18n.generated.ts`; carried forward, pre-existing repo-wide drift since
  Round 1, not gating per spec).

## Verdict rationale

The fix does exactly what it claimed and nothing more. A line-by-line diff
analysis shows the entire working-tree change is a pure, mechanical rename:
4,636 line-pairs, every one value-identical before and after, every added
key exactly equal to `"admin." + ` the removed key, applied consistently
across all 19 locale blocks and covering precisely the 244 distinct keys
that `CircleAdmin.tsx` and `admin/page.tsx` actually call — no more, no
fewer, confirmed by an exact set-equality check against the app's real
literal `t()` call sites. Nothing was clobbered (no `admin.*` key existed
before this rename to collide with), and nothing was orphaned (no old bare
key is still referenced anywhere in the source). Most importantly, this
round did not stop at re-running the static gate script — it re-implemented
the app's actual `translate()` resolution function and replayed it for all
4,636 (locale, key) combinations that were previously broken, and every
single one now resolves to real, distinct, correctly-localised text rather
than the raw key. That is as close as a non-browser check can get to proving
the Circle Administration console — mounted for every connected wallet on
`/me`, and the `/admin` redirect stub — reads correctly again, in English and
in all eighteen other languages. Everything the prior report found sound
(the honest inbox metadata copy, the Board Circle-picker's public-only data
use, the untouched proof layer, the untouched faucet and sponsor-recovery
code) remains sound and was re-confirmed by re-running the same mechanical
gates this round, with identical clean results. The documentation claims
that were premature last round — "Done," and "a missing translation
degrades to English, never a raw key" — are no longer premature: they are
now demonstrably true, and needed no further editing because the code caught
up to what they said. `tsc --noEmit` stays clean, `npm audit` is unchanged,
and the only environment limitation (`next build` requiring Node ≥20 in a
sandbox running Node 18) is exactly the same, pre-existing, non-regression
constraint noted last round. With the one blocking regression resolved,
verified from multiple independent angles, and nothing new broken, the
honest verdict is **PASS**.
