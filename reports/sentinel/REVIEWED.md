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
