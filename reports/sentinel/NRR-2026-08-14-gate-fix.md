# Non-Regression Report — 2026-08-14 — Round gate-fix

> **CORRECTION, added by the main agent after this report was written — read
> before relying on the verdict below.**
>
> This round reviewed `6b386d7`. That commit **is not in history**: it was
> amended into **`16bb15f`**, which is what was pushed. The amendment happened
> after this round was launched and before it returned, so nothing here is
> Sentinel's fault and nothing here has been altered except this banner.
>
> The delta `6b386d7..16bb15f` is **not cosmetic**. It adds an `is_reviewed()`
> helper and a skip in the override loop, changing a property this report
> explicitly verified: "the override path requires naming EVERY non-bookkeeping
> commit" became "…every non-bookkeeping commit **not already covered in
> REVIEWED.md**". Section 1 below therefore describes a gate that is no longer
> the gate in the tree.
>
> **The PASS below does not cover `16bb15f`.** Sections 2 (`6b95d77`) and 3
> (`114f3af`) are unaffected and stand. A focused round over exactly the delta
> is recorded in `NRR-2026-08-14-gate-delta.md`; until that lands, `16bb15f` is
> unreviewed and is deliberately not registered in `REVIEWED.md`.
>
> The push itself went out under a recorded override — see `OVERRIDES.md`,
> entry for `16bb15f, 6b95d77, 114f3af`.

**Verdict: PASS**

**Scope:** exactly three commits, briefed and reviewed in full:

- `6b386d7` fix(sentinel-gate): widen the bookkeeping exemption; overrides must name all
- `6b95d77` docs(f59): presence design of record, and the Epic 4 amendment it needs
- `114f3af` fix(glossary): correct two tag spellings at source, regenerate

HEAD at review time: `6b386d749512550e32820a5eff2acc9aa55e472a`.
Previous baseline: `95c7c83f4eaf89e03f18194d4054efedc99189ff` (PASS WITH WARNINGS,
"governance round" — covers `2f5a7c4`/`1dfefa1`, out of scope here per brief, not
re-reviewed).

`95c7c83` itself is confirmed pure bookkeeping (`reports/sentinel/**` and
`tests/sentinel/checklist.yaml` only — `git show --stat 95c7c83` has no other
paths) and is exempt from the registry by the gate's own rule; not added to
REVIEWED.md.

**`programs/` and `circuits/` are unchanged this round** —
`git diff 1dfefa1 HEAD --stat -- programs/ circuits/` is empty. A full
`anchor test` was therefore **skipped**: none of the three commits in scope
touch a program or a circuit, so there is nothing on-chain for it to catch that
the path diff hasn't already ruled out. Layers C and F (proof/contract,
sponsor-recovery) are consequently N/A this round, not silently passed.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| A (UX/e2e) | 0 (no Playwright suite in this repo, carried gap) | — | — | none |
| B (API contract) | 0 (no API suite in this repo, carried gap) | — | — | none |
| C (proof/contract) | N/A — programs/circuits untouched, confirmed by path diff | — | — | none |
| D (privacy invariants, adversarial) | targeted grep sweep on the 3 in-scope diffs (forbidden field names, telemetry, console.log of identity) | 1 | 0 | none |
| E (build health) | glossary regen byte-identity, tag/entry counts, xlsx zip integrity | 3 | 0 | none |
| F (sponsor recovery) | N/A — not touched this round | — | — | none |
| Gate self-test (new) | `tests/sentinel/gate-check.sh`, live gate | 11 | 0 | **new this round** |
| Gate self-test (before/after control) | same suite against pre-fix gate (`95c7c83:scripts/sentinel-push-gate.sh`) | 9 | 2 (expected — proves the suite discriminates) | new this round |
| Gate adversarial probes (Sentinel-authored, not in gate-check.sh) | path traversal, prefix-collision dirs, mixed-commit smuggle | 5 | 0 | new this round |
| Glossary regression gate | `tests/sentinel/glossary-check.sh` | 10 | 0 | re-run, unaffected in shape, content changed as expected |

## Verification detail

### 1. `6b386d7` — `scripts/sentinel-push-gate.sh`

