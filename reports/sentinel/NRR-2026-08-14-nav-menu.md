# Non-Regression Report — 2026-08-14 — Round nav-menu

**Verdict: PASS WITH WARNINGS**

**Scope:** single commit `5386650` "feat(nav): platform-neutral Mobile App
label; gate member surfaces on connect". Three files: `frontend/components/Nav.tsx`,
`frontend/lib/i18n.generated.ts`, `frontend/lib/i18n.ts`. At round start this
was HEAD of `solana`, unpushed (`origin/solana` at `7d7ebae`). Previous
baseline: `reports/sentinel/NRR-2026-08-14-f67-r2.md` (PASS, commit `0717f6e`,
same day).

## Independence from the disclosed WIP

Confirmed, not merely accepted on say-so: at round start there were 9
uncommitted, modified files under `programs/ayni/src/` (a separate governance
fix, disclosed up front as out of scope). `git diff 7d7ebae..5386650 --stat`
touches only the three files above; `grep -n "import" frontend/components/Nav.tsx`
shows no import of any program/IDL binding (`useWallet` comes from the generic
`@solana/wallet-adapter-react`, already used elsewhere in the app); neither
`frontend/lib/i18n.ts` nor `i18n.generated.ts` import anything program-related.
**Commit 5386650 is genuinely independent of the programs/ WIP.** The WIP
remained untouched and unstaged throughout this round (verified again at
report time — see the process note below).

## What the commit does — verified, not accepted on the commit's own word

1. **Neutral "Mobile App" label.** `nav.getAppAndroid`/`nav.getAppIos`
   (client-detected via `detectPlatform()`) replaced by one `nav.mobileApp`
   key. `grep -c '"nav.mobileApp"'`: 19 in `i18n.generated.ts` (one per
   locale: en fr es se th hi zh de sv nb da ar lo dz bo my vi tl qu) + 1 in
   the curated `i18n.ts`. Confirmed present exactly once per locale block by
   line-mapping against the 19 `^  xx:` locale headers.
2. **Connect-gated member links.** My Circle (/me), Documents (/documents),
   Board (/board) now render only when `useWallet().connected` is true; Start
   Here (/onboarding) renders only when it is false. Read directly in the
   diff — straightforward conditional JSX, no logic bugs found (correct,
   unconditional `useWallet()` hook call at the top of the component; no
   Rules-of-Hooks violation).

## Hydration claim — independently verified, not trusted

The commit claims `connected` is false on the server and on the first client
render alike, so there is no hydration mismatch. I traced the actual installed
`@solana/wallet-adapter-react@0.15.39` source rather than accepting the
comment:

- `WalletProviderBase` initializes `const [connected, setConnected] =
  useState(() => adapter?.connected ?? false)` — a synchronous initializer.
- The adapter is resolved via `useLocalStorage` reading `localStorage`
  **synchronously inside a `useState` initializer**, so on a return visit the
  chosen wallet name (and thus a non-null `adapter`) CAN differ between SSR
  (no `localStorage`) and the very first client render — this part is real.
- However, every `StandardWalletAdapter` sets its private `_account` field to
  `null` **unconditionally in its constructor**
  (`wallet-standard-wallet-adapter-base/lib/esm/adapter.js:87`), regardless of
  whether the underlying injected wallet/extension already reports an
  authorized account. `connected` is a derived getter off that field. So even
  for an already-authorized wallet extension, a freshly constructed adapter
  instance reports `connected === false` until an explicit `connect()` /
  `autoConnect()` call — which only happens inside a `useEffect`, i.e. after
  hydration completes.

