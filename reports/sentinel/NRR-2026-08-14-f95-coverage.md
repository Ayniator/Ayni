# Non-Regression Report — 2026-08-14 — Round f95-coverage

Verdict: **PASS WITH WARNINGS**

Scope: **exactly one commit**, briefed by its own author and independently
re-verified rather than accepted on their word:

- `7c29605` test(F95): cover the mobile wallet path that no committed test
  exercised.

This commit exists to close the three WARNINGs raised by
`reports/sentinel/NRR-2026-08-14-t6-shuffle.md` (PASS WITH WARNINGS, scope
`973d52d`). Out of scope, already covered by prior rounds and not re-reviewed
here: `973d52d`, `04251ca`, and everything earlier — confirmed present in
`REVIEWED.md`.

Commit under review at HEAD: `7c296051a358b25ea300382b2a27597a41e7141e`.
Previous baseline: `973d52d` / `NRR-2026-08-14-t6-shuffle.md`.

**`programs/`, `circuits/`, and every application-code directory are
untouched.** `git diff --stat 973d52d 7c29605 -- frontend/app
frontend/components frontend/lib programs circuits` is empty. The diff
touches only `BACKLOG.md`, `docs/shipped.md`, `frontend/e2e/mobile-wallet.spec.ts`
(new), `frontend/playwright.config.ts`, `tests/sentinel/e12-wallet-check.sh`,
plus this round's own bookkeeping. `anchor test` is therefore **skipped,
explicitly** — nothing on-chain could have moved. The claim that the deployed
container needs no redeploy is **verified, not assumed**: `docker inspect
frontend-frontend-1` still shows the same image (`sha256:e8e7258208b5...`,
created `2026-08-14T20:49:22Z`) as the prior round confirmed matches
`973d52d`'s tree — no rebuild occurred and none was needed.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| `npx tsc --noEmit` (frontend) | 1 | 1 | 0 | re-run, clean |
| Full `npx playwright test` (deployed site) | 54 | 54 | 0 | 49 chromium + 5 mobile-firefox-android, matches commit's claim |
| `--list --project=chromium` / `--project=mobile-firefox-android` | 2 | 2 | 0 | new — confirms testIgnore/testMatch partition exactly, no spec dropped |
| Mutation testing of the 3 discriminating assertions (throwaway node:20 `next dev` container, production image untouched) | 3 | 3 | 0 | new this round — each assertion independently proven capable of failing |
| `mwaWillHang()` UA-branch re-derivation (standalone node) | 1 | 1 | 0 | new this round |
| `tests/sentinel/e12-wallet-check.sh` | 22 | 22 | 0 | re-run, 22/22 |
| §8c negative testing (stripped placeholder, drifted copy, malformed JSON, absent file, `browse: null`) | 5 | 5 correctly gated (4 fail-closed, 1 correctly holds) | 0 | new this round — independently re-derived, not accepted from the commit |
| `tests/sentinel/gate-check.sh` | 13 | 13 | 0 | re-run |
| `tests/sentinel/glossary-check.sh` | 10 | 10 | 0 | re-run |
| `tests/sentinel/privacy-sweep.sh` | 5 | 5 | 0 | re-run |
| `diff`/byte check `docs/wallets.json` vs `frontend/public/wallets.json` | 1 | 1 | 0 | confirmed byte-identical and untouched by this commit |
| BACKLOG.md / docs/shipped.md F95 rows — overclaim check | 2 | 2 | 0 | new this round |
| `git diff --stat` app-code/programs/circuits | 1 | 1 | 0 | confirmed empty |
| `npm run build` (local, node 18) | 1 | — | pre-existing fail | environment-only (Next requires >=20), not a regression, not re-litigated |

## 1. Does each new test actually discriminate? (mutation testing)

Verified by **breaking the thing each test asserts**, in a throwaway
`node:20-bookworm-slim` container running `next dev --webpack` against a
volume-mount of the working tree (chosen because local node is 18 and Next
needs >=20; this is a disposable dev server, never the production
`docker compose` image, which was never touched or rebuilt). Every mutation
was applied with a script, the affected test alone was run, then the file was
reverted with `git checkout --` and `git status --porcelain` confirmed clean
before the next mutation.

