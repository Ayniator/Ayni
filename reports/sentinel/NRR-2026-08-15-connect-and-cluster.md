# Non-Regression Report — 2026-08-15 — Round connect-and-cluster

Verdict: **PASS WITH WARNINGS**

Scope: three commits reviewed —

- `ba6f891` feat(wallet): the connect button says "Connect" and carries the Solana mark
- `5030153` fix(ui): drop Testnet from the cluster box; tell iOS the truth about connecting
- `0c6bb24` test(ui): cover the cluster box and all three mobile-banner tones

**SHA correction, made and verified during this round.** The brief named the
third commit `535a316`. Mid-round the requesting session reported that
`535a316` had been created with a bare `git commit` while F59's incomplete
on-chain instruction files (`programs/ayni/src/month.rs`,
`instructions/attest_presence_zk.rs`, edits to `state.rs`/`errors.rs`/`lib.rs`)
were staged in the index, so the whole index went into a commit whose message
describes only frontend tests. It was reset (`git reset --mixed HEAD~1`) and
re-committed as `0c6bb24`, containing only the two e2e spec files. **This round
did not take that report on faith** — it independently confirmed, by `git`
inspection alone:

- `git merge-base --is-ancestor 535a316 HEAD` → **not an ancestor**: `535a316`
  is a dangling object, not part of branch history.
- `git show --stat 0c6bb24` → exactly two files,
  `frontend/e2e/network-selector.spec.ts` and
  `frontend/e2e/wallet-notice-tone.spec.ts`.
- `git diff 535a316 0c6bb24 -- <both spec files>` → **empty**: content is
  byte-identical between the two commit objects.
- The F59 work-in-progress files are present on disk, uncommitted, at round
  end (see Coverage/Process section) — confirmed both before and after this
  round's own work, and not touched by any command this round issued.

`0c6bb24` is used throughout this report and in `REVIEWED.md`. `535a316` no
longer names anything the branch will ship.

Commit `0c6bb24` (HEAD at round end): `0c6bb244206f8ee2bf7a0b41449e55646666f0fc`.
Previous baseline: `reports/sentinel/NRR-2026-08-14-f95-coverage.md`
(`68be50d`).

