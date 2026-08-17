# Non-Regression Report — 2026-08-16 — Round nav-qr-batch

Verdict: **PASS WITH WARNINGS**

Scope: exactly 6 already-committed, unpushed commits at local HEAD, blocked by
`scripts/sentinel-push-gate.sh` as unreviewed. Frontend/docs-only; explicitly
excludes re-verifying F60/F61/MACI (already closed, see REVIEWED.md) and the
in-progress `frontend/public/reflections.json` translation churn (confirmed
below to be untouched by these 6 commits).

Commits: `7bce86a` `7c82e98` `f8f0fa5` `6a7575b` `7503546` `0e78609`
Commit under test (HEAD): `0e786092e670a9fd2a291ae7444c482bfcca83d5`
Previous baseline: `947744d` (`NRR-2026-08-16-ui-batch.md`, PASS WITH WARNINGS)

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — Build health | tsc --noEmit, i18n-key-check | 2 | 0 | — |
| B/A — Gates + e2e (deployed) | glossary-check (10 checks), presence-ui-check (11 checks), e2e-smoke-check (71 Playwright specs) | 92 | 0 | 0 |
| A — targeted Playwright | e2e/twelve.spec.ts (7 specs, standalone re-run) | 7 | 0 | 0 |
| D — Privacy sweep (scoped) | grep sweep of all 6 commits' added lines for forbidden ranking identifiers, telemetry/console.log-of-identity, network sinks in QrScanner.tsx | 3 sweeps | 0 findings | 0 |
| Manual/source review | 6/6 commits read; `programs/`+`circuits/` touch confirmed absent; QrScanner injection surface; Nav wallet-gating; decodeHandoff parsing; Tradition-8 cross-locale check | 6 | 0 | 0 |

## Regressions

None found.

## Privacy-invariant status (scoped to this batch — full Layer D dump-simulation not re-run this round; see rationale)

This is a small, frontend-only, non-program batch; per the task's proportionate
scope, the full adversarial Layer D suite (DB/log/anchor dump simulation) was
not re-executed — none of these commits touch storage, the program, circuits,
or messaging content. The scoped checks that ARE relevant to this batch:

1. Sponsor identity / sponsor→member edge — not touched. N/A.
2. Trust list / chosen-ones list — not touched. N/A.
3. Message content / who-messaged-whom metadata — not touched by `f8f0fa5`'s
   QR scanner (it only fills the same presence-attestation-code field paste
   already fills); `InboxNavLink` itself is unchanged by `6a7575b` (only its
   position moved). ✔
4. Biometric material — not touched. N/A.
5. Circle roster — not touched. N/A.
6. Whether a member has hidden content — not touched. N/A.
7. Faucet parrain→neophyte link — not touched. N/A.