- **"mounting the notice contacts no third-party host."** Inserted
  `fetch("https://example.com/sentinel-mutation-probe").catch(() => {})` at
  the top of `MobileWalletNotice.tsx`'s effect. Result: **red** —
  `Array [ "example.com (fetch)" ]` where `[]` was expected. Reverted;
  re-confirmed green against the real deployed site (54/54 afterward).

- **"offers every wallet that publishes a browse link, and only those."**
  First tried mutating `wallets.json`'s data alone (removing phantom's
  `browse`) — this does **not** fail the test, and that is correct, not a
  defect: the test computes its own expectation from the same file it reads
  live, so a legitimate data change is tracked rather than flagged. The test
  is meant to catch a **code** regression, so the mutation that matters is in
  `walletBrowserLinks()`'s filter: changed it to stop gating on `browse`
  (`(w): w is ... => !!w.id && !!w.name`, dropping the
  `typeof w?.browse === "string"` clause) so every wallet, including the
  three with no universal link, renders a button. Result: **red** — `expected
  2, received 5` (`.mw-notice-btn` count). Reverted; confirmed the real
  filter's byte-for-byte restoration via `git status --porcelain`.

- **Deep-link percent-encoding.** Removed `encodeURIComponent()` from both
  `url` and `ref` in `walletBrowserLinks()`. Result: **red** — `href`
  contained the raw, unencoded `http://localhost:3100` instead of
  `http%3A%2F%2Flocalhost%3A3100`. Reverted.

All three assertions are genuinely capable of failing; none is the vacuous
"coverage that looks present and is not" defect class this commit exists to
fix. One incidental honest note: the baseline (unmutated) run against the
`next dev` container showed 4/5 green and one **unrelated** red — a
dev-server-only React hydration-mismatch console warning
(`HotReload`/`AppDevOverlayErrorBoundary` internals) on the "warns before the
tap" test. This is a `next dev` artifact, not a defect: the same test passed
cleanly (54/54, no such warning) against the real production build on the
deployed site, both before and after the mutation work. Recorded so the
mutation-testing methodology is not mistaken for having found a fourth
regression.

## 2. `mwaWillHang()` — the Firefox/Android branch, not generic-mobile

The `mobile-firefox-android` Playwright project's UA string is
`Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/121.0 Firefox/121.0`. Ran
`isAndroid()`/`mobileBrowser()`'s exact logic standalone in node against that
string: `isAndroid() === true`, `mobileBrowser() === "firefox"` (the string
contains no "chrome" substring anywhere to trip the wrong branch, and the
ordering guard in the source comment — Firefox tested before Chrome — was
irrelevant here since only one branch could ever match). This confirms
`mwaWillHang()` (`isAndroid() && !isInWalletBrowser() && mobileBrowser() ===
"firefox"`) evaluates true for this UA, not the softer generic-mobile path.
Confirmed live too: "warns before the tap" asserts both the `is-warning` CSS
class and the literal text "will not work" — that is specifically the
hang=true branch's copy (see `MobileWalletNotice.tsx`), never rendered on the
softer alternative-route branch.

## 3. Project partition — chromium excludes mobile, mobile runs only mobile

`npx playwright test --list --project=chromium`: **49 tests in 4 files**
(`dark-mode.spec.ts`, `i18n.spec.ts`, `smoke.spec.ts`, `twelve.spec.ts`) —
`mobile-wallet.spec.ts` correctly absent. `--project=mobile-firefox-android`:
**5 tests in 1 file** (`mobile-wallet.spec.ts`) — nothing else. `ls
frontend/e2e/*.spec.ts` lists exactly 5 files, all five accounted for above,
so `testIgnore: /mobile-wallet\.spec\.ts/` did not silently drop any
previously-running test from the desktop project. 49 + 5 = 54, matching the
unfiltered full run (54 passed) and the commit's own claim exactly.

## 4. `e12-wallet-check.sh` §8c — negative-tested fresh, not trusted

