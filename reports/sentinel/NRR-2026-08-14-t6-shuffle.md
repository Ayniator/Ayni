# Non-Regression Report — 2026-08-14 — Round t6-shuffle

Verdict: **PASS WITH WARNINGS**

Scope: **exactly one commit**, briefed and independently re-verified, not
accepted on the author's word:

- `973d52d` fix(wallet,e2e): shuffle the mobile banner's wallets; split the
  menu contract

Out of scope (already covered by prior rounds, not re-reviewed here): `b10bae9`,
`04251ca`, and everything earlier. Confirmed by reading
`reports/sentinel/NRR-2026-08-14-wallet-mobile.md` (PASS WITH WARNINGS,
scope `b10bae9`/`04251ca`) and `REVIEWED.md`'s entries for both.

Commit under review at HEAD: `973d52d3b18a2db2567c8c953e9e884c96b38832`.
Previous baseline (registered in `REVIEWED.md`): `04251ca` /
`NRR-2026-08-14-wallet-mobile.md`.

**`programs/` and `circuits/` are untouched by this commit** —
`git diff --stat fcca146 973d52d -- programs/ circuits/` is empty (`fcca146`
is the sentinel bookkeeping commit immediately preceding this one, and the
diff against it captures the same content as against `04251ca`). `anchor
test` is therefore **skipped, explicitly**: there is nothing on-chain this
commit could have disturbed.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| `npx tsc --noEmit` (frontend) | 1 | 1 | 0 | re-run, clean |
| Full `npx playwright test` (deployed site, aha.a13z.org:8443) | 49 | 49 | 0 | re-run, matches commit's own 49/49 claim |
| Standalone shuffle stress test (real code, real data file, not trusted on the commit's word) | 200,000-iter run + 5×100,000-iter repeats | uniform, no directional bias | — | new this round |
| Live device-emulated Playwright (Pixel 7 UA) — banner fetch scope, shuffle rendering, fetch-failure behaviour | 2 ad hoc probes, run and discarded (not committed) | 2 | 0 | new this round |
| `tests/sentinel/e12-wallet-check.sh` | 22 | 22 | 0 | re-run |
| `tests/sentinel/no-third-party-assets-check.sh` | 4 | 4 | 0 | re-run |
| `tests/sentinel/privacy-sweep.sh` | 5 | 5 | 0 | re-run |
| `tests/sentinel/glossary-check.sh` (cheap, out of this commit's functional scope but touches the same nav) | 10 | 10 | 0 | re-run |
| `tests/sentinel/gate-check.sh` | 13 | 0 fail | 13 | re-run |
| `diff docs/wallets.json frontend/public/wallets.json` + `sha256sum` | 1 | 1 | 0 | re-run, byte-identical confirmed both ways |
| `git diff --stat -- programs/ circuits/` | 1 | 1 | 0 | confirmed empty, `anchor test` correctly skipped |
| Deployed-container verification (`docker exec`) | 1 | 1 | 0 | image built/started 20:49:22Z, contains new banner copy, fetch call, both `browse` fields |
| `npm run build` (local, node 18) | 1 | — | pre-existing fail | confirmed environment-only (Next requires >=20), not a regression |

## 1. T6 / Tradition 6 — is the shuffle actually uniform and unlinkable?

**Verified, not accepted.** Read `frontend/lib/mobileWallet.ts`'s `shuffle()`
(lines 108–120): a textbook in-place Fisher–Yates, the loop index runs from
`length-1` down to `1`, `j = Math.floor(Math.random() * (i+1))` — correct
bounds, no off-by-one that would bias the last element (a common Fisher–Yates
bug). The only randomness source anywhere in the function is `Math.random()`.

`shuffle()` is called as `shuffle(usable)` with `usable` being the array
filtered from the `wallets` argument — nothing else is passed in. No
`Date.now()`, `performance.now()`, `navigator.*`, wallet address, membership
commitment, locale, or user-agent value reaches the shuffle or is used to
choose a starting index. This satisfies "never seeded by, correlated with, or
derived from anything member-linkable" by direct code inspection, not
inference.

**Stress test — independently reproduced, not read off the commit message.**
The commit claims "measured over 100,000 loads: 50.32% / 49.68% first
position." I did not accept that number; I copied the exact `shuffle()` body
and `walletBrowserLinks()`'s filter logic out of the real file (it can't be
`require()`d directly — it's TypeScript with browser-only helpers like
`here()`/`refOrigin()` that reference `window`), ran it against the real
`frontend/public/wallets.json`, and drove it 200,000 times:

```
usable wallets: [ 'phantom', 'solflare' ]
phantom    position counts: 50.159%  49.841%
solflare   position counts: 49.841%  50.159%
```

Then 5 independent repeats of 100,000 iterations each, to check the commit's
number wasn't a fluke run I was failing to reproduce: `49.995%, 50.069%,
49.975%, 50.063%, 49.983%` (phantom-first). All five land inside ±0.07 points
of 50/50, in both directions — no consistent skew. The commit's own claimed
50.32/49.68 is a slightly larger deviation than any of my five runs but is
still well within ordinary sampling variance for n=100,000, p=0.5
(σ≈0.158pts, so 0.32pts is ~2σ, roughly a 1-in-20 run) — plausible, not
alarming, and specifically **not** treated as self-certifying: this section's
conclusion rests on my own 6 independent runs (1×200k + 5×100k), not on the
commit's single reported number.

**`browse` gating.** Confirmed by `diff` (empty) and `sha256sum` (identical
digest) that `docs/wallets.json` and `frontend/public/wallets.json` are
byte-identical. Confirmed `browse` exists on exactly `phantom` and `solflare`
in that file, absent on `glow`/`trust`/`jupiter`. Confirmed in code
(`walletBrowserLinks`'s filter: `typeof w?.browse === "string" && !!w.id &&
!!w.name`) that an absent `browse` field removes a wallet from the array
*before* any href is built — there is no code path that would construct a
broken link for glow/trust/jupiter, because they never reach the `.map()`
step. Confirmed live: a Pixel-7-emulated Playwright run against the deployed
site rendered exactly two buttons, "Open in Solflare" and "Open in Phantom"
(order varies by load — a rendered instance of the shuffle actually
executing, not just present in source).

**Endorsement judgement, asked for honestly, not agreed with reflexively.**
The copy change and the shuffle are both real, substantive fixes — not
cosmetic. The shuffle removes the fixed-order-favouritism defect the previous
round flagged, and the caption is accurate about *why* the list is short. But
I do not think the caption fully discharges the concern. Whatever the order
and whatever the caption says, a mobile visitor at that exact moment sees
**one-tap "Open in X" buttons for exactly two brands** — Phantom and Solflare
— every single time, and never for Glow, Trust Wallet, or Jupiter, regardless
of session. The gating property (does the wallet publish a `browse` universal
link at all) is genuine and non-arbitrary, which is the material difference
from the prior round's defect (an arbitrary-looking hardcoded pair with no
stated reason and no shuffle). So this is a **narrower, disclosed, and
randomised** version of the same underlying shape, not the same violation —
but "listed in random order, not a recommendation" is doing more rhetorical
work than the UI itself does: three of five vetted wallets structurally
cannot ever appear there. I record this as an open, non-CRITICAL, disclosed
tension for a product decision, not as a defect of this commit.

## 2. Privacy properties of the new `fetch("/wallets.json")`

Confirmed same-origin, static, no member data, by two independent means:

1. **Static read.** The only fetch in `MobileWalletNotice.tsx` is
   `fetch("/wallets.json")` — a relative path, no query string, no headers,
   no body, default GET. `walletBrowserLinks()`'s two dynamic inputs (`url`,
   `ref`) come from `window.location.href` / `window.location.origin` and are
   used only to build the outbound `href` on each wallet's own domain
   (`phantom.app`, `solflare.com`) — not sent to `/wallets.json` itself.

2. **Live exercise**, because the existing `smoke.spec.ts` "no third-party
   requests on page load" test runs on Playwright's Desktop Chrome project
   only (`playwright.config.ts` defines exactly one project, no mobile
   emulation), and `shouldOfferWalletBrowser()` is `isMobile() &&
   !isInWalletBrowser()` — **false on that desktop UA**. So the existing test
   passing does **not** actually exercise this new fetch path at all; the
   `useEffect` returns before `fetch` is ever called on a desktop context.
   This is flagged as a genuine coverage gap below, not silently assumed away
   by reading the green checkmark.

   To close that gap for this round only (not committed — ad hoc, per the
   Sentinel spec's "never modify application code or weaken/add committed
   tests without it being this round's explicit job"), I ran two throwaway
   Playwright probes with `devices["Pixel 7"]` against the deployed site:
   - Request log during page load, filtered through the same
     `isExpectedHost()` helper the real smoke test uses: **zero** foreign
     hosts, and exactly one request to `/wallets.json` on the app's own host.
   - `page.route("**/wallets.json", route => route.abort())`: the banner
     (`.mw-notice`) does **not** render — confirming there is no hardcoded
     fallback list and the `.catch(() => {})` really does leave the UI
     silent on failure, not degrade to something stale or wrong.

   Both files were deleted after the run; nothing was committed.

## 3. The e2e split — genuine fix, not a weakened test

Diffed `973d52d`'s `frontend/e2e/twelve.spec.ts` against its parent
(`fcca146`) directly. Findings:

- `DESTINATIONS` (2 entries, both roles) → `MENU_DESTINATIONS` (3, incl.
  `/glossary`) and `TWELVE_PAGES` (2). Both are still fixed-length literal
  `as const` arrays — not derived from a count, not open-ended.
- Nav-menu test: `toHaveCount(2)` → `toHaveCount(MENU_DESTINATIONS.length)`
  (still 3, still an exact count, not `toBeGreaterThanOrEqual` or similar);
  `expect(hrefs).toEqual([...DESTINATIONS])` →
  `expect(hrefs).toEqual([...MENU_DESTINATIONS])` — still full array equality
  (order and membership both asserted), not a subset/`.toContain()` check.
- Hub-page test: `toHaveCount(2)` → `toHaveCount(TWELVE_PAGES.length)` (still
  2); href equality against `TWELVE_PAGES`, same exact-equality shape.
- The "12 numbered items" loop changed its iteration source from
  `DESTINATIONS` to `TWELVE_PAGES` — still 2 iterations, still asserting
  `toHaveCount(12)` on `ol > li` for each, unchanged. Glossary was **not**
  folded into this loop (it would have asserted 12 numbered items on a page
  that has none — that would have been the weakening move, and it was not
  taken).

No assertion strength was reduced anywhere in the diff. This is a genuine
contract fix: the nav and the /twelve page now legitimately disagree (3 vs
2), and the test was reshaped to assert both facts precisely rather than
either lying about one of them or being loosened to tolerate both.

## 4. `/twelve`'s two doors and the documented asymmetry

Confirmed live and via the passing e2e test: `/twelve` renders exactly 2
`a.twelve-door` elements, hrefs `["/twelve-steps", "/twelve-traditions"]`.
The Resources nav dropdown offers 3 (`/twelve-steps`, `/twelve-traditions`,
`/glossary`). Glossary is reachable from the nav but **not** from the page
the nav's own "The 12" label links to. This is real, reproduced, and was
written into the spec as a comment rather than silently resolved in either
direction. Recorded here, per the task, as an **open product question**, not
a defect of this commit.

## 5. Re-run results

- `npx tsc --noEmit`: clean, exit 0.
- `npx playwright test`: **49 passed** (2 workers, against
  `https://aha.a13z.org:8443`), matching the commit's own claim exactly.
- `tests/sentinel/glossary-check.sh`: 10/10 (cheap, unrelated to this
  commit's functional scope but touches the same nav surface — run for
  completeness).
- `tests/sentinel/gate-check.sh`: 13/13.
- `tests/sentinel/e12-wallet-check.sh`: 22/22, including the byte-identical
  `wallets.json` check and store-link liveness (store `links`, not the new
  `browse` universal links — see Coverage gaps).
- `tests/sentinel/no-third-party-assets-check.sh`: 4/4.
- `tests/sentinel/privacy-sweep.sh`: 5/5.
- Deployed container: `docker exec frontend-frontend-1` confirms
  `/app/public/wallets.json` has both `browse` fields, and
  `/app/.next/server/chunks/446.js` (and the client chunk
  `layout-e401d9bb52f9ebec.js`) contain the exact new banner copy string
  "Listed in random order — these are the wallets that publish a link we can
  open, not a recommendation." Image `sha256:e8e72582...` built/started
  `2026-08-14T20:49:22Z` — 2m20s **before** the commit's recorded timestamp
  (`20:51:42Z`). Checked deliberately rather than waved through: this means
  the image was built from the working tree before the commit was made
  (author built → verified → committed after), not from a stale prior
  commit — confirmed by content match (the container's `wallets.json` and
  banner copy match `973d52d`'s tree exactly, not `fcca146`'s). Not a
  discrepancy once checked; would have been one if the content had matched
  the *previous* commit instead.
- `npm run build` (local): fails with "Node.js 18.20.5 ... Next.js requires
  >=20.9.0" — confirmed this is the pre-existing local-environment state
  (unrelated to this commit; `package.json` declares no `engines` override
  and the same failure is present on the parent commit), not a regression.
  The docker build path is the one that matters and was verified above.

## Regressions

**None found.** No functional regression, no privacy-invariant regression, no
Traditions violation attributable to `973d52d`.

## Privacy-invariant status (relevant subset for this commit's surface)

| # | Assertion | Status |
|---|---|---|
| — | Faucet/sponsor/message/roster/hidden-content invariants (1–7) | N/A — untouched by this commit; not re-run (already covered by dedicated rounds/scripts, no code in this diff touches any of them) |
| extra | The new `fetch` is same-origin only, sends no member data | ✔ (§2) |
| extra | Failure path renders nothing, no hardcoded fallback | ✔ (§2, live probe) |
| extra | Shuffle draws only on `Math.random()`, uncorrelated with any member identifier | ✔ (§1, code + 6 independent stress runs) |

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found. T6 (no endorsements) is the specific tradition this commit
targets — see the honest-read judgement in §1: materially improved and not a
violation, but not, in my view, a fully closed question either. Recorded as
an open tension, not a finding against the commit.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched by `973d52d` or
by this round.

## Coverage gaps (must shrink each round)

1. **New, this round.** `e2e/smoke.spec.ts`'s "no third-party requests on
   page load" test runs on a desktop UA only and therefore never exercises
   `MobileWalletNotice`'s `fetch("/wallets.json")` — the property claimed in
   task item 2 is real (verified by ad hoc device-emulated probes this
   round) but is **not proven by any committed, repeatable test**. Closing
   this needs either a Pixel-7-style Playwright project/context added to the
   committed suite, or a dedicated mobile-emulated case inside
   `smoke.spec.ts`/`twelve.spec.ts`. WARNING in this round; will be a FAIL
   next round if still uncovered, per the spec's rule for aging coverage
   gaps.
2. **Carried forward, not new.** `tests/sentinel/e12-wallet-check.sh`'s
   store-link liveness check covers `links.{ios,android,web}` only, not the
   new `browse` universal-link field. A dead or malformed `browse` URL would
   not be caught mechanically today (only by the live-render probe I ran ad
   hoc this round). Should gain a check in `e12-wallet-check.sh` or a new
   script.
3. **Carried forward, not new (flagged in the wallet-mobile round, still
   true).** `frontend/lib/mobileWallet.ts` / `MobileWalletNotice.tsx` still
   has no `BACKLOG.md` F-number and `docs/shipped.md` still has no entry for
   this feature or for `973d52d`. Docs-drift, Layer E — restated so it does
   not silently age out uncounted.
4. The shuffle-stress reproduction added this round (§1) is ad hoc, not a
   committed test. `WalletChooser`'s equivalent F67 stress test is presumably
   committed somewhere in this repo's history (referenced by the prior
   round's checklist entries) — `MobileWalletNotice`'s shuffle has no
   analogous committed statistical test yet.

## Verdict rationale

This fix does what it says: the mobile banner no longer shows a fixed
"Solflare, Phantom" pair — it now shuffles, using the same coin-flip-fair
method as the rest of the app, and I checked that fairness myself with
600,000 fresh shuffles rather than trusting the number in the commit
message. The two wallets.json files are proven identical byte-for-byte, so
there's no way for the two lists to quietly drift apart. The test file split
is a real fix to a real disagreement between two pages, not a test weakened
to go green, and I confirmed that line by line. The one thing I would not
call fully settled is the honest question the author themselves raised:
captioning a two-wallet button list as "not a recommendation" is true in
spirit, but a phone user in that moment still only ever gets a one-tap button
for two of the five vetted wallets — that is a product decision worth a
second look, not a bug in this patch. Separately, the automated test suite
that is supposed to prove "no third-party leak" for this exact new network
call does not actually run in a way that touches it — I proved the property
by hand this time, but it needs a permanent test, not a one-off. Nothing here
rises to a privacy violation or a broken feature; the WARNINGS are about
tightening what proves it next time, not about anything currently wrong.
