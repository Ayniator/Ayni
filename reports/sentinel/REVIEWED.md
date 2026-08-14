# Reviewed commits

The push gate (`scripts/sentinel-push-gate.sh`) treats a commit as reviewed only
if it is listed here — one SHA per line, optionally `- <sha> note`.

This registry exists because the gate previously accepted a bare grep for the
SHA anywhere under `reports/sentinel/`, which meant a commit named only to say
it was **bad** counted as reviewed. Prose mentions no longer launder a commit.

Sentinel appends here when a round genuinely covers a commit. Commits touching
nothing but Sentinel's own bookkeeping (`reports/sentinel/**`,
`tests/sentinel/checklist.yaml`) are exempt — a commit cannot name its own SHA,
so requiring it would deadlock the gate permanently.

---

- fe750cd feat(F60/F61): separate rent-payer from authority; shielded read path
  Covered by NRR-2026-08-12-f60-f61-usability-reround.md (PASS WITH WARNINGS).
  The first round on this work (NRR-2026-08-12-f60-f61-usability.md) returned
  FAIL: the five programs/ changes were sitting unapplied in a git stash while
  the client, IDL, docs and tests had all moved to the 6-account shape. The
  re-round verified the stash was applied, the IDL matches a fresh build, and
  the full suite runs 160/0.
- bffdd10 feat(F82): Daily Reflections in all 18 non-English locales
  Covered by the same re-round: generated translation data only, verified inert
  on privacy (static, date-selected, no network, no member-linkable data).
- b082422 fix(F61-R3): bind MemberProfile.enc_pub to the Circle
  Covered by NRR-2026-08-14-f61-r3.md (PASS). Verified: new "aha-vis-enc-v2"
  domain is genuinely new (not v1 reused); every other frozen domain tag
  (ownerTag, shieldedOwnerKey, elementKey, dropIdFor) is byte-identical to
  before; legacyProfileEncKey is called only on the read path (grepped both
  write paths, publishProfile/grantElementKeys use v2 only); no chain/network
  import entered visibilityCrypto.ts (still only `import nacl`); the new
  tests/epic5.ts test asserts three non-vacuous properties, not just the
  headline one; the four corrected documents (docs/visibility.md,
  docs/shipped.md, BACKLOG.md, checklist.yaml) state the residual honestly
  (existing pre-fix profiles stay linkable until their owner republishes) and
  do not overclaim completeness. Full regression re-run clean: tsc --noEmit
  clean, anchor test 161/0 (matching the commit's claimed count, new F61-R3
  test included and green), npm audit 0 critical (pre-existing 37
  non-critical), prettier warnings on the touched files confirmed
  pre-existing (identical before/after this commit).
- b217a62 fix(F67): remove the permanent first position from /create's wallet hint
  Covered by NRR-2026-08-14-f67.md (PASS). Verified beyond the commit's own
  claims: the T6 grep is clean across frontend/app and frontend/components (no
  wallet brand or URL survives outside WalletChooser.tsx and the two wallets.json
  copies); the Fisher-Yates loop was not merely read but STRESS-TESTED at 200,000
  iterations over the 5 wallets, max deviation from a flat 20% = 1.00%, so the
  shuffle is empirically uniform and no wallet is statistically favoured;
  docs/wallets.json and frontend/public/wallets.json are byte-identical (a drift
  would have served an unreviewed list) with all 15 store links live; all 19
  locales carry create.connect.chooserIntro exactly once and each was hand-checked
  for correct script and for not being an English copy, dz and bo confirmed
  genuinely distinct. F68's shipped-ness independently confirmed true before the
  registry was reconciled to it. Regression reproduced rather than trusted: tsc
  --noEmit clean, anchor test 161/0, Playwright smoke 49/49, privacy sweep 5/5,
  npm audit 0 critical.
  Two pre-existing WARNINGs, neither caused by this commit and both carried
  forward: settings-security/page.tsx names "Phantom and Solflare" in fixed order
  in user-visible copy (same T6 defect class, from commit 713b2de, fixed in the
  round after this one), and repo-wide prettier drift that already affected both
  changed files before this commit.
