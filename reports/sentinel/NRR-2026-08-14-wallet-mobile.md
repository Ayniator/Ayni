# Non-Regression Report — 2026-08-14 — Round wallet-mobile

Verdict: **PASS WITH WARNINGS**

Scope: **exactly two commits**, briefed and reviewed in full:

- `b10bae9` fix(sentinel-gate): revert the REVIEWED.md skip in the override path — CRITICAL
- `04251ca` fix(wallet): mobile browsers that offer Mobile Wallet Adapter and cannot finish it

Out of scope (already covered by prior rounds, not re-reviewed here): `6b95d77`,
`114f3af`, `1dfefa1`, `2f5a7c4`. `26b4b7c` (the OVERRIDES.md entry for
`b10bae9`) is pure bookkeeping — confirmed by `git show --stat 26b4b7c`
(`reports/sentinel/OVERRIDES.md` only) — and is gate-exempt; not separately
reviewed.

Commit under review at HEAD: `04251cadf8b73b1f0d584223287d2322ea3b14cb`.
Previous baseline (registered in `REVIEWED.md`): `114f3af` /
`NRR-2026-08-14-gate-fix.md` (PASS, scope `6b386d7`/`6b95d77`/`114f3af`). The
intervening commit `16bb15f` was reviewed and found **FAIL/CRITICAL** by the
focused round `NRR-2026-08-14-gate-delta.md`; that round's finding is
independently reconstructed and confirmed still correct in §1 below, and
`16bb15f` is now registered in `REVIEWED.md` for the first time (as
reviewed-and-rejected, not reviewed-and-approved).