Read the full script (310 lines) end to end, diffed the verdict-parsing block
and the REVIEWED.md per-commit matcher against the pre-fix version at `95c7c83`,
and ran both the new `gate-check.sh` suite and hand-built adversarial probes
against a disposable synthetic git repo (never touched this repo's real
history or hooks).

- **Bookkeeping exemption is one variable,
  `BOOKKEEPING='^(reports/sentinel/|tests/sentinel/)'`**, used by
  `is_bookkeeping_commit()`, the whole-push "bookkeeping only" pre-check, and
  the per-commit registry-exemption check alike (previously two independent
  copies of a narrower pattern). Confirmed nothing under `programs/`,
  `circuits/`, `frontend/`, `indexer/`, top-level `scripts/`, or `tests/`
  outside `tests/sentinel/` can match it: the pattern is anchored (`^`) and
  requires the literal string up to and including the trailing `/`.
  - Tried to construct a collision. `tests/sentinel/../../programs/evil.rs`:
    git normalises the path before the gate ever sees it (`git show
    --name-only` reports `programs/evil.rs`), so no traversal is possible
    through the object model.
  - `reports/sentinel-fake/evil.txt` and `tests/sentinel-other/x.sh`: neither
    matches — the regex requires the trailing slash after `sentinel`, so a
    sibling directory whose name merely starts with `sentinel` is correctly
    treated as non-bookkeeping and blocks the push, as it should.
  - A single commit that mixes an `OVERRIDES.md` append with a substantive
    `programs/` file **in the same commit** is correctly blocked: it is not
    bookkeeping (touches a path outside the pattern), and it cannot name its
    own SHA, so the override path — which requires every non-bookkeeping
    commit to be named — refuses it. This is a real, deliberately tested edge
    case and it holds.
- **`docs/` is confirmed NOT in the exemption.** A synthetic commit touching
  only `docs/presence.md` (mirroring the real `6b95d77`) is blocked by the
  live gate exactly as claimed. The rationale in the script's own comment
  block — a design-of-record doc can amend a privacy invariant, and that is
  the reviewer's business — matches what `6b95d77` actually is (see §3).
- **Override path now requires every non-bookkeeping commit in the push to be
  named.** Read the loop: it collects `override_unnamed` across ALL pushed
  commits via `pushed_commits()`, skipping only `is_bookkeeping_commit`
  ones, and blocks if that list is non-empty — no early `break` remains (the
  old `named=1; break` bug that let one named commit vouch for an entire
  push is gone). Verified both directions with a synthetic push carrying two
  substantive commits: naming one is blocked, naming both is allowed.
- **Exemption is decided by paths only, never by commit subject.** Grepped the
  full script for `chore(sentinel)` and any subject-matching construct — the
  only hits are inside comments explaining *why* subject-matching was
  rejected; the executable code path never inspects `git log --format=%s`
  for anything but display truncation (`cut -c1-60`) after a decision has
  already been made on paths. A synthetic commit subject-lined
  `chore(sentinel): totally innocent bookkeeping` but touching
  `programs/ayni/src/lib.rs` is correctly blocked.
- **No collateral damage.** Diffed the verdict-parsing block
  (`verdict=...` through the case/esac) between `95c7c83` and HEAD: byte-
  identical, untouched. Diffed the REVIEWED.md per-commit exemption block: the
  only change is a call to the new shared `is_bookkeeping_commit()` helper in
  place of an inlined, narrower version of the same test — same semantics,
  wider pattern, no new branch. The FAIL/CRITICAL veto (`*FAIL*|*CRITICAL*` ->
  `__VETOED__`) is untouched and re-verified live (a synthetic FAIL-verdict
  push with a substantive commit is blocked; a bookkeeping-only push under
  the same FAIL verdict is still allowed, so a FAIL can always be recorded).

**Fixed a latent new-branch bug as a side effect** (bare `git diff <sha>` vs.
`changed_files()` for the override-log check) — read and confirmed correct;
not independently exercised against a real new-branch push in this round
since the repo has no such branch in scope, but the fix is mechanical and the
replacement function (`changed_files()`) was already covered elsewhere in the
same script before this commit.

### 2. `tests/sentinel/gate-check.sh` — honest coverage, not theatre

Ran it against the live (post-fix) gate: **11/11 pass.**

Ran it against the pre-fix gate exactly as instructed:

```
git show 95c7c83:scripts/sentinel-push-gate.sh > /tmp/gate-old.sh && chmod +x /tmp/gate-old.sh
./tests/sentinel/gate-check.sh /tmp/gate-old.sh
```

Result: **9/11 pass, 2/11 fail** — the claimed number, confirmed independently
rather than accepted. The two failures are exactly the two named defects:

```
FAIL  new tests/sentinel/*.sh script is bookkeeping -> allowed (expected exit 0, got 1)
FAIL  override naming 1 of 2 substantive commits -> BLOCKED (expected exit 1, got 0)
```

This is genuine before/after discriminating evidence — the suite fails
precisely where the old gate was wrong and nowhere else, and passes on the new
gate. Verdict: honest coverage.

### 3. `6b95d77` — `docs/presence.md`, the Epic 4 amendment

`git diff 1e3c738 6b95d77` is confirmed **empty** — identical tree; the commit
split from `1e3c738` changed no content, only history shape, exactly as
claimed.

Read the document adversarially, specifically hunting for language that could
be read as a general licence rather than a scoped one:

- The scoping sentence is explicit and unambiguous: *"this supersedes the
  'never summed' reading for F59 only... Any other feature that introduces a
  per-person counter is still a CRITICAL."* Both halves are present — the
  narrow grant and the explicit reassertion of the general rule — so there is
  no reading under which this becomes a blanket waiver.
- What is actually waived is narrow and well-characterised: **ledger
  archaeology** (a signature-count derivable via
  `getSignaturesForAddress` against an immutable transaction log — a property
  no on-chain design can prevent, not a live-state field). The **live-state**
  rule is simultaneously *tightened*, not loosened: "must not hold or expose a
  count, total, streak, or ordering of a person" — stricter language than
  Epic 4's original "never summed", and the account layout backs it
  (`Presence { last_month: u32, bump: u8 }`, 13 bytes, no `Vec`, no
  timestamp, no `first_month`, no witness identity, no `circle`/`member`
  field — each exclusion justified in a table in the doc).
- The document records the counter-free alternative that was offered and
  declined (a signed line inside the F60 encrypted profile, no PDA, nothing
  to enumerate) — this is the honest kind of design note: it shows the
  narrower option was considered and names why it wasn't taken, rather than
  omitting it.
- The "honest leak list" (§4) includes two items that would be easy to bury:
  the witness anonymity set collapsing to 1 in a 2-member Circle, and the QR
  handoff disclosing the subject's raw commitment to the witness — both
  correctly flagged as requiring UI disclosure before the act, not just in
  this document.