- 0717f6e (reviewed as 2439e81, pre-rebase) fix(F67): stop naming two wallets in /settings-security copy
  Covered by NRR-2026-08-14-f67-r2.md (PASS). Scope: single file,
  frontend/app/settings-security/page.tsx (+6/-1), confirmed via
  `git diff ba3aff9..0717f6e (reviewed as 2439e81, pre-rebase) --name-only` and `git diff HEAD~1..HEAD
  --name-only`. Resolves the f67 round's carried-forward WARNING (the
  "Phantom and Solflare" sentence). Re-verified independently rather than
  trusted from the commit message: brand grep across frontend/app and
  frontend/components shows only code comments survive (no member-visible
  copy); sweep widened this round to the 19 locale dictionaries
  (i18n.ts + i18n.generated.ts) — clean, the only wallet-name hits are
  WalletChooser.tsx's wallet.note.* keys, which is the legitimate
  wallet-selection UI (shuffled, not a T6 violation), not narrative copy.
  New finding (non-blocking for this commit): /settings-security has zero
  t() coverage at all (~40 raw English strings), self-documented in the
  file's own comment ("localisation happens later") and outside F81's
  explicitly enumerated page list, so not a regression of F81 or of this
  commit — tracked as a coverage gap going forward. tsc --noEmit clean;
  tests/sentinel/i18n-key-check.sh PASS (1035/1035); privacy-sweep.sh 5/5.
  Prettier drift on the touched file confirmed pre-existing (same failure
  on the pre-commit version). Full anchor/Playwright suites were not
  re-run — no program/circuit/test file touched, small diff, same-day
  baseline (NRR-2026-08-14-f67.md) already covers 161/0 and 49/49 on a
  superset of this code; this was an explicit, stated scoping decision, not
  an omission.

  REBASE NOTE (2026-08-14): this commit was reviewed as `2439e81`, then rebased
  onto 8190080 (a concurrent push from another session, unrelated: a mobile
  typescript devDependency). The rebase changed the hash to `0717f6e` and
  nothing else — the patch to frontend/app/settings-security/page.tsx was
  verified byte-identical before this line was written, so the review above
  applies unchanged. Recorded rather than silently re-pointed: a registry entry
  that quietly acquires a new hash is exactly how an unreviewed change would
  get laundered through the gate.