None of the three reviewed commits touch `programs/`, `circuits/`, or the
on-chain program — confirmed by `git show --stat` on each and by
`git diff --stat -- frontend/` reading empty against HEAD at every checkpoint
of this round.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | tsc, npm audit, dep diff | tsc clean; 28 pre-existing vulns (0 new, no dep changes in scope) | 0 | 0 |
| B — API/security gates | gate-check.sh, e12-wallet-check.sh | 13 + 23 | 0 | 0 |
| C — Proof/contract | n/a — no `programs/`/`circuits/` change in scope | — | — | — |
| A — UX/e2e (Playwright) | full suite, 8 files, 2 projects | 66 | 0 | 12 (wallet-button.spec.ts ×4, network-selector.spec.ts ×3, wallet-notice-tone.spec.ts ×5) |
| A — Independent mutation testing | 2 source mutations, own choice (not the author's) | 2/2 confirmed red on the intended assertion only | 0 | 2 |
| D — Privacy/Traditions sweep | privacy-sweep.sh, grep sweep, third-party-request e2e | 4/5 checks clean | 1 (false positive, see below) | 0 |

## Regressions

**None found in the three reviewed commits.** No functional or privacy
regression is attributable to `ba6f891`, `5030153`, or `0c6bb24`.

## Findings (non-regression, by severity)

### WARNING — `noticeTone()`'s pre-existing iOS detection has a real, narrow false-positive message mismatch
Epic: E12 (mobile wallet connect). Not introduced by this round — `isIOS()`'s
touch-Mac detection (`/macintosh|mac os x/i.test(ua) && maxTouchPoints > 1`)
was introduced in `04251ca`, untouched by `5030153`/`0c6bb24`. The decision
tree in `noticeTone()` (`frontend/lib/mobileWallet.ts`) is exhaustive over
every state `shouldOfferWalletBrowser()` reaches (`isMobile() &&
!isInWalletBrowser()`): `mwaWillHang()` → `"broken"`, else `isIOS()` →
`"only-route"`, else → `"alternative"`. But a **desktop Mac with a
touch-capable display** (`maxTouchPoints > 1`) is misclassified `isIOS() ===
true`. If that machine also has a wallet browser extension installed (Phantom,
Solflare, etc. — the ordinary desktop connect path), it would be shown:
"No iOS browser can reach a Solana wallet directly ... opening this site
inside your wallet is the only way" — which is **false** for it: the
extension path is exactly the thing being denied. This is genuinely rare
(external touch monitors on Mac are uncommon) but is precisely the
device/message mismatch the brief asked to be checked for.
Reproduction: set `navigator.maxTouchPoints = 2` and a `Macintosh; Mac OS X`
UA in a Playwright context with a `window.solana` stub, load `/`, read
`.mw-notice` text.

### WARNING — `privacy-sweep.sh`'s analytics-SDK pattern false-positives on the bare English word "plausible"
Layer D. `bash tests/sentinel/privacy-sweep.sh` (real exit code 1, not 0 —
confirmed by running it unpiped) flags:
```
✘ FAIL — no analytics/telemetry SDK
./programs/ayni/src/month.rs:54:/// producing a plausible index for it would write a nonsense month that the
```
`month.rs` is the uncommitted F59 work-in-progress the brief explicitly
forbade touching and which is not part of `ba6f891`/`5030153`/`0c6bb24`. The
match is a dictionary collision: the script's pattern lists the bare word
`plausible` (for "Plausible Analytics") rather than a domain-qualified string
like `plausible\.io`, so any English sentence using the ordinary adjective
trips it. This is **not** a real analytics reference and **not** attributable
to the three reviewed commits — none of them touch `programs/`. Recorded as a
gate-script precision defect (fix: anchor the pattern to `plausible\.io` the
way `sentry\.io` and `segment\.(com|io)` already are) rather than as a CRITICAL
for this round; verified the other four privacy-sweep checks (tracking
pixels, Anchor logging macros, `console.*` of identity material,
score/rating/rank/karma/tier/badge/count fields) are clean.

### WARNING — Coverage/docs drift: no `BACKLOG.md`/`docs/shipped.md` row for any of the three commits
Layer E. Neither the wallet-button rename+mark (`ba6f891`) nor the
testnet-drop/iOS-tone fix (`5030153`/`0c6bb24`) has an F-number or a row in
`BACKLOG.md` or `docs/shipped.md`, unlike every other shipped item in this
area (e.g. F95's row). Per this repo's own standing rule ("keep `docs/
shipped.md` and `BACKLOG.md` reconciled in the same commit as the change"),
that reconciliation did not happen. `tests/sentinel/checklist.yaml` also had
no entry for either change before this round — added now
(`CONNECT-AND-CLUSTER-COVERAGE`). Missing coverage is a WARNING in the round a
feature ships and a FAIL in the next one per the Sentinel spec; since this is
the first round to see `ba6f891` (an earlier round covering it was killed
before it wrote anything) and the first to see `5030153`/`0c6bb24`, WARNING is
correct this round — **a FAIL next round if the checklist/docs gap is not
closed**.

### WARNING (process) — a mis-scoped commit reached the branch under a misleading message, caught by chance
Not a defect in `ba6f891`/`5030153`/`0c6bb24`'s actual content, but a process
finding requested explicitly for this round. `535a316` was produced by a bare
`git commit` while F59's incomplete on-chain files were staged in the index,
so a commit whose message reads `test(ui): cover the cluster box and all
three mobile-banner tones` in fact carried `programs/ayni/src/errors.rs`,
`instructions/attest_presence_zk.rs`, `lib.rs`, `month.rs`, and `state.rs`
alongside the two intended test files. It was caught by the author noticing
`git status` was unexpectedly empty — not by any check. Verified: neither
`gate-check.sh` nor `privacy-sweep.sh` nor the checklist mechanism reads
commit-message-vs-diff coherence, so nothing in this repo's current tooling
would have caught a "frontend test commit" that silently carries
`programs/`-tree changes; only a human (or a Sentinel round doing `git show
--stat` on the commit before trusting its message) catches it. This is
exactly the kind of thing the round-review discipline exists for, and it
worked — but by inspection, not by an automated gate. Recommend (not
performed here, per "never fix code"): a lightweight pre-commit or gate check
that flags a commit whose subject says `frontend`/`test(ui)`/etc. while its
diff touches `programs/` or `circuits/`.

## Privacy-invariant status (Layer D, this round's actual surface)

This round's scope is three frontend commits with no server/database/chain
component, so the full seven-point Layer D adversarial dump (sponsor
identity, trust lists, messages, biometrics, circle rosters, hidden content,
faucet parrain-links) is unchanged by anything reviewed here and was not
re-run from scratch (no code under those systems changed). What was checked,
adversarially, against the actual diff surface:

1. **No third-party contact from the mobile banner.** ✔ — the
   `mobile-firefox-android` project's "mounting the notice contacts no
   third-party host" test asserts `.mw-notice` is **visible** before checking
   network traffic (so it cannot pass by vacuum), and it passed clean in the
   full 66/66 run. Independently re-confirmed non-vacuous by this round's own
   mutation test: injecting an `is-warning`-forcing mutation into the same
   component (`MobileWalletNotice.tsx`) was caught by a *different* assertion
   in the same file family, showing the suite genuinely exercises this
   component rather than skipping it.
2. **No persistence.** ✔ — grepped `WalletButton.tsx`, `NetworkSelector.tsx`,
   `MobileWalletNotice.tsx`, `mobileWallet.ts` for `localStorage`/
   `sessionStorage`/`indexedDB`/cookie writes: none. The banner's own footer
   copy ("Nothing here is stored or sent anywhere") matches the code.
3. **No identifier derived from the user agent.** ✔ — `mobileWallet.ts`'s UA
   reads (`isAndroid`, `isIOS`, `mobileBrowser`, `mwaWillHang`, `noticeTone`)
   all return small enums (`"broken"|"only-route"|"alternative"`,
   `"firefox"|"chromium"|"other"`, booleans) used only to pick copy; none is
   logged, sent, or hashed anywhere in the reviewed diff.
4. **T6 (no endorsements), residual re-confirmed.** ✔ shuffle,
   ⚠ residual unchanged. `docs/wallets.json` and `frontend/public/
   wallets.json` remain byte-identical (`md5 9e8506499fbe66c3e8cf44bc1004e011`
   both). Only `phantom` and `solflare` publish a `browse` template, so
   `walletBrowserLinks()`'s uniform Fisher–Yates shuffle draws over a
   **2-item** set, not the vetted 5 — same disclosed 2-of-5 endorsement
   tension carried forward from the F95 round, not introduced or worsened by
   this round's commits.
5. **Forbidden-pattern sweep.** 4/5 clean; the 1 failure is the `"plausible"`
   false positive above, in out-of-scope uncommitted code (see WARNING).
   No `score|rating|rank|karma|tier|badge|count` field found in any file
   touched by the three reviewed commits.

## Traditions check

No ranking, comparison, aggregation, sponsor-naming, or relationship-leak
found in `ba6f891`/`5030153`/`0c6bb24`. T6 (no endorsements) residual restated
above (⚠, disclosed, unchanged, not new this round).

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched. `tests/sentinel/
checklist.yaml` gained one new entry (`CONNECT-AND-CLUSTER-COVERAGE`) —
addition, not a silent edit of an existing baseline.

## Coverage gaps (must shrink each round)

- `ba6f891`/`5030153`/`0c6bb24` have no `BACKLOG.md`/`docs/shipped.md` row
  (WARNING above) — will be a FAIL next round if not closed.
- `docs/shipped.md`'s route table remains stale (13 listed vs. live routes),
  pre-existing, carried forward again, unrelated to this round.
- `privacy-sweep.sh`'s bare-word `plausible` match is a standing gate-quality
  gap, not fixed by this round (Sentinel does not fix code).
- No automated check catches a commit whose message and diff scope disagree
  (see process finding above) — a real, currently-uncovered gap.

## What was independently verified this round (not taken on the commits' own word)

- **Mutation testing, this round's own choice of assertions** (not the
  author's own two, which were already re-verified as still-red-then-green in
  the commit message but not by this session): removed `disabled` from the
  `mainnet` `<option>` in `NetworkSelector.tsx`, and hardcoded
  `MobileWalletNotice`'s class to always include `is-warning`. Rebuilt
  `frontend-frontend-1` (`docker compose up --build -d frontend`), confirmed
  **exactly 2 failed / 6 passed** — "mainnet is present but not selectable"
  and "is not styled as a warning" (Android Chrome) — no other test in either
  file moved. Reverted both files (diff against pre-mutation copies confirmed
  clean), rebuilt again, confirmed 8/8, then ran the full 66/66 suite to
  confirm the deployment was left exactly as found. `git diff --stat --
  frontend/` reads empty against HEAD at the end.
- Full Playwright suite: **66/66**, matching `0c6bb24`'s claimed count exactly
  (58 chromium + 4 wallet-button + 3 network-selector + 5 wallet-notice-tone
  in chromium, minus overlap accounted for — precisely `--project chromium`
  61 + `--project mobile-firefox-android` 5).
- `npx tsc --noEmit`: clean.
- `tests/sentinel/gate-check.sh`: 13/13. `tests/sentinel/e12-wallet-check.sh`:
  23/23 (wallets.json byte-identity, store links, browse templates all held).
- `npm audit`: 28 pre-existing vulnerabilities (12 low/6 moderate/10 high),
  confirmed via `git diff --stat` that neither `package.json` nor
  `package-lock.json` changed across `ba6f891..0c6bb24` — none new, none
  attributable to this round.
- Confirmed at round end that the F59 work-in-progress files
  (`programs/ayni/src/month.rs`, `instructions/attest_presence_zk.rs`,
  `instructions/clear_presence.rs`, and modifications to `errors.rs`,
  `instructions/mod.rs`, `lib.rs`, `state.rs`) are present on disk,
  uncommitted, and untouched by any command this round issued — `git status
  --short -- programs/` was checked before and after this round's work; the
  files visibly continued to evolve (new file `clear_presence.rs`, `lib.rs`
  growing from the single line seen at round start to 58 inserted lines)
  during the round from activity outside this session, consistent with this
  repo's disclosed shared-identity multi-session setup, never from a command
  this session ran. No `checkout --`, `stash`, `clean`, or `reset` was
  executed by this round.

## Verdict rationale

Everything asked of this round works as claimed: the connect button really
does say "Connect" and carry the Solana mark, the cluster box really can never
render blank, and the three-tone mobile banner really does say a different,
correct thing to an iPhone than to an Android Chrome phone than to an Android
Firefox phone — all 66 automated checks pass, including 12 new ones added in
this same round to close a gap where two real behaviour changes had shipped
with no test reading them. This round also broke the code on purpose, twice,
in places the original author's own testing did not target, and watched the
right tests turn red before putting everything back exactly as it was. Nothing
here leaks a name, a sponsor, a relationship, or ranks a member. The reason
this is "PASS WITH WARNINGS" rather than a clean PASS: a mid-round mix-up
briefly put unfinished on-chain code into a commit that was supposed to be
test-only (caught and fixed before this report, not a live problem), the
banner has one narrow, pre-existing case (a touch-screen desktop Mac) where it
could say something false, the paperwork trail (BACKLOG.md, docs/shipped.md)
for these three commits hasn't been written yet, and one of Sentinel's own
alarm scripts cried wolf at the ordinary English word "plausible" sitting in
someone else's unfinished work. None of these rises to a broken feature or a
privacy leak; all of them are named here so they get fixed rather than
forgotten.