Baseline: 22/22 green. Then, one at a time, each mutation applied, the gate
re-run, and the file(s) restored via `git checkout --` with `git status
--porcelain` confirmed clean before the next case (final state: `docs/`,
`frontend/public/wallets.json` both diff-clean against `7c29605`'s tree):

| Mutation | Result |
|---|---|
| `{url}` placeholder stripped from phantom's `browse` (both copies, kept identical) | **FAILED**, exit 1, `phantom: browse template is missing {url}` |
| One copy drifted (query param appended to solflare's `browse` in `frontend/public/wallets.json` only) | **FAILED**, exit 1, caught by both the pre-existing byte-identical check and §8c's own diff |
| Malformed JSON (`{not valid json`) in both copies | **FAILED**, exit 1 — fails closed, but the failure surfaces as an unhandled Python traceback dumped to stdout, and the run's OTHER json-consuming check ("Glow entry ... android link") also throws and is misreported as a content defect rather than a parse failure. Correct end result (gate fails), poor diagnostic quality. **WARNING**, not a correctness gap. |
| `docs/wallets.json` removed entirely | **FAILED**, exit 1 — fails closed (`one or both ... is missing` fires correctly), same downstream traceback-quality caveat on the later checks that don't reach the file guard |
| `browse: null` on phantom (both copies) | **HOLDS**, exit 0 — correct, not a gap: the script's `if br is None: continue` and the app's `typeof w?.browse === "string"` filter treat null identically to absent; neither renders a broken button |

The commit's own claim ("negative-tested both ways — a stripped placeholder
and a drifted copy each fail the gate") is **confirmed true**, and the round
went further, probing failure modes the commit did not claim to have tested
(malformed JSON, absent file, `null`) — all fail closed or correctly pass, as
appropriate.

## 5. `docs/wallets.json` / `frontend/public/wallets.json`

Confirmed byte-identical (`diff` empty) and confirmed **absent** from
`git diff --stat 973d52d 7c29605` — this commit did not touch either file.

## 6. BACKLOG.md / docs/shipped.md F95 rows — overclaim check

Both rows read, in full, and both explicitly carry the two disclosures asked
for:

- *2-of-5 endorsement residual:* "a captioned randomised 2-of-5 subset still
  means only Phantom and Solflare ever get a one-tap button (Sentinel's own
  reading, and I agree with it)."
- *Chromium-not-Gecko:* "the e2e project emulates the DETECTION path on
  Chromium; it cannot prove the Gecko handshake fails, which stays a
  real-device property."

Neither row presents F95 as fully closed; both are marked with explicit ⚠
caveats rather than a bare 🟢. **Not overclaiming.**

Separately, `docs/shipped.md`'s own text honestly flags its route table as
stale: "lists 13 routes and has not been reconciled since;
`/get-app`, `/glossary`, `/onboarding`, `/twelve*`, `/settings-security` and
`/wallet` are all live and absent from it." Independently confirmed accurate
by reading the table (header literally says "13 routes") and cross-checking
against `frontend/e2e/helpers.ts`'s `ROUTES` constant, which lists all six
missing routes among others. This is real, pre-existing (not introduced by
`7c29605`), and honestly disclosed rather than silently left. Recorded below
as a carried WARNING — it is Layer E docs-drift that must shrink in a coming
round, though reconciling it is explicitly out of this test-only commit's
stated scope.

## 7. Re-run results

- `npx tsc --noEmit`: clean, exit 0.
- `npx playwright test`: **54 passed** (49 chromium + 5 mobile-firefox-android,
  against `https://aha.a13z.org:8443`), matching the commit's claim exactly.
- `tests/sentinel/e12-wallet-check.sh`: 22/22.
- `tests/sentinel/gate-check.sh`: 13/13.
- `tests/sentinel/glossary-check.sh`: 10/10.
- `tests/sentinel/privacy-sweep.sh`: 5/5.
- `programs/`/`circuits/` confirmed untouched; `anchor test` correctly
  skipped, as stated in the task.
- `npm run build` (local): fails on node 18 (Next requires >=20) —
  pre-existing environment limitation, not a regression, not re-litigated
  here since this commit changes no application code the build would exercise
  differently.

An incidental, out-of-scope finding surfaced by this round's own tooling (the
throwaway `npm install` inside the node:20 mutation-testing container),
unrelated to `7c29605`'s diff and reverted (`git checkout --
frontend/package-lock.json`) before proceeding: `frontend/package-lock.json`
was pinned to version `0.7.7` while `frontend/package.json` declares `0.8.1`
— pre-existing drift, not this commit's doing, noted for completeness rather
than investigated further (out of this round's scope).

## Regressions

**None found.** No functional regression, no privacy-invariant regression, no
Traditions violation attributable to `7c29605`. This is a test/config/docs-only
commit and it does what it says: it closes the coverage gap the previous
round identified, and the closure itself withstands adversarial mutation
testing rather than merely reading green.

## Privacy-invariant status (relevant subset for this commit's surface)

| # | Assertion | Status |
|---|---|---|
| — | Faucet/sponsor/message/roster/hidden-content invariants (1–7) | N/A — untouched by this commit; no code in this diff touches any of them |
| extra | The new committed test suite genuinely proves (not just asserts) same-origin-only fetch, no third-party contact | ✔ (§1, mutation-confirmed this round, closing t6-shuffle's WARNING) |
| extra | Shuffle/gating logic's committed test coverage is now capable of catching a code regression, not just tracking data | ✔ (§1) |

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found. The underlying T6 (no endorsements) tension carried from the
prior round — a captioned, shuffled 2-of-5 subset still hands only Phantom
and Solflare a one-tap button — remains open, disclosed honestly in both
BACKLOG.md and docs/shipped.md (§6), and is a product question, not a defect
of `7c29605`, which is purely about test coverage and does not touch the
gating logic itself.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched by `7c29605` or
by this round.

## Coverage gaps (must shrink each round)

1. **Closed this round** (was WARNING #2 in `NRR-2026-08-14-t6-shuffle.md`):
   the mobile fetch/shuffle/gating path now has committed, repeatable,
   mutation-tested coverage (`mobile-wallet.spec.ts` + the
   `mobile-firefox-android` project).
2. **Closed this round** (was WARNING #3): `e12-wallet-check.sh` §8c now
   covers the `browse` field, independently negative-tested.
3. **Closed this round** (was WARNING #4, carried from wallet-mobile): BACKLOG
   and docs/shipped.md both now carry an F95 row.
4. **New, minor, this round.** `e12-wallet-check.sh` §8c fails closed on
   malformed/absent `wallets.json` but with an unhandled Python traceback and
   a misattributed co-failure message rather than a clean diagnostic. Not a
   correctness gap (the gate still correctly fails), but worth a small
   robustness pass (catch `json.JSONDecodeError`/`FileNotFoundError` and print
   one clear line) so a future maintainer isn't misled by the "Glow entry
   missing android link" line when the real cause is a parse failure.
5. **Carried, pre-existing, not new to this commit.** `docs/shipped.md`'s
   route table lists 13 routes and omits 6 live ones
   (`/get-app`, `/glossary`, `/onboarding`, `/twelve*`, `/settings-security`,
   `/wallet`); F93 and F94 also shipped without dedicated route-table rows.
   Honestly disclosed by the commit's own author; not this commit's mandate
   to fix; must shrink in a coming round per the docs-drift discipline.
6. **Carried, pre-existing, not new to this commit, out of scope.**
   `frontend/package-lock.json` (0.7.7) has drifted from
   `frontend/package.json` (0.8.1). Surfaced incidentally by this round's own
   mutation-testing tooling, not investigated further here.
7. **Carried, disclosed, not a defect.** The T6 2-of-5 endorsement tension
   (§6, Traditions check) — open product question, not this commit's to
   resolve.

## Verdict rationale

This commit does exactly what it says on the tin, and — unlike the coverage
gap it exists to fix — its own new tests were checked, not trusted. Each of
the three privacy/correctness properties the mobile banner test file claims
to prove was deliberately broken in a throwaway copy of the app and watched
turn red, then reverted; the production deployment was never touched in the
process. The new `e12-wallet-check.sh` section that guards against a broken
wallet deep-link was pushed harder than the author's own claim — beyond the
two cases they tested, this round also fed it malformed JSON, a missing file,
and a null field, and it did the right thing in every case, even though one
of its failure messages is uglier than it should be. The two BACKLOG/docs
rows say plainly what is NOT yet fixed (only two of five wallets ever get a
one-tap button; this cannot prove real Firefox works, only that the app
detects it correctly) rather than claiming more than is true. Nothing here
rises to a privacy violation, a broken feature, or a misleading claim. The
WARNINGS are small and mostly inherited from before this commit: a docs
table that still needs reconciling, a diagnostic message that could be
cleaner, and an honestly-disclosed product tension about how many wallets get
a one-tap button — none of them block trusting this commit's own claim that
the coverage gap is now closed.