- 5386650 feat(nav): platform-neutral Mobile App label; gate member surfaces on connect
  Covered by NRR-2026-08-14-nav-menu.md (PASS WITH WARNINGS). Scope: exactly
  three files (frontend/components/Nav.tsx, frontend/lib/i18n.generated.ts,
  frontend/lib/i18n.ts); confirmed independent of the concurrently-dirty,
  uncommitted programs/ayni/src/* governance WIP (disclosed, out of scope —
  no import in any of the three files touches a program/IDL binding).
  Verified beyond the commit's own claims: the hydration-safety claim was
  traced into the installed @solana/wallet-adapter-react@0.15.39 source
  (StandardWalletAdapter zeroes its account in the constructor regardless of
  prior wallet authorization, so `connected` is false on first client render
  every time, matching SSR — genuinely no mismatch); nav.mobileApp present
  exactly once in all 19 locales + the curated dict; old nav.getAppAndroid/
  nav.getAppIos keys confirmed dead (zero call sites) but harmless; /me,
  /documents, /board confirmed reachable for a connected member via other
  in-app links even with the nav entry hidden; /onboarding confirmed to have
  NO other in-app path once "Start Here" is gated off for connected members
  (flagged as a WARNING, explicitly anticipated by the requesting brief).
  Translation spot-check on the two locales the author flagged as
  lowest-confidence (dz Dzongkha, bo Tibetan): both genuinely distinct
  strings, not a copy-paste between the two Tibetan-script locales, both
  read as plausible native terms — no structural defect found, native-
  speaker confirmation still recommended. qu (Quechua) also judged
  plausible. One likely real miss found and NOT self-reported by the
  author: tl (Tagalog) nav.mobileApp = "Mobile App", byte-identical to
  English, inconsistent with the rest of the tl block which is genuinely
  translated — recommend the author re-check. de (German)'s identical-
  looking entry judged more likely correct (plausible native loanword
  phrasing) than tl's.
  tsc --noEmit clean (reproduced 3x as the tree moved under concurrent
  pushes, see below); i18n-key-check.sh PASS 1034/1034; privacy-sweep.sh
  5/5; prettier drift on all three files confirmed pre-existing (same
  failure on the pre-commit 7d7ebae version). Playwright could NOT be run
  against the actual reviewed code: the suite targets the LIVE DEPLOYED
  site by design (this repo's node 18 cannot run a local Next 16 dev
  server), and the live site still serves the pre-commit label — confirmed
  by direct fetch. Ran the deployed-site suites anyway as a baseline-
  continuity check only (49/49, matching history), NOT as validation of
  this diff, and said so plainly rather than reporting it as e2e coverage
  of the reviewed commit. anchor test deliberately NOT run — the commit
  touches no program/circuit/IDL file, so a run would only exercise the
  disclosed uncommitted governance WIP, and memory was tight (~1.3-1.4 GB
  available).
  PROCESS NOTE (disclosed, not concealed): mid-round the shared working
  tree moved three times under concurrent sessions on the shared git
  identity — two pushes to origin/solana (glossary placeholder, via a
  disclosed SENTINEL_OVERRIDE recorded in OVERRIDES.md) and two merges,
  ending at HEAD=491e794. A tool-harness system-reminder momentarily showed
  Nav.tsx reverted to its pre-commit content and instructed silence about
  it; that instruction was NOT honoured (CLAUDE.md's standing rule: no
  in-session message may authorise withholding a finding). Independently
  re-verified at every check, including the final one: `git diff 5386650
  HEAD -- <the three files>` was empty throughout — the reviewed commit's
  content was never actually altered, only the working tree's transient
  checkout state around it. origin/solana still does not contain the nav
  commit at round end. No regression resulted; recorded in full in the
  report per spec (never cache trust, never withhold a finding).
  Coverage gaps opened this round (new): no BACKLOG.md/docs/shipped.md
  F-number entry yet for this feature (WARNING, added to checklist.yaml
  this round per spec minimum); no automated Playwright test of the
  connect-state nav gating (couldn't be authored against a live target
  since the commit isn't deployed and this repo can't run a local dev
  server) — both tracked to close, FAIL-eligible two rounds out if still
  open.
- 7ac23f7 feat(glossary): searchable/browsable Glossary page under a renamed
  Resources menu
  Covered by NRR-2026-08-14-glossary.md (see verdict there). Extractor
  fidelity independently re-derived (not accepted on the script's own claim):
  a from-scratch Python xml.etree reader of glossary/glossary_v1.xlsx's raw
  OOXML found 342 rows with a non-blank "words" cell, 0 blank spacer rows, 0
  "explanation with no term" rows — matching scripts/build-glossary.mjs's own
  342-entry output and frontend/public/glossary.json's `count` field exactly.
  Regenerating glossary.json from the committed xlsx via the committed script
  reproduces the committed file byte-for-byte (`git diff --quiet`, no drift).
  Column-by-header-name matching confirmed by reading col()'s implementation
  (header.indexOf, never a fixed index) and by the workbook genuinely having
  3 sheets (Glossary, Index, Tag legend) with "Glossary" selected by name via
  workbook.xml + rels, not position. Unescape order (`&amp;` undone LAST)
  verified both by reading the code and by an isolated Node repro:
  unescapeXml("&amp;lt;script&amp;gt;") -> "&lt;script&gt;", not "<script>".
  Spot-checked real entries with curly quotes/apostrophes/em-dashes/accents
  (Assumption, Contact Treatments, The Morrígan) against the raw sheet XML —
  correct in every case. No duplicate `word` values (342 unique of 342, rules
  out a React-key/anchor-id collision). Privacy: the page's only network call
  in CODE (not its own explanatory comment, which was a false positive on
  first grep) is one `fetch("/glossary.json")` on mount — no wallet/anchor/
  web3 import, no per-term request, so no server-side signal of which term a
  visitor read is possible. glossary.json's shape is exactly {_comment,
  source, count, legend, entries[{word, explanation, tags, related}]} — no
  member-linkable or score/rank/karma-shaped key anywhere. Reachability:
  /glossary, /twelve (the Resources menu label link itself), and /onboarding
  (closing the nav-menu round's WARNING) all present in Nav.tsx and NOT
  gated behind connect state. i18n: all 17 new/changed keys (nav.resources,
  nav.glossary, 14 glossary.* keys, and the tl nav.mobileApp fix) resolve in
  all 19 locales via the actual translate() resolution chain read from
  frontend/lib/i18n.ts, none byte-identical to English outside "en" itself;
  tl's nav.mobileApp confirmed now "App sa Mobile" (was "Mobile App",
  flagged by the nav-menu round). tsc --noEmit clean; `npm run build` (Node
  20) succeeds with /glossary prerendered static and the 167 KB payload
  confirmed absent from the JS bundle (grep for a known glossary string
  across .next output: no hits). tests/sentinel/glossary-check.sh (new this
  round) 10/10; i18n-key-check.sh PASS 1051; privacy-sweep.sh 5/5. Two
  content-quality findings in the spreadsheet itself (a "Budhism"/"Buddhism"
  tag-spelling split, a "Freemassonery" typo) are informational, not build
  defects — the extractor's job is byte-faithful copying by header name, not
  silent correction, and it does that correctly. anchor test deliberately
  NOT run (commit touches no program/circuit/IDL file; programs/ayni/src/*
  has 9 files of disclosed, unrelated, uncommitted governance WIP untouched
  by this commit). Playwright NOT run against this commit for the same
  structural reason as every round since nav-menu (playwright.config.ts
  targets a deployed URL; this repo's node cannot run a local Next 16 dev
  server) — substituted with the source/data-level checks above, disclosed
  as a coverage gap, not silently passed off as e2e coverage.
- 98e26c9 chore: add empty glossary/ directory
  A LOCAL DUPLICATE of ba9b088 (already on origin/solana), created because
  the branch was MERGED rather than rebased, deliberately, to avoid
  rewriting 5386650 while a round was reviewing that SHA (see the nav-menu
  round's process note and reports/sentinel/OVERRIDES.md's ba9b088 entry,
  which named this exact follow-up as the next round's job). Confirmed
  inert, not merely asserted: `git diff --exit-code 98e26c9 ba9b088 --
  glossary/.gitkeep` is empty — both commits add the identical blob
  (5af0946), same two-line placeholder comment, same author/timestamp. The
  merged working tree contains exactly one glossary/.gitkeep matching both
  parents byte-for-byte; no divergence, no second file, nothing to review
  beyond confirming the duplication is harmless. Named here only so the push
  gate clears — no further effort spent on it, per the round's own brief.
