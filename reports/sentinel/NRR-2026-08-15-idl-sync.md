# Non-Regression Report — 2026-08-15 — Round idl-sync
Verdict: PASS WITH WARNINGS
Scope: commit `0a119307bf3c27b8af8fdec72a224cec8aaaac35` — "fix(F98): sync the frontend IDL and wire the karma accounts" (unpushed). Epics touched: E0-adjacent chain-client plumbing (F98 karma / F97 Sponsors & Sponsees UI's `establishWingPeer` call). Previous baseline: `reports/sentinel/NRR-2026-08-15-f99-map-marker.md` (commit `4dda43047483936dccc60fb1a2ddff5d78dca2c7`).

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| E — build health | Rust 45, presence-zk 12, badge-count 5, tsc | 62 | 0 | 0 |
| E — deps | npm audit (frontend) | 0 critical | 0 | unchanged (12 low/6 mod/10 high, pre-existing) |
| C — proof/program | `tests/karma.ts` on local validator (deployed from committed source) | 7 | 0 | 0 |
| A — UX/e2e | Playwright, deployed container (69 specs) | 69 | 0 | 0 |
| Standing gates | map-marker(13) privacy-sweep(5) no-3p(4) i18n(1081 keys) sponsor-wording(13) f35r2-wing-gate(9) gate-check(13) | all pass | 0 | 0 |
| D — IDL-sync specific | manual (see below) | pass | 0 | **new coverage added, see checklist** |

Total mechanical checks executed this round: 45+12+5+69+13+5+4+13+9+13+7 = 195, plus tsc, npm audit, and the ad-hoc verification work below. 0 failures.

## Findings

### Verified sound (no regression)

1. **The two IDL files are not merely "close," they are byte-identical.** `diff target/idl/ayni.json frontend/lib/ayni.json` — no output. Confirmed at three points: (a) as committed, (b) after a completely fresh `anchor build` run from the exact `programs/ayni` source at this commit (regenerates `target/idl/ayni.json` from scratch — still byte-identical to the frontend copy), (c) instruction-by-instruction / account-struct-by-account-struct / type-by-type / error-by-error programmatic diff (85 instructions, 49 account structs, all `types`, 72 `errors`, `address`, and `metadata`) — zero differences anywhere, not just on `establish_wing_peer`. The commit's claim of "82 → 85 instructions" checked out exactly; no older drift was found on any other instruction.

2. **`establish_wing_peer`'s account list matches the deployed program exactly**, including the four new karma accounts (`karma_params`, `karma_award`, `mentee_karma`, `wing_karma`) in the order the IDL and `peers.ts` both use.

3. **`karmaAwardPda`'s sort agrees with the program's `KarmaAward::lo/hi`.** Cross-checked three independent ways:
   - Algorithmic: the exact loop text was extracted from `frontend/lib/peers.ts` (`sed` against the committed file, not retyped from memory) and run against a `Buffer.compare`-based reference (the same primitive `tests/karma.ts` uses) for 2,000 random 32-byte pairs plus three targeted edge cases — differ-only-in-first-byte, differ-only-in-last-byte, and fully-identical-bytes (the `cmp === 0` branch). 100% agreement, both directions, in all 2,003 cases.
   - Rust side: `KarmaAward::lo`/`hi`'s three dedicated unit tests (order independence, non-collision of distinct pairs, first/last-byte-only edge cases — added in commit `41db5b0` per the previous round's WARNING) are part of the 45/45 `cargo test` pass.
   - Live: `tests/karma.ts` (its own, separately-maintained `Buffer.compare`-based derivation) exercised `establish_wing_peer` end to end on a local validator running a binary built from this exact commit's `programs/` source — 7/7, including "a ROLE SWAP between the same two members does not pay twice," which only passes if the seeds constraint the client derives matches what the program computes.
   - Caveat: I could not get `frontend/lib/peers.ts` to *import and execute directly* under `ts-node` in this environment (`@solana/web3.js`'s `rpc-websockets` dependency triggers `ERR_REQUIRE_ESM` outside the Next.js/webpack bundle — a pre-existing tooling limitation, not something this commit introduced). The algorithmic cross-check above used the verbatim extracted function body rather than a live `import`. This is recorded as a coverage gap below, not waived away.

4. **The byte-comparison loop is correct.** `a[i] - b[i]` operates on plain JS numbers (`Uint8Array` elements are always 0–255, read out as `number`), so the subtraction is always in-range and correctly signed — no int8/wraparound hazard exists in JS the way it can in other languages' byte-compare idioms. The loop condition `i < a.length && i < b.length && cmp === 0` correctly stops at the first differing byte or at the shorter length, and the `cmp === 0` fallthrough (`cmp = a.length - b.length`) only matters for unequal-length inputs, which never occurs here (both are always 32-byte commitments). No bug found.

5. **The deployed devnet program genuinely matches the local build, which genuinely matches the vendored IDL.** `solana program show` reports Last Deployed In Slot `484069558`, exactly the slot named in the task's CONTEXT. `solana program dump` of the live devnet binary and `target/deploy/ayni.so` built fresh from this commit's committed `programs/` source are **MD5-identical** (`aa013090ad141840c1e339a0e76226ea`). This is the strongest available confirmation that the vendored IDL describes something devnet actually has — not merely "no known instruction added since" but bit-for-bit the same program.

6. **Nothing else regressed from the IDL swap.** `cd frontend && npx tsc --noEmit` is clean (a renamed/retyped account or field would fail this in a strict Next/TS setup). `grep -rn "program.account\."` across `frontend/lib` returns nothing — the app doesn't use Anchor's typed account-fetch namespace anywhere the IDL swap could silently mistype, consistent with tsc being clean. Full Playwright suite against the already-rebuilt deployed container: 69/69, matching the commit's own claim, no new failures, no new tests silently dropped.

7. **All standing gates green, no drift:** 45/45 Rust, 12/12 presence-zk, 5/5 badge-count, `map-marker-check.sh` 13/13, `privacy-sweep.sh` 5/5, `no-third-party-assets-check.sh` 4/4, `i18n-key-check.sh` (1081/1081 keys), `sponsor-wording-check.sh` 13/13, `f35r2-wing-gate.sh` 9/9, `gate-check.sh` 13/13. `npm audit` inside `frontend/` unchanged from the previous round's baseline (0 critical, 12 low / 6 moderate / 10 high — pre-existing, not this commit's).