- No code has landed for F59 yet. `grep -rn "Presence" programs/` finds only
  an unrelated forward-reference comment in
  `issue_provisional_membership.rs` ("elections, presence — fails by
  construction until a trusted servant..."); no `Presence` account, no
  `last_month` field, no `activate`/`clear_presence` instruction exists in
  `programs/` as of this HEAD. Confirms the commit message's claim that this
  is design-before-code.

No CRITICAL finding here. The scoping holds under adversarial reading.

### 4. `114f3af` — glossary tag-spelling fix

Reproduced every numeric claim independently rather than trusting the commit
message:

- `node scripts/build-glossary.mjs` regenerated against the committed
  `glossary_v1.xlsx`, then diffed against the committed
  `frontend/public/glossary.json`: **byte-identical**
  (`git diff --quiet` exit 0).
- Entry count: **342** (`count` field and `entries.length` both agree).
- Distinct tags: **43** (was 44; the two Buddhism spellings merged into one
  facet, matching the claim exactly).
- `Budhism` and `Freemassonery` tags: **absent**, zero occurrences.
- `Buddhism` now carries **7** terms, `Freemasonry` carries **1** — matches
  the commit message's numbers exactly.
- Ran `tests/sentinel/glossary-check.sh` in full: **10/10 pass**, including
  its own independent Python/xml re-derivation of the entry count from the
  raw xlsx (not the JS build script's own code path), the no-duplicate-terms
  check, the no-member-linkable/scoring-field-name check, the
  single-static-fetch privacy check, nav reachability, and the 19-locale i18n
  resolution check for the round's other changed keys.
- `scripts/fix-glossary-tags.mjs` read in full: rewrites only
  `xl/sharedStrings.xml`, copies all other zip entries through unchanged,
  uses word-boundary matching (so "Buddhism" cannot be re-matched by a
  "Budhism" fix), and is idempotent. `console.log` calls in it are build-tool
  progress output (occurrence counts of a string replacement, zip entry
  count) — not identity material; confirmed by reading each call site.

## Privacy-invariant status (Layer D, the seven assertions)

Not independently re-run in full this round — no application code changed
(`programs/`, `circuits/`, `frontend/lib`, `indexer/` are untouched by all
three in-scope commits; confirmed by path diffs above and by the commit
`--stat`s themselves, which touch only `scripts/`, `tests/sentinel/`,
`docs/`, and the glossary artifact pair). The full adversarial-dump suite
(`npm run test:adversarial`) does not exist in this repo (documented,
carried-forward gap — see prior rounds' reports); what exists and was run is
the targeted grep sweep below, scoped to the actual diffs in scope.

1. sponsor identity / sponsor→member edge — N/A this round, no code touched.
2. trust list / chosen-ones list — N/A this round.
3. message content / metadata — N/A this round.
4. biometric material — N/A this round.
5. circle roster — N/A this round.
6. hidden-content detection — N/A this round.
7. faucet parrain→neophyte link — N/A this round.

Forbidden-pattern grep across the three commits' actual file changes
(`scripts/fix-glossary-tags.mjs`, `docs/presence.md`,
`scripts/sentinel-push-gate.sh`, `tests/sentinel/gate-check.sh`): no
telemetry/analytics SDK, no tracking pixel, no `console.log` of identity
material, and every `count`/`rank`/etc. text hit is either (a) a byte/zip
entry count in a build script, (b) prose *about* the Epic 4 rule itself in
`docs/presence.md` (the rule being discussed, not a new field), or (c) the
gate's own comments about a bug where a commit was wrongly "counted" as
reviewed. None is a new member-facing scoring field. ✔.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found in the three in-scope commits. `docs/presence.md` is itself a
document *about* preventing exactly this class of leak for F59, and its
scoping language was verified above to not create a loophole. No sponsor
identity, trust list, or member ranking is introduced by any of the three
commits. ✔.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched by any of the
three in-scope commits.

## Coverage gaps

- No Playwright/e2e suite, API-contract suite, or `test:adversarial` exist in
  this repo — carried forward unchanged from every prior round; not
  introduced or worsened by this round's three commits.
- F59 (`docs/presence.md`) has **no code yet** and therefore no gate coverage
  yet beyond this round's document review — flagged here as a WARNING-class
  future gap: when F59's program/circuit code lands, Sentinel must verify the
  live-state layout matches what this design document promises (13 bytes, no
  `Vec`, no timestamp, closed-month-only writes, `single_leaf_root` never
  pushed to `RecentRoots`) — this is not yet checked because there is nothing
  to check.
- `tests/sentinel/gate-check.sh` covers the gate's path/override logic well
  but does not exercise a REAL `git push` through an installed
  `.git/hooks/pre-push` symlink end-to-end (it invokes the script directly
  with synthetic stdin) — a reasonable simplification for a unit-style test,
  noted rather than silently assumed equivalent.

## Verdict rationale

All three changes do what their commit messages say, and none of them weakens
anything. The push gate's bookkeeping exemption is now wider in exactly the
place it needed to be (Sentinel's own test scripts) and nowhere else — real
code, and specifically `docs/`, still trips it, and I could not find a path,
subject-line, or same-commit trick that sneaks something past it. The new
test suite for the gate is real evidence, not decoration: it was shown to
fail against the old, buggy gate in exactly the two places that were buggy,
and pass against the fix. The presence-attestation design document narrows
an old privacy promise in one very specific, disclosed way — a ledger can
someday be searched to learn how many months someone attested — while making
everything else about that feature stricter than before, and it says plainly
that this narrow exception does not extend to any other feature. The
glossary fix corrected two real misspellings at the source file rather than
patching the generated output, and regenerating it from scratch reproduces
the committed file exactly, byte for byte. Nothing here touches the
blockchain program or the cryptographic circuits, so there was nothing on
that side to re-test this round. No privacy invariant was weakened, no
Tradition was violated, and no coverage was shipped without a matching
Sentinel check.
