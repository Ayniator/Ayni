# Non-Regression Report — 2026-08-16 — Round ui-batch

Verdict: **PASS WITH WARNINGS**

Commit reviewed: `fe9acdb57ca0a5ce99ed185fe85177adb6b0f58c`
(`feat(F59,F97,F101): presence ceremony UI, reverse sponsor invite, anonymous
display, i18n bodies, reflections off the bundle`).

## How this round was run

Two earlier attempts at this round ran as in-session Sentinel agents and were
lost when the process restarted mid-run (SSH-cut / process exit), each time
without writing a report. The mechanical verification was therefore moved into a
**detached** battery — `scripts/sentinel-verify.sh`, launched under `setsid
nohup` in its own session (reparented to PID 1) so a disconnect could not reach
it. Its full log is `~/ayni-sentinel-verify.log`, ending `VERDICT: PASS`. This
report records that run's results; the adversarial reasoning (what each check
means, and the account-order review that no automated check covers) is the
operator's, added here.

## Summary table

| Layer | What ran | Result |
|-------|----------|--------|
| Sentinel gates | all 18 `tests/sentinel/*.sh` | 18/18 pass |
| Program | `cargo test` | 47/47 |
| Proofs | `presence-zk.test.mjs` | 12/12 |
| Client/program pin | `presence-client-vectors.test.mjs` | 5/5 |
| Cross-impl | `pda-sort-check.mjs`, `badge-count.test.mjs` | 8/8, 5/5 |
| Types | `tsc --noEmit` (frontend) | clean |
| Data pipeline | `extract-reflections-xlsx.mjs` idempotency | byte-identical |
| Mutation probes | 3 (see below) | all fired red, all restored green |
| UX/e2e | Playwright against the deployed container | 71/71 |
| Tree | no tracked source file left modified | clean |

## Regressions

**None.** No functional or privacy regression is attributable to `fe9acdb`.

## Mutation probes — the checks were proven able to fail

A green gate is only evidence if it can go red. The three checks whose failure
would be silent and expensive were each mutated, confirmed red, and restored:

1. **presence nullifier mask** (`frontend/lib/presence.ts`, `d[0] &= 0x1f` →
   `0x3f`): `presence-client-vectors.test.mjs` went red. This is the check that
   the browser and the program agree on the external nullifier byte for byte; a
   drift makes every presence proof verify against nothing.
2. **get-app store disclosure** (the English "not yet on Google Play or the App
   Store" string, softened): `f92-f93-check.sh` went red. Confirms the F93
   disclosure gate followed the strings into the dictionary when the page body
   was i18n-extracted, rather than passing vacuously against a page that no
   longer holds the prose.
3. **relay wing_peer account count** (`relayPolicy.ts`, `accountCount: 11` → `7`
   with the old `authorityIndex`): `presence-ui-check.sh` went red. This is the
   exact stale-allowlist defect the commit fixed — a relayed sponsorship
   silently refused while the self-pay path worked — now pinned so it cannot
   recur unnoticed.

## What was reviewed by reading, not by a gate

- **Presence account orders** in `presence.ts` match `target/idl/ayni.json`:
  `attest_presence_zk` = circle, member_tree, recent_roots, presence, payer,
  system_program; `clear_presence` = circle, presence, payer, system_program. A
  wrong order is an `AccountNotEnoughKeys` at runtime that no wallet-less test
  here exercises.
- **computeUnits is allowlist-derived, never client-supplied**: the relay route
  prepends `ComputeBudgetProgram.setComputeUnitLimit({ units: verdict.computeUnits })`,
  and `verdict.computeUnits` is read from `RELAY_ALLOWLIST`, not from the request
  body. `attest_presence_zk` declares 600_000; the self-pay fallback in
  `presence.ts` requests the same figure (pinned equal by `presence-ui-check.sh`).
  `clear_presence` declares none (one proof fits the 200k default).
- **No program code changed**, so the deployed devnet binary is unaffected and
  `frontend/lib/ayni.json` stays byte-identical to `target/idl/ayni.json`
  (`idl-sync-check.sh` green).

## Privacy / Traditions

- `privacy-sweep.sh` green: no analytics, no identity material in logs, and the
  ranking-identifier sweep holds (karma remains the sole waived exception).
- **Anonymity request satisfied**: the sponsor/sponsee/karma rows render an
  Identicon seeded by the commitment plus an 8-char short code; no full 64-hex
  commitment is rendered in JSX in `KarmaCard.tsx`, the MentorshipCard, or the
  sponsor-request page.
- **Presence honesty rules hold**: the member page renders a month or nothing
  (no "not yet attested" placeholder — the third state `docs/presence.md` §5
  forbids), the handoff warns about commitment disclosure BEFORE the scan, and
  all wording is vouching wording (`presence-ui-check.sh`, verification-claim
  check with comments stripped).

## i18n

`i18n-key-check.sh` green (every `t()` key resolves), and the raw-key namespace
sweep in `e2e-smoke-check.sh` covers all 25 namespaces including the newly-added
`mw`. New key sets — `me.presence.*` (14), the F97 `ask`/reverse keys,
`getapp.*`, `mw.*` — are present in all 19 locales.

## Warnings

1. **Non-English machine translations, unverified by a native speaker.** This
   commit added several hundred translated strings across 19 locales
   (`me.presence.*`, the F97 reverse-direction keys, the extracted `getapp.*`
   and `mw.*` bodies). They are structurally present and pass every mechanical
   check, but their fidelity in the 16 non-Latin/less-common locales has not
   been reviewed by a speaker. Same standing caveat as prior i18n rounds; not a
   blocker.
2. **The presence handoff QR is untested end to end.** The two-device ceremony
   (subject code → witness proof → one transaction) is proven at the derivation
   layer (frozen-vector pin) and the account layer (IDL match), and the proof
   helpers are the ones `presence-zk.test.mjs` exercises — but no test drives a
   real subject/witness handoff through the browser, because it needs two wallets
   with two distinct voting keys. The relay path's compute budget is likewise
   asserted structurally, not by a live relayed submission. First real exercise
   will be manual on devnet.
3. **~2.5 MB `public/reflections.json` is now a static fetch.** The bundle weight
   was moved off the client (the point of F101's fix), but the JSON itself is
   still large; a member on the reflections page downloads it once. Acceptable
   and a strict improvement over shipping it in every bundle, noted for whoever
   later wants per-day fetching.

## Coverage added this round

`tests/sentinel/checklist.yaml` gains entries for F59-presence-UI (incl. the
client-vector pin and the relay-budget rule), F97-reverse, F101-bundle, and the
F93/F95 i18n-body closures.

## Verdict rationale

Every mechanical invariant holds, the three silent-failure checks were proven
able to fail, and the two source-review items (account order, allowlist-derived
compute budget) are sound. The warnings are disclosures — unverified
translations and an end-to-end handoff that only a two-wallet manual run can
exercise — not defects. PASS WITH WARNINGS.