8. **`tests/karma.ts` on a local validator: 7/7**, deployed from a binary built at this exact commit (program ID `AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG`, matching `Anchor.toml`/the vendored IDL's `address` field).

### WARNING (recurring, non-blocking)

- **Docs drift, same recurring pattern flagged in F98-KARMA, F98-KARMA-PAIR-GUARD-FIX and F99-MAP-MARKER.** Commit `0a11930` touches `frontend/` (CLAUDE.md's trigger for "keep `docs/shipped.md` and `BACKLOG.md` reconciled in the same commit") and does not touch either file. Grepped both for "IDL", "AccountNotEnoughKeys", "0a11930" — zero hits describing this fix. It genuinely averted a live-site break (every `establishWingPeer` call from `/me` would have failed post-upgrade), which is exactly the kind of change worth a one-line dated note in `docs/shipped.md`. Not itself a new feature, so judged WARNING rather than FAIL — consistent with how prior rounds treated the same recurring gap.

## Regressions
None found.

## Privacy-invariant status
Not re-run this round — out of scope per the task brief (a narrow, targeted round on the IDL-sync commit; the spec's Layer D adversarial suite was last fully exercised in prior rounds and nothing in this commit's diff touches identity, message, sponsor-linkage, or biometric surfaces). `privacy-sweep.sh`'s mechanical forbidden-pattern subset was re-run (5/5, no new hits) as part of the standing gates. This is recorded as a scope limitation, not a pass claim on the full Layer D.

## Traditions check
No ranking, comparison, aggregation, sponsor-naming, or relationship-leaking surface was touched by this commit. `karma` remains the sole, explicitly-waived exception (CLAUDE.md, F98); its siblings (score/rating/rank/karma-adjacent terms other than `karma` itself) remain forbidden per `privacy-sweep.sh`, unchanged this round. None found ✔.

## Baseline changes this round
None. No `tests/sentinel/baselines/` snapshot was touched. `npm audit` numbers match the previous round's recorded baseline exactly (frontend: 0 critical / 12 low / 6 moderate / 10 high).

## Coverage gaps

- **NEW this round — the IDL-drift defect class itself has no gate.** This commit fixes exactly the failure mode the task asked me to hunt for: a vendored second copy of the IDL (`frontend/lib/ayni.json`) silently falling behind `target/idl/ayni.json` (the actual build artifact from the committed program source). Nothing in the build, lint, typecheck, or any standing Sentinel gate would have caught this before it shipped to a live upgraded program — it was caught by chance, this session, while manually verifying a devnet upgrade. Added `tests/sentinel/checklist.yaml` entry `F98-IDL-SYNC-GAP` recording this as an open process gap: there is no `tests/sentinel/idl-drift-check.sh` (or equivalent — e.g. `diff target/idl/ayni.json frontend/lib/ayni.json` wired into CI) that fails the build when the two diverge. This is a WARNING in this round; per the spec (§4, "missing coverage is a WARNING in round n, a FAIL in round n+1"), the *next* round on this codebase must find either the gate written or this ticket still honestly open — a repeat with no gate is a FAIL then, not now.
- **`frontend/lib/peers.ts` cannot be unit-tested by direct import in this environment** (see Finding 3's caveat) — `@solana/web3.js` → `rpc-websockets` → `uuid` triggers `ERR_REQUIRE_ESM` under `ts-node`'s CommonJS mode outside the Next.js webpack pipeline. `tests/karma.ts` maintains its own **parallel** derivation (`Buffer.compare`-based) rather than importing the frontend module, so a future divergence between the two client-side implementations (frontend vs. test) would not be caught by any committed test — only by a round doing this kind of manual cross-check, as this one did. Recommend either a webpack/jest-based unit test that can actually import `frontend/lib/peers.ts`, or refactoring the shared PDA-derivation logic into a package both `tests/` and `frontend/` import identically, so there is exactly one implementation instead of two that must be kept in lock-step by discipline.
- Full Layer D adversarial suite (7 privacy invariants) not re-run this round — see Privacy-invariant status above; carried as an open gap since this was an intentionally narrow round, not because the invariants are believed to be at risk from this commit.

## Verdict rationale

This commit fixes a real, live-site-breaking bug: the app's own copy of the on-chain program's instruction manifest (the IDL) had quietly fallen out of date, so every member trying to set their sponsor from the `/me` page would have gotten a confusing on-chain error the moment the upgraded program went live on devnet. I checked the fix from every angle I could reach: the two IDL files are now not just close but byte-for-byte identical, in every instruction and account, not only the one the commit mentions; I independently rebuilt the on-chain program from today's source and its bytes exactly match what devnet is actually running, so nothing is being described "on faith"; the trickiest part of the fix — sorting two commitments the same way in JavaScript as the on-chain program does in Rust — checked out under 2,000+ deliberately awkward test cases and also succeeded in real transactions against a live test blockchain; and the full set of automated checks (build, tests, browser tests, and this project's own custom safety gates) all pass with no new failures. The one thing worth a human's attention, carried forward from earlier rounds and not new to this fix, is that the project's paperwork (docs/shipped.md and the backlog) was not updated to mention this fix, which is a minor housekeeping gap rather than a working-code problem. I also flagged, and recorded a fix for future rounds to check, that nothing in the automated testing today would have caught this exact class of mistake before it happened — that gap is now written down so it does not silently recur.
