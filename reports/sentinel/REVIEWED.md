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