**`programs/` and `circuits/` are untouched by both commits in scope** —
`git diff --stat 26b4b7c 04251ca -- programs/ circuits/` is empty. `anchor
test` is therefore **skipped**, explicitly: there is nothing on-chain either
commit could have disturbed. Layers C and F (proof/contract, sponsor
recovery) are N/A this round.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| Gate self-test, live (post-revert) gate | `tests/sentinel/gate-check.sh` | 13 | 0 | +1 case vs prior round's 12 |
| Gate self-test, control (16bb15f's gate) | same suite, `/tmp/gate-16bb15f.sh` | 12 | 1 (expected — proves discrimination) | re-run this round |
| Independent exploit reconstruction (real `git push`, real hook), current gate | 1 | 1 (BLOCKED, correct) | 0 | new, not the prior round's fixture |
| Independent exploit reconstruction, 16bb15f's gate | 1 | 0 (ACCEPTED — confirms the hole was real) | 1 | new, not the prior round's fixture |
| `is_reviewed()` call-site / diff-scope review | manual + grep | pass | 0 | — |
| `npx tsc --noEmit` (frontend) | 1 | 1 | 0 | — |
| Live Playwright, mobile-wallet surface (device-emulated, real UA/window.phantom, against deployed site) | 7 | 7 | 0 | **new this round**, ad hoc, not committed (see Coverage gaps) |
| `tests/sentinel/e2e-smoke-check.sh` (full deployed-site suite) | 49 | 48 | 1 | **1 failure — pre-existing, OUT OF SCOPE, not caused by either reviewed commit (see §9)** |
| `tests/sentinel/privacy-sweep.sh` | 5 checks | 5 | 0 | re-run |
| `tests/sentinel/i18n-key-check.sh` | 1051 keys | 1051 | 0 | re-run |
| `npm audit` (frontend) | — | 0 critical / 28 total | 0 | not re-derived in depth; no lockfile change in scope |
| Deployed-container verification | `docker exec` + live curl | pass | 0 | — |

## 1. Is the CRITICAL exploit actually dead? (independent reconstruction)

Yes. I did not accept the prior round's report on its word and did not simply
re-run its fixture. I built a fresh, standalone exploit from a clean clone
(`/tmp/.../gate-repro/work`, cloned from this repo at HEAD) and drove it
through a **real `git push`** against a **disposable bare-repo remote**, with
a **real installed `.git/hooks/pre-push` symlink** — not a direct invocation
of the script with synthetic stdin.

Sequence, on top of `04251ca`:
1. `EVIL` — a commit adding `programs/ayni/src/backdoor.rs`
   ("feat: quietly widen an admin key check").
2. `FORGE` — a bookkeeping-only commit self-registering `EVIL`'s short SHA in
   `reports/sentinel/REVIEWED.md` ("covered by an independent sentinel round
   (forged)").
3. `TIP` — a bookkeeping-only commit appending an unrelated decoy line to
   `reports/sentinel/OVERRIDES.md` (confirmed by `grep -c` to contain zero
   occurrences of `EVIL`'s SHA before the push).

Then, with `SENTINEL_OVERRIDE="independent repro" git push origin solana`
against the same three-commit tip:

```
=== CURRENT gate (post-revert, live at HEAD) ===
  BLOCKED: SENTINEL_OVERRIDE was set, but reports/sentinel/OVERRIDES.md does not name:
    bc00e41 feat: quietly widen an admin key check (independent repro)
  An override must account for EVERY commit it carries, not just one.
error: failed to push some refs ...
EXIT=1

=== 16bb15f's gate (same commits, same override reason) ===
  Sentinel push gate OVERRIDDEN — and recorded in reports/sentinel/OVERRIDES.md.
  Reason given: independent repro
To .../origin.git
   04251ca..a4e3a32  solana -> solana
EXIT=0
```

Confirmed after the "successful" push against `16bb15f`'s gate: `git show
a4e3a32:reports/sentinel/OVERRIDES.md | grep -c bc00e41` → **0**. The
malicious commit shipped with its SHA in zero occurrences of the one file the
override mechanism exists to make complete.

(One false start worth recording for the record, not the verdict: my first
attempt at the decoy `OVERRIDES.md` line accidentally *contained the literal
string* of `EVIL`'s own short SHA inside its own explanatory prose — "does not
mention bc00e41" — which of course then matched the gate's grep and made the
current gate wrongly look exploitable. Caught this by inspecting the grep hit
directly before trusting the result, rebuilt the decoy line without leaking
the SHA into its own text, and reran both directions cleanly as shown above.
Flagging this because it is exactly the kind of self-defeating test-authoring
mistake this task asked me not to trust on anyone's say-so, including my
own.)

**Verdict: the hole is closed on the current gate, and was real on `16bb15f`.
Independently confirmed, not merely cited.**

## 2. `is_reviewed()` scope

`grep -n is_reviewed scripts/sentinel-push-gate.sh` → exactly 3 lines: the
function definition, one comment inside the override loop explaining why the
skip is deliberately **not** re-added there, and the one real call site (the
coverage-check loop, unchanged in location from before `16bb15f`). No other
call exists. At that one call site it replaces an inline grep that was
byte-identical in pattern
(`^[[:space:]]*[-*]?[[:space:]]*($sha|$short)\b`); the only behavioural
surface added is a dead `|| echo "$1"` fallback (unreachable — `$1` is always
a resolved commit SHA from `git rev-list`) and `local` shadowing that bash
scopes correctly under `set -uo pipefail` (no `-e`) and restores on return —
this was independently re-verified by execution (a synthetic
missing-`REVIEWED.md` case still fails closed, printing the correct short
SHA from the *caller's* `short` variable, confirming no cross-contamination).
Confirmed semantic no-op.

## 3. Did the revert also undo the wanted parts of `16bb15f`?

No. `git diff 6b386d7 HEAD -- scripts/` (verified directly, not assumed):
confined to (a) the `is_reviewed()` helper addition described above, (b) the
override-loop skip removed and replaced by a comment explaining why, and (c)
the one call-site substitution in §2. Nothing else changed. Specifically
still present and unmodified in the current script:

- **Widened `BOOKKEEPING` prefix**: `'^(reports/sentinel/|tests/sentinel/)'`
  — confirmed by grep, unchanged from `16bb15f`.
- **Every-substantive-commit override requirement**: the override loop still
  iterates `pushed_commits()` with no early `break`, collecting
  `override_unnamed` across all of them — confirmed by reading the loop body,
  unchanged.
- **New-branch `changed_files()` fix**: `changed_files()` still branches on
  whether `remote_sha` is all-zero and falls back to `git log --name-only`
  against the commit's own contents instead of a bare `git diff <sha>` —
  confirmed present, unchanged.

## 4. `tests/sentinel/gate-check.sh` — 13 cases, matched pair genuinely discriminates

Ran against the live (current) gate: **13/13 pass.** Ran the same suite
against a fresh extraction of `16bb15f`'s script
(`git show 16bb15f:scripts/sentinel-push-gate.sh`): **12/13 pass, 1 fail**:

```
FAIL  forged REVIEWED.md cannot excuse an override (expected exit 1, got 0)
```

Exactly the case that must fail, and only that one. The paired "honestly
named" case ("override naming every substantive commit is allowed") **passes
on both** gate versions — confirmed by running both suites and reading both
outputs — which rules out the possibility that the discriminating case passes
merely because the current gate blocks every override unconditionally.

## 5. The pre-existing REVIEWED.md self-forgery — still open, disclosed, not hidden

**Still open on the current gate**, confirmed by execution, not assumed:
`gate-check.sh`'s "commit named in REVIEWED.md -> allowed" case (line 87) is,
itself, a self-forgery — it appends a `REVIEWED.md` line for its own fixture
commit via a bookkeeping-only commit, with no round having actually happened
— and it **passes** (exit 0, correctly "allowed" per the test's own
expectation, which is exactly the weakness). This is identical on `16bb15f`
and on the current gate; it was never introduced or removed by either
version. It defeats the **normal** (non-override) path, which is a narrower
exposure than what `16bb15f` opened on the **override** path (§1), but it is
real and it is not fixed by `b10bae9`.

Disclosure check: yes, disclosed, not hidden. `b10bae9`'s own commit message
states it in a dedicated paragraph ("The self-forgery of REVIEWED.md is
PRE-EXISTING and defeats the normal path on both versions identically...it is
a real design weakness of the registry and is left for the user to weigh, not
quietly patched in the same breath"), and `reports/sentinel/OVERRIDES.md`'s
entry for `b10bae9` repeats it verbatim under a "Still open, deliberately not
fixed here" heading. I am recording it here as a **standing open finding**,
not a new one, and not this round's fault:

> **OPEN FINDING (pre-existing, not new, not fixed):** any session that can
> commit can register any commit — including a malicious one — as "reviewed"
> in `reports/sentinel/REVIEWED.md`, because appending to that file is itself
> bookkeeping-exempt and needs no round behind it. This defeats the *normal*
> push-gate path (a PASS verdict + "every commit named in REVIEWED.md"). It
> does **not** defeat the *override* path anymore (that was `16bb15f`'s hole,
> now closed). Fixing it requires deciding what backs a registry entry — a
> signature, a required companion report file that must exist and name the
> SHA and a PASS/FAIL verdict, or explicitly accepting the gate as a speed
> bump rather than a lock. This is the user's decision to make, not
> Sentinel's or the implementing agent's to patch silently.

## 6. Privacy invariant — `frontend/lib/mobileWallet.ts`

Confirmed by grep across both new files
(`frontend/lib/mobileWallet.ts`, `frontend/components/MobileWalletNotice.tsx`)
for `fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|
WebSocket|axios|console\.(log|info|warn|error)|analytics|gtag|mixpanel|
posthog|segment|sentry`: **zero hits**. The only two functions that read
`navigator.userAgent` (`mobileBrowser()`, `isInWalletBrowser()`'s UA
fallback) are pure, synchronous, return-only functions with no side effect.
Confirmed nothing else in `frontend/` imports `lib/mobileWallet.ts`
(`grep -rln "mobileWallet" frontend --include='*.ts' --include='*.tsx'` finds
only the two new files and the one import site in `app/layout.tsx`) — so the
UA read feeds no shuffle (`WalletChooser`'s shuffle draws from `Math.random()`
alone, confirmed by reading it, and is in a different, unmodified file), no
analytics, and no chain call. Confirmed live, not just by reading: a
Playwright run with a real injected `window.phantom` provider on a
Firefox-Android UA correctly suppressed the banner (the injected-provider
check, which reads no chain state, wins over the UA hint) with no network
request or storage write observed for that decision.

## 7. Tradition 6 / anti-endorsement — WARNING, not waved through

**This is a legitimate finding, not brushed off.** The banner in
`MobileWalletNotice.tsx` hardcodes exactly two wallets by name — Solflare and
Phantom — in a fixed order (`walletBrowserLinks()` always returns Solflare
first), with **no code-level rationale anywhere in either new file** for why
the other three vetted wallets in `docs/wallets.json` (Glow, Trust Wallet,
Jupiter) are absent.

This sits in real tension with the project's own established anti-endorsement
mechanism. `WalletChooser.tsx` (F67) exists, in its own words, precisely to
avoid this shape of problem: *"T6 (no endorsements): the list is shuffled
with a UNIFORM Fisher–Yates on every mount, so no wallet ever holds a
permanent first position... There is no 'recommended' wallet."*
`docs/wallets.json`'s own header comment says the same: *"Order here is NOT
the display order... so no wallet holds a permanent first position (Tradition
T6 — no endorsements)."* Against that precedent, `MobileWalletNotice.tsx`:

- names only 2 of the 5 vetted wallets, permanently, in source;
- gives Solflare a fixed, non-random first position on every render;
- states no technical reason (e.g. "only these two support a universal
  browse-link scheme") anywhere in its comments — which may well be true, but
  is not disclosed, so a reader cannot distinguish "deliberate, justified
  narrowing" from "two wallets happened to be top of mind."

**Judgment: this is a real WARNING, not CRITICAL.** It does not rank, score,
or compare *members*, name a sponsor, or leak a relationship — the Prime
Directive's specific tripwires are about people, and this is about
third-party software vendors, so it does not force a FAIL under this
project's own severity rules. But actual Tradition Six is literally about an
AHA circle not lending its name/endorsement to an outside enterprise, and the
project has already built and documented infrastructure specifically to keep
wallet mentions non-preferential. This commit re-introduces the exact pattern
that infrastructure exists to prevent, without acknowledging it. Recommend:
either (a) extend to all five wallets with per-wallet capability checked from
`docs/wallets.json` (gracefully omitting any that genuinely lack a
browse-link scheme, with that omission stated in a comment), and randomize
order among whichever are offered, matching the `WalletChooser` discipline
exactly; or (b) if only two truly are technically capable, say so in the code
and cite it, so the narrowing is legible rather than silent.

## 8. Render-condition and hydration checks — executed, not just read

Live Playwright runs against the **deployed** site (`aha.a13z.org:8443`),
using real `browser.newContext({ userAgent: ... })` device emulation, not
mocks:

| Scenario | UA / injection | Expected | Observed |
|---|---|---|---|
| Firefox/Android | real Firefox-Android UA | banner, `is-warning`, "will not work" | ✔ |
| Chrome/Android | real Chrome-Android UA | banner, no `is-warning`, "On a phone?" | ✔ |
| Desktop Firefox | real desktop-Firefox UA, 1400×900 | nothing renders | ✔ (`.mw-notice` count 0) |
| iPhone Safari | real iOS Safari UA | banner (softer hint; MWA is Android-only) | ✔ |
| Firefox/Android + injected `window.phantom` | UA that alone would trigger the warning, plus a real injected provider | nothing renders (in-wallet browser wins) | ✔ |
| Hydration | Firefox/Android UA, console + pageerror listeners | zero hydration-related console errors | ✔ |
| Universal-link shape | Firefox/Android UA, `/onboarding` | `<a>` tags (not `window.open`), hrefs resolve to `solflare.com/ul/v1/browse/...` and `phantom.app/ul/browse/...` | ✔ |

7/7. (These specs were written to a scratch file, run, and then deleted — not
committed as a permanent suite; see Coverage gaps.) The "connected" branch
(`if (connected || ...) return null`) was verified by code reading only —
actually connecting a real wallet extension inside a Playwright context was
out of reach in this environment; the logic is a simple, unconditional early
return on `useWallet().connected` and is not itself UA-dependent, so the risk
here is low, but it is not independently exercised and is recorded as such.

Hydration-safety by construction, confirmed by reading and by the zero
hydration errors observed live: `state.show` starts `false`, so both the
server render and the first client render (before the `useEffect` fires)
produce identical output (`null`) regardless of device — the decision is made
strictly after mount.

## 9. Universal-link port-encoding — round-trip, and a real pre-existing bug found while checking it

Standalone Node round-trip (`encodeURIComponent`/`decodeURIComponent` against
a URL containing `:8443`) confirms the port survives encoding intact,
matching the commit's claim exactly. Confirmed **live**, not just
synthetically: navigating to `/onboarding` on the deployed site under a
Firefox-Android UA and reading the actual rendered `<a href>` attributes,
decoding them, and checking the decoded string equals the current page URL
byte for byte, port included — passed.

Links are confirmed plain `<a href>` (`tag === "A"`, `rel="noreferrer"`), not
`window.open` — matches the commit's stated reasoning (popup blockers on
mobile, and only a real `href` lets the OS offer the installed app).

**A separate, pre-existing, OUT-OF-SCOPE regression was found while running
the full deployed-site e2e suite as part of this check** (not caused by
either `b10bae9` or `04251ca` — confirmed below):

```
FAIL  e2e/twelve.spec.ts:23:7 › The 12 — nav menu ›
      the label links to /twelve and reveals both destinations
      (expected 2 menuitems, got 3, consistently across 3 retries)
```

Root cause: `components/Nav.tsx`'s dropdown now renders **three**
`role="menuitem"` links (`/twelve-steps`, `/twelve-traditions`, `/glossary`)
since the Resources-menu/Glossary feature (`7ac23f7`) added a third entry,
but `e2e/twelve.spec.ts`'s `DESTINATIONS` constant (and its
`toHaveCount(2)` assertion) was never updated to match. Confirmed this is
genuinely outside this round's scope: `git diff --stat 26b4b7c 04251ca --
frontend/components/Nav.tsx frontend/e2e/twelve.spec.ts` is **empty** —
neither file is touched by either commit under review, and both files were
last changed by `7ac23f7`/`1dfefa1`, both explicitly out of scope for this
round per the task brief. This is not scored against the two commits'
verdict, but it is real, live, reproducible (3/3 retries), and was
previously undetectable because the deployed e2e suite could not be run
against a live target in earlier rounds (see `NRR-2026-08-14-glossary.md`'s
Coverage gaps, "no Playwright/e2e test exercises... the renamed Resources
menu in a real browser — same structural blocker as every round this
month"). It is now runnable and it fails. **Flagged here for a follow-up
round** (Nav.tsx / glossary surface), not fixed and not attributed to this
round's two commits.

## 10. `tsc` and deployment

`cd frontend && npx tsc --noEmit` → **clean, exit 0.**

Deployed container verified by direct inspection, not assumed from a build
log: `docker exec frontend-frontend-1 sh -c "grep -rl 'mw-notice' /app/.next"`
finds the class in the server chunk, the client chunk, and the compiled CSS.
`docker compose build frontend` (run this round) was **entirely cache-hit**
(`COPY . .` cached), confirming the currently-running image
(`sha256:2f6f...708c`, created `2026-08-14T20:25:59Z`, container running that
exact image since `20:27:41Z`) already matches the working tree's `HEAD`
exactly — `git status --short` is clean throughout this round. The live smoke
suite (`e2e-smoke-check.sh`) against `https://aha.a13z.org:8443`, which
resolves to this same host, further confirms the deployment is live and
serving (48/49 passing; the one failure is the pre-existing, out-of-scope
Nav/glossary issue in §9).

## Privacy-invariant status (Layer D, the seven assertions)

Not independently re-derived in full this round (no member data, no chain
state, no messaging, no faucet code in either commit's diff — confirmed by
`--stat` above). What was run and is scoped correctly:

1–5, 7 (sponsor identity, trust/chosen-ones lists, message content/metadata,
biometric material, circle roster, faucet parrain→neophyte link) — N/A, no
code in this round's scope touches any of these surfaces.
6. hidden-content detection — N/A.

`tests/sentinel/privacy-sweep.sh` (repo-wide, mechanical): **5/5 pass** — no
analytics/telemetry SDK, no tracking pixels, no `console.*` of identity
material, no new `score|rating|rank|karma|reputation`-shaped field. Additional
targeted grep on the two new files specifically: §6 above, clean.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None of the five found. The one genuine Traditions-adjacent finding this
round — the two-wallet naming in §7 — is about third-party wallet vendors,
not members, and is recorded as a WARNING with reasoning, not silently
passed and not overstated as CRITICAL.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched by either
commit, and none was updated by this round.

## Coverage gaps

- **This round's own live Playwright checks (§8) were not committed as a
  permanent spec.** They were written to a scratch file, run against the
  deployed site, and deleted per this round's "do not modify application
  code" instruction interacting with "don't leave stray test files in the
  tree without being asked to." **This is itself a coverage gap for the next
  round**: `frontend/e2e/` has no spec exercising the mobile-wallet-notice
  surface at all yet (only this report's ad hoc, non-committed run). Per
  spec §4, this is a WARNING in this round and becomes FAIL-eligible next
  round if still uncommitted.
- **`docs/shipped.md` and `BACKLOG.md` do not mention either commit.**
  `grep -n "MobileWalletNotice\|mobileWallet\|sentinel-push-gate\|
  SENTINEL-GATE" docs/shipped.md BACKLOG.md` → zero hits. No F-number is
  assigned to the mobile-wallet fix. Per CLAUDE.md this should be reconciled
  in the same commit as the change; it was not. WARNING, consistent with how
  prior rounds (e.g. the glossary round) have scored the identical gap.
- **§9's Nav/glossary e2e failure** — real, reproducible, live, but
  out-of-scope for this round's verdict; flagged for the next round that
  touches `Nav.tsx` or the Resources/glossary/twelve surface.
- **§7's two-wallet naming** — flagged as a WARNING requiring either a code
  comment justifying the narrowing or an extension to match `WalletChooser`'s
  shuffle discipline.
- **§5's pre-existing REVIEWED.md self-forgery** — open, disclosed, carried
  forward, not newly introduced, not fixed this round; a decision for the
  user per `b10bae9`'s own commit message.
- No `test:api` / `test:adversarial` npm scripts exist in this repo — carried
  forward unchanged from every prior round; not introduced or worsened here.
- **`tests/sentinel/checklist.yaml` is not valid single-document YAML** —
  confirmed pre-existing (`python3 -c "import yaml; yaml.safe_load(...)"`
  fails identically on `HEAD` before this round's append, at line 2422,
  nowhere near this round's additions at the file's end): the file contains
  6 separate top-level `round:` keys interleaved with one long `layers:`
  list, which no single YAML document can express. Nothing in this repo
  actually parses the file with a YAML library (confirmed by grep — it is
  read by humans/agents as structured comments, not machine-loaded); not
  fixed here (pre-existing, not this round's commits' doing, and rewriting
  a 3000+ line file's structure is out of scope for a report-only round),
  but flagged plainly since "the checklist" being unparseable YAML is worth
  someone's attention.

## Verdict rationale

Both commits do what they claim, and I did not take either claim on faith.
For `b10bae9`: I rebuilt the exploit `NRR-2026-08-14-gate-delta.md` reported,
from scratch, with my own commits and my own decoy text (catching and fixing
my own accidental self-sabotage along the way), drove it through a real `git
push` against a real installed hook and a disposable remote, and watched it
get blocked on the current gate and get through on `16bb15f`'s — the CRITICAL
finding was real and is now closed. The diff is exactly what the commit
message says it is: the helper function stays, used only where it always
was; the dangerous skip is gone; nothing else from the good parts of `16bb15f`
was lost. The gate's own test suite discriminates honestly, both directions,
with a matched pair that rules out the trivial way to fake a pass. One
pre-existing weakness — REVIEWED.md self-forgery on the normal path — remains
open, but it was disclosed plainly in the commit and in OVERRIDES.md, not
concealed, and is correctly left for the user's decision rather than patched
in the same breath as the CRITICAL fix.

For `04251ca`: the technical diagnosis checks out against the actual
installed dependency's source, the fix is genuinely privacy-clean (no
network, no storage, no analytics, verified both by grep and by a live
adversarial injection test), the hydration and render-gating claims hold up
under an actual browser rather than just a reading of the code, the
port-encoding claim is correct, and the deployed container is confirmed —
not assumed — to be serving it. The one real concern is that the fix
hardcodes exactly two wallet names in a fixed order, which is the specific
pattern the project's own Tradition Six infrastructure (the shuffled
five-wallet chooser) was built to prevent, and does so without a word of
justification in the code. That is not a CRITICAL — no member is ranked, no
sponsor named, no relationship leaked — but it is a real, disclosed WARNING
that deserves either an explanation or a fix, not a shrug.

Nothing here required a functional regression to be waived, and no CRITICAL
survives this round's scope. The verdict is **PASS WITH WARNINGS**: the two
CRITICAL-adjacent things this round set out to check — is the gate hole
really closed, and is the mobile-wallet fix really privacy-clean — both
check out under independent, adversarial, executed verification, while three
honest WARNINGs (the two-wallet naming, the missing docs/BACKLOG entries,
and this round's own uncommitted Playwright checks) and one disclosed,
carried-forward open finding (REVIEWED.md self-forgery) keep this from being
an unqualified PASS. A fourth item — a real, live, reproducible nav-menu
failure — was found and reported in full, but it belongs to an earlier,
out-of-scope change and does not count against these two commits.
