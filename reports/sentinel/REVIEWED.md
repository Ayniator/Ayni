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