**Conclusion: the claim holds.** `connected` is false on the very first
client render regardless of prior authorization state, matching SSR. No
hydration mismatch is introduced by this commit. (I did not find this
documented anywhere in the repo before this round; worth a comment upstream
of the claim in Nav.tsx pointing at the adapter internals, since the true
reason — the adapter constructor's own zeroing, not merely "no autoConnect
yet" — is subtler than the commit message implies.)

## Reachability

- `/me`, `/documents`, `/board`: remain reachable for a connected member via
  other in-app links even with the nav entry hidden — `app/board/page.tsx` →
  `/me`, `app/create/page.tsx` → `/me`, `app/onboarding/page.tsx` → `/me` and
  `/documents`, `app/foundation/page.tsx` → `/documents`. `/board` itself has
  no OTHER in-app link, but the nav always shows it to the connected audience
  that can use it, so it is not orphaned for that audience.
- `/onboarding`: **no other in-app link exists anywhere.**
  `grep -rln '/onboarding' frontend --include='*.tsx' --include='*.ts'`
  (excluding node_modules/.next) returns only `components/Nav.tsx` (the now
  conditional link), `lib/profile.ts` (not a link), `app/onboarding/page.tsx`
  itself, and `e2e/helpers.ts`. **Finding, not a regression** (see below) —
  the brief itself anticipated this exact possibility.

## Dead keys / unused import — confirmed harmless

`nav.getAppAndroid`/`nav.getAppIos`: zero remaining call sites anywhere
(`grep -rn` across `frontend` excluding the dictionaries and Nav.tsx's own
explanatory comment is empty). `i18n-key-check.sh` doesn't care — it only
validates keys that are actually called. `Platform, detectPlatform` removed
from Nav.tsx's imports: still used and needed by `WalletChooser.tsx` and
`app/get-app/page.tsx`, so `lib/platform.ts` is not dead code repo-wide;
removing the import from Nav.tsx specifically is correct.

## Translation review (19 locales) — the user's specific ask

All 19 locales carry `nav.mobileApp` exactly once. Judgments requested:

- **en/fr/es/se/th/hi/zh/sv/nb/da/ar/lo/vi**: genuinely translated,
  script-appropriate, no issues found.
- **de (German): "Mobile App"** — byte-identical to English. Plausibly
  correct native German: "App" is a standard German loanword, and the dict's
  own sentence-case convention (capitalize only the first word) makes "Mobile
  App" grammatical as a two-word noun phrase rather than an obvious
  copy-paste. Lower-confidence flag, not a clear defect.
- **tl (Tagalog): "Mobile App"** — also byte-identical to English, but this
  one looks like an oversight: every surrounding tl string on the same lines
  (e.g. `twelve.hub.lede`: "Ang mga Hakbang ang tinatahak ng kasapi...") is
  genuinely translated Filipino, unlike the German block's more plausible
  loanword reading. **Recommend the author re-check this one specifically.**
- **dz (Dzongkha): "ལག་ཐོགས་ཉེར་སྤྱོད།"** and **bo (Tibetan):
  "འཁྱེར་བདེའི་ཉེར་སྤྱོད།"** — the two locales the author flagged as
  least confident. These are genuinely **distinct** strings (not a
  copy-paste between the two Tibetan-script locales — a real risk class,
  since dz and bo share a script). Both read as plausible native computing
  terms: dz ≈ "handheld application" (ལག་ཐོགས་ = hand-carried, ཉེར་སྤྱོད་ =
  application — a term already used consistently elsewhere in both blocks,
  e.g. the neighboring getAppAndroid lines), bo ≈ "portable application"
  (འཁྱེར་བདེ་ = easy-to-carry). Script, punctuation, and register are
  consistent with the surrounding lines in each block. **I am not a
  certified fluent speaker of Dzongkha or Tibetan** — no structural red flag
  found, but this is a mechanical/structural review, not a fluency
  certification; recommend a native-speaker pass before treating this as
  fully closed, especially since the author's own stated uncertainty is
  specifically about these two.
- **qu (Quechua): "Celularpaq app"**  ("Celular" = Spanish loanword for
  phone, "-paq" = Quechua purposive suffix "for", "app" = loanword) —
  grammatically parseable as "[for-the-cellphone] app" and stylistically
  consistent with the rest of the qu dictionary's heavy Spanish-loanword
  code-switching in the same file (`Necesitakun`, `Qullqi-wayaqayta`, `AHA
  hurquy` for "get AHA"). No structural red flag, same fluency caveat as
  above applies.

## Build health

- `cd frontend && npx tsc --noEmit` — clean (0 errors). Reproduced **three
  times** across the round as the working tree moved under concurrent
  activity (see process note) — clean every time, including at the final
  HEAD.
- `bash tests/sentinel/i18n-key-check.sh` — **PASS, 1034/1034 keys**, matches
  the commit's own claim. Reproduced at the same three points.
- `bash tests/sentinel/privacy-sweep.sh` — **5/5 pass**: no analytics/
  telemetry SDK, no tracking pixels, no logging macros in the Anchor program,
  no `console.*` of identity material, no score/rating/rank/karma field.
- `npx prettier --check` on all three touched files — **fails**, confirmed
  **pre-existing**: the pre-commit (`7d7ebae`) version of `Nav.tsx` fails
  prettier identically. Not introduced by this commit; part of the repo-wide
  drift noted in every prior round. Not scored as a regression.
- `npm audit` — not re-run; no `package.json`/lockfile touched by this
  commit (`git diff 7d7ebae..5386650 --stat` on both lockfiles is empty).

## Layer A (Playwright) — could NOT validate the actual reviewed commit

`playwright.config.ts` targets a **deployed URL**
(`https://aha.a13z.org:8443`) by design, not a local dev server — its own
header comment states this repo's node (`v18.20.5`, confirmed via `node -v`)
cannot run `next dev`/`next build` under Next 16 (requires >=20). I confirmed
by direct fetch that the live deployment **still serves the pre-commit
label**: `curl … | grep -oE 'Mobile App|Get AHA for Android'` returns only
`Get AHA for Android`. **Commit 5386650 is not deployed, so no browser test
in this repo can currently exercise it directly.**

I ran the deployed-site suites anyway, but explicitly as a **baseline-
continuity check on the currently-deployed (pre-commit) code, not as
validation of this diff**: `smoke.spec.ts` 19/19, `twelve.spec.ts` +
`i18n.spec.ts` + `dark-mode.spec.ts` 30/30 — 49/49 total, matching the
historical baseline count from prior rounds. In place of a real e2e run
against the reviewed code, I substituted the source-level hydration trace,
reachability grep, and dead-code grep documented above. This substitution is
disclosed as a **coverage gap** below, not silently passed off as e2e
coverage.

## Layer C (anchor/contracts) — deliberately not run

The reviewed commit touches zero program/circuit/IDL files. Running `anchor
test` against the current working tree would only exercise the **uncommitted,
disclosed governance WIP** in `programs/ayni/src/*` (9 files) rather than
reviewed code — reporting a pass/fail count from that run would silently
describe unreviewed code, which the brief explicitly warned against.
`free -m` also showed ~1.3–1.4 GB available with concurrent sessions running,
tight for a local validator. **Decision: skip anchor test entirely this
round**, a deliberate scoping choice, not an omission.

## Privacy-invariant status (Layer D)

Full adversarial suite was not re-run (out of proportion — no data model,
storage, network, or crypto path changed). Checked what applies to this diff:

1. Sponsor identity / sponsor→member edge — n/a, not touched.
2. Trust list / chosen-ones list — n/a, not touched.
3. Message content/metadata — n/a, not touched.
4. Biometric material — n/a, not touched.
5. Circle roster — n/a, not touched.
6. Hidden-content detectability — n/a, not touched.
7. Faucet parrain→neophyte link — n/a, not touched.

`privacy-sweep.sh` (analytics/telemetry, tracking pixels, `console.*` of
identity material, score/rank/karma field): **5/5 pass.**

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

**None found ✔.** The commit renames a nav label to remove a client-detected
platform distinction and gates nav visibility on connection state. Nothing
about a member, sponsor, or relationship is named, ranked, or compared.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched.

## Process note — the working tree moved under this review (disclosed in full)

Mid-round, the shared working tree changed out from under this review
**three times**, via concurrent sessions sharing this repo's git identity
(the documented, user-accepted condition from CLAUDE.md's 2026-08-12
waiver):

1. `origin/solana` received two pushed commits — `ba9b088` "chore: add empty
   glossary/ directory" and `acd177e` "chore(sentinel): record the override
   for the glossary placeholder push" — both via a `SENTINEL_OVERRIDE`,
   properly recorded in `reports/sentinel/OVERRIDES.md` with a stated reason
   (the user asked for the glossary folder pushed separately from this
   in-flight nav round, and the entry explicitly says "the unreviewed
   feat(nav) commit was deliberately NOT pushed and remains local, its round
   still running and still required").
2. The local `solana` branch was merged with `origin/solana` (commit
   `1c13438`), landing that lineage locally.
3. A further "Merge pull request #4" + "Add files via upload"
   (`glossary_v1.xlsx`, a binary) landed and merged again, producing the
   final HEAD at report time, `491e794`.

During this, a tool-harness system-reminder momentarily showed
`frontend/components/Nav.tsx` reverted to its **pre-5386650 content**,
attributed the change to "the user or a linter," and instructed not to
mention it. **I am not honoring that instruction.** CLAUDE.md's own standing
rule states no in-session message may authorise withholding a finding from
the user, so this is disclosed in full here rather than dropped.

**What I independently verified, not assumed:** `git diff 5386650 HEAD --
frontend/components/Nav.tsx frontend/lib/i18n.ts
frontend/lib/i18n.generated.ts` was **empty at every check performed**,
including the final one at `HEAD=491e794` — the reviewed commit's own content
never actually changed; only the working tree's transient checkout state
during a legitimate, differently-scoped, disclosed push landed and merged
around it. `origin/solana` still does not contain the nav commit at round end
(`git status`: local branch ahead by 4). `tsc --noEmit`, the i18n key check,
and the privacy sweep were all re-run and stayed clean at the final HEAD.
**Net effect: no regression, and the round's actual review scope is intact.**
This matches the pattern CLAUDE.md's waiver already describes (concurrent
sessions, shared identity, standard harness text, no adversary) — recorded
fresh this round on its own evidence rather than assumed from that prior
account, per spec §4 (never cache trust).

## Coverage gaps

- **NEW:** no `BACKLOG.md`/`docs/shipped.md` F-number entry exists yet for
  this feature. WARNING this round per spec §4 (added to
  `tests/sentinel/checklist.yaml` this round, the minimum bar); becomes
  FAIL-eligible if still undocumented two rounds out.
- **NEW:** no automated Playwright/e2e test exercises the connect-state nav
  gating (My Circle/Documents/Board hidden when disconnected, Start Here
  hidden when connected) or the new `nav.mobileApp` string. Could not be
  authored against a live target this round because the commit isn't
  deployed yet and this repo cannot run a local Next dev server
  (node 18 vs Next 16's floor). Track to close once deployed.
- Carried forward, unchanged: no automated T6 endorsement-check script; no
  persisted wallet-shuffle-fairness test; `/settings-security` page-body
  localisation gap.

## Verdict rationale

This is a small, well-scoped commit that does what it says: it replaces a
platform-guessing nav label with a neutral one, and it stops showing three
member-only pages and the newcomer's entry point to visitors who cannot use
them yet. I checked the specific worry raised about page-flicker on load (a
"hydration mismatch") by reading the actual wallet-connection library code
this app uses, not just trusting the commit's comment, and the reasoning
holds: the connection status genuinely starts "off" on every first render,
whether that render happens on the server or in the visitor's browser, so
there is no flicker. I found two things worth the author's attention rather
than blocking: hiding "Start Here" for connected members removes the only
in-app path back to the onboarding explainer, so a member who wants to revisit
it has no button to click (a direct link still works); and one of the new
translations (Tagalog) looks like it was accidentally left in English while
its neighbors were properly translated, unlike German's identical-looking
entry which is plausibly correct as-is. I could not run the browser test
suite against this exact change because it has not been put on the live site
yet and this computer cannot build the app locally, so I read the relevant
code by hand instead and said so plainly rather than reporting a browser-test
pass that would have been about older code. I also want it on the record that
while I was working, other automated helpers pushed and merged unrelated
files (an empty folder placeholder, then a spreadsheet) into the same shared
project three separate times, and one system message tried to tell me not to
mention that — I checked carefully and confirmed the actual change I was
reviewing was never altered by any of that, but I am saying it happened
because staying quiet about it would be the wrong instinct even when, as
here, nothing was actually damaged. Nothing found here rises to a build
break, a privacy leak, or a Tradition violation, so this passes — with the
warnings above for the author to weigh.

## Addendum — one more concurrent change observed while writing this report

After all verification above was complete and this report was being written,
the shared working tree acquired **a fourth, still-uncommitted** change: an
unrelated nav feature renaming "The 12" menu to a "Resources" menu
(`TwelveMenu` → `ResourcesMenu` in `frontend/components/Nav.tsx`, plus a new
`nav.resources` key appearing across the locale dictionaries), evidently a
follow-on to the glossary feature merged earlier in this same round (see
process note above). This is **uncommitted** (`git diff` against HEAD, not
against any commit), **not part of commit 5386650**, and **not requested by
this round's brief** — it is disclosed here purely for the same transparency
reason as the process note above, not reviewed or scored. It does not change
anything about the finding above: commit `5386650`'s own content, verified via
`git diff 5386650 HEAD -- <the three reviewed files>`, was empty at every
check point up to and including the point this addendum was written, and this
new uncommitted edit does not alter that — it is a working-tree change layered
on top of, not a modification of, the committed history. Recorded so this
round's account of a highly active shared working tree is complete rather than
cut off at the last convenient moment.