**QR-scan-specific check (this round's real surface area):** ✔ — `QrScanner.tsx`
never parses/evals/transmits the scanned string; hands it verbatim to the
caller, which places it in the same text field the paste path already fills.
`decodeHandoff()` is base64-decode + `JSON.parse` with a `v`/`kind` shape check,
throwing on anything malformed — no code-execution surface from a hostile QR
payload. Grepped clean for `fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`/
`localStorage`/`sessionStorage`/`indexedDB`/`console.log`. The camera stream is
stopped on decode, on stop, and on unmount. The scanner touches no on-chain
Presence PDA and adds no new derivable/enumerable account — the existing,
already-waived `docs/presence.md` ledger-count residual (Layer D §7-adjacent,
F59-specific) is unaffected and not worsened.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found ✔ — grep of all 6 commits' added lines for
`score|rating|rank|karma|tier|badge|count` (case-insensitive) returned zero
hits. No sponsor/relationship data is touched anywhere in this batch.

## Baseline changes this round

None. No API schema, DOM assertion, proof fixture, cost budget, or bundle-size
baseline was modified.

## Coverage gaps (added to `tests/sentinel/checklist.yaml` as `NAV-QR-BATCH-2026-08-16`)

These are WARNING-level, not blocking — each was covered instead by direct
source review, consistent with (and explicitly extending) the repo's
long-standing, disclosed limitation that no Playwright fixture in this repo
drives a wallet-connected session or a real camera feed (first recorded
against `F59-PRESENCE`/`F59-DOC`, "camera BarcodeDetector against a real video
feed... never run anywhere").

1. **`6a7575b` (Nav reorder, wallet-gated):** no e2e test drives a connected
   wallet, so "no flash of My Circle / My Messages to a disconnected wallet"
   is verified by source review (the pre-existing `connected &&` guard pattern,
   already used elsewhere in the same file, unchanged in mechanism — only
   reordered), not by a rendered browser assertion.
2. **`f8f0fa5` (QrScanner):** the actual camera-permission prompt +
   `BarcodeDetector` decode path is untested by Playwright (no camera fixture
   in this suite), verified by source review only.
3. **`7503546` (hover-gap CSS bridge):** no dedicated regression test — a
   real Chrome mouse-path-through-dead-space bug is not reproducible with
   Playwright's synthetic pointer events. The existing `twelve.spec.ts`
   assertions (menu opens, keyboard-reachable, label click lands on hub) still
   pass but do not exercise this specific fix. Low severity: a regression here
   would be a UX annoyance, not a privacy or functional break.

Per CLAUDE.md: coverage added this round (checklist entry written, gaps named
explicitly) is a WARNING now; if this area changes again before a real
wallet-connected/camera e2e fixture exists, it becomes a FAIL next round.

## What was verified and how

- `git show --stat` on all 6 commits, individually and combined: **zero**
  touches to `programs/` or `circuits/` (explicitly re-confirmed, not just
  trusted from the task description).
- `frontend/public/reflections.json` and related files: confirmed absent from
  all 6 commits' stats, and `git diff --stat origin/solana...HEAD -- ...
  reflections.json` is empty — the parallel translation churn mentioned in the
  task is genuinely unrelated to this push.
- Build health: `tsc --noEmit` clean; `tests/sentinel/i18n-key-check.sh` PASS
  (1159 keys resolve).
- Deployed target: the live container (`frontend-frontend-1`, created
  2026-08-16T11:26:29Z — immediately after the last of these 6 commits,
  11:24:57Z) is confirmed to already be serving this exact code (curl of
  `/twelve-traditions` shows the corrected "our services may employ special
  workers"), so the deployed-target e2e/gate runs below are testing the actual
  code under review, not a stale build.
- `tests/sentinel/glossary-check.sh`: 10/10 checks pass, including the new
  third door and reachability of `/twelve`, `/glossary`, `/onboarding`.
- `tests/sentinel/presence-ui-check.sh`: 11/11 checks pass (unaffected by the
  QR-scanner addition, which sits entirely in the UI layer above this
  contract).
- `tests/sentinel/e2e-smoke-check.sh`: full 71-spec Playwright suite against
  the live deployment, 71/71 pass, including the "no third-party requests on
  page load" chrome check (relevant to the camera-permission addition — no new
  outbound host).
- `frontend/e2e/twelve.spec.ts` re-run standalone: 7/7 pass, and the rewritten
  spec confirmed NOT gutted — it still asserts an exact door count (3), an
  exact href order, and the raw-i18n-key sweep, just updated for the new third
  door rather than weakened.
- Tradition 8 wording cross-checked against the already-plural French ("nos
  services") and Spanish ("nuestros servicios") blocks in
  `i18n.generated.ts` — the fix brings English into agreement rather than
  introducing a new inconsistency; the other 16 locales are unchanged
  (disclosed in the commit message as pending native review, not a regression).
- `docs/credits.md` and `CLAUDE.md` diffs read for sense against their stated
  rationale; no application code affected by either.
- `docs/shipped.md` already documents the BarcodeDetector camera scan +
  typed-code fallback (line 883) — reconciled with `f8f0fa5`, no drift.
- `tests/sentinel/checklist.yaml` updated in this round with a new
  `NAV-QR-BATCH-2026-08-16` entry naming all 6 commits, what was checked, and
  the coverage gaps above (per CLAUDE.md: new features gain sentinel coverage
  in the same round they ship).
- `reports/sentinel/REVIEWED.md` updated with one entry per commit SHA (full
  40-char SHA + subject, per the file's established convention), each entry
  self-contained rather than only "see report" — verified the push gate's
  `is_reviewed()` matcher recognizes all 6 short SHAs against the new entries.

## Verdict rationale

All six commits are small, frontend-only, and do the small things they say
they do: a documentation note, a credits correction, a camera-scan convenience
added alongside (never instead of) the existing paste flow, a navigation
reorder that keeps its existing wallet-gating, a CSS fix for a Chrome hover
bug plus one more link to the glossary, and a one-word wording correction that
now matches the French and Spanish translations already in the repo. None of
them touch the blockchain program, the proof circuits, or any place where
money, identity, or relationships are recorded. The one new user-facing piece
of logic — the camera QR scanner — was read line by line and does nothing
riskier than filling in the same text box a member could type into by hand;
it talks to no server and remembers nothing after the scan. Everything the
automated test suite can currently reach passed cleanly: 71 browser tests
against the real, live site, plus the mechanical checks for the glossary and
presence pages. The only thing keeping this at "PASS WITH WARNINGS" rather
than a clean PASS is that the test suite in this repo has never been able to
simulate a connected wallet or a real camera, so two small pieces of this
batch (whether the nav links truly stay hidden until connected, and the
camera scanner's live behavior) were checked by careful reading rather than by
a machine watching a real browser do it — a pre-existing, disclosed limitation
of this project's test tooling, not a new problem created by this batch. It is
safe to push.
