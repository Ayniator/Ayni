# Non-Regression Report — 2026-08-14 — Round gate-delta

Verdict: **FAIL**

Scope: **exactly** `git diff 6b386d7 16bb15f` (the amend-after-review delta on
`scripts/sentinel-push-gate.sh` and `tests/sentinel/gate-check.sh`). Nothing
else was in scope: `6b95d77` and `114f3af` were already covered by
`NRR-2026-08-14-gate-fix.md` (PASS) and are not re-reviewed here.
Commit under review: `16bb15f`. Previous baseline reviewed: `6b386d7`
(reachable only via reflog; `git cat-file -t 6b386d7` → `commit`, confirmed).
Repo HEAD at time of this round: `fd56345`.

This is a narrow, targeted round per instruction. Layers B/C/D/E and the
full checklist are **out of scope** and not re-run; only the four numbered
questions in the task are answered, each with an executed reproduction, not
review-only.

## Summary table

| Layer | Tests | Pass | Fail | New since last round |
|-------|------:|-----:|-----:|---------------------|
| Delta-only script review (§1, §2) | — | — | — | — |
| `tests/sentinel/gate-check.sh` vs live gate (16bb15f) | 12 | 12 | 0 | +1 test vs prior round's 11 |
| `tests/sentinel/gate-check.sh` vs pre-delta gate (6b386d7) | 12 | 11 | 1 | discriminates correctly |
| Adversarial exploit repro, override path, post-delta | 1 | 0 (exploit succeeded) | 1 | **new finding** |
| Adversarial exploit repro, override path, pre-delta | 1 | 1 (exploit blocked) | 0 | confirms pre-existing behaviour |
| Adversarial exploit repro, normal path, both versions | 2 | 2 (exploit succeeded on both) | 0 | confirms this part is NOT new |
| Scope check (`--name-only`) | 1 | 1 | 0 | confirms claimed 2-file scope |

## Findings

### 1. The question that matters: is the relaxation safe?

**No — it is a hole, and it is CRITICAL. It was introduced by this delta.**
The two parts of the question must be kept separate, because they have
different origins:

**(a) Pre-existing, NOT introduced by this delta.** `REVIEWED.md` lives under
`reports/sentinel/`, which the `BOOKKEEPING` pattern exempts. A commit that
does nothing but append a line to `REVIEWED.md` is therefore itself
`is_bookkeeping_commit` and needs no coverage of its own — it can never be
required to appear in `REVIEWED.md` before it is trusted. Nothing checks that
a `REVIEWED.md` line corresponds to an actual round; the matcher is a bare
regex over the file's contents. This means **any commit's SHA can be marked
"reviewed" by anyone who can commit**, with no round having happened, simply
by appending a line. I confirmed this already existed at `6b386d7`, byte-for-byte
identical to the version now in `16bb15f`:

```
$ git show 6b386d7:scripts/sentinel-push-gate.sh | grep -n REVIEWED
291:    if ! grep -qE "^[[:space:]]*[-*]?[[:space:]]*($sha|$short)\b" "$REVIEWED" 2>/dev/null; then
```

I built a standalone forgery repro (malicious `programs/` commit + a
bookkeeping-only commit appending a fake `REVIEWED.md` line, no override used,
`latest.md` says PASS) and ran it against both versions:

```
=== NORMAL path (no override), forged REVIEWED.md, verdict PASS ===
-- pre-delta gate (6b386d7) --
  Sentinel push gate: latest verdict is PASS, and every pushed commit is reviewed.
EXIT=0
-- post-delta gate (16bb15f / live) --
  Sentinel push gate: latest verdict is PASS, and every pushed commit is reviewed.
EXIT=0
```

Identical outcome on both. This part of the weakness is a **pre-existing
design property** of the normal (non-override) path, already present in the
version this project's own registry marked reviewed and PASSed
(`6b386d7`, per `REVIEWED.md`'s own entry: *"Read the full 310-line script...
Ran tests/sentinel/gate-check.sh against the live gate (11/11 pass)"*). It is
not a regression of this delta and is called out here only to establish the
baseline correctly, per the instruction to be precise about which side of the
line each fact falls on. It remains a real, standing weakness of the gate as a
whole and belongs on the backlog as its own finding, but it does not belong to
this round's verdict.

**(b) Introduced by this delta. CRITICAL.** Before the delta, the override
path never consulted `REVIEWED.md` at all — `is_reviewed()` did not exist, and
the override loop's only test was "does `OVERRIDES.md` name this commit".
Every non-bookkeeping commit in a push had to be individually named in
`OVERRIDES.md`, full stop, regardless of anything in `REVIEWED.md`. That gave
`OVERRIDES.md` a **complete** audit trail of every commit that ever went out
under an override — the exact property `NRR-2026-08-14-gate-fix.md` verified
and the exact property CLAUDE.md's override design depends on ("An override
must be auditable... naming the commit(s)").

The delta adds `is_reviewed "$c" && continue` inside that loop (site (a)).
Combined with (a) above — that a `REVIEWED.md` line is trivially forgeable and
requires no round — this means: **a substantive, non-bookkeeping commit can
now be pushed under `SENTINEL_OVERRIDE` while never once appearing in
`OVERRIDES.md`**, as long as it is paired with a bookkeeping-only commit that
appends a matching line to `REVIEWED.md`. `OVERRIDES.md` still has to be
*touched* by the push (the `override_logged` check), but it can be touched
with content that names nothing relevant to the commit actually being smuggled
through.

I built this exact exploit and ran it against both gate versions,
same commit sequence, same `SENTINEL_OVERRIDE`:

```
# BASE: latest.md = FAIL (normal path is closed)
# EVIL: programs/ayni/src/backdoor.rs  ("feat: quietly widen an admin key check")
# FORGE: bookkeeping-only commit appending "- <EVIL_SHORT> covered by a round" to REVIEWED.md
# TIP: bookkeeping-only commit appending an UNRELATED line to OVERRIDES.md
#      (OVERRIDES.md never mentions EVIL's SHA anywhere)

$ grep -c "$EVIL_SHORT" reports/sentinel/OVERRIDES.md
0   # confirmed: EVIL is named nowhere in the audit log

-- pre-delta gate (6b386d7) --
  BLOCKED: SENTINEL_OVERRIDE was set, but reports/sentinel/OVERRIDES.md does not name:
    a6ab655 feat: quietly widen an admin key check
EXIT=1

-- post-delta gate (16bb15f / live) --
  Sentinel push gate OVERRIDDEN — and recorded in reports/sentinel/OVERRIDES.md.
  Reason given: urgent
EXIT=0
```

The pre-delta gate blocks this push. The post-delta gate lets it through with
exit 0, and the audit log (`OVERRIDES.md`) contains no trace of the commit
that actually shipped. This defeats the stated purpose of the override
mechanism verbatim from the script's own comment ("EVERY substantive commit
must be named, not merely one of them... An unreviewed path to a live network
is the class of thing this gate exists to stand in front of") and from
CLAUDE.md ("several sessions share one git identity... an override that lives
only in a terminal cannot be attributed to anyone" — here, an override can
carry a commit attributable to nothing: not `OVERRIDES.md`, and the forged
`REVIEWED.md` line is itself exempt from ever needing a real round).

**Verdict on the relaxation: unsafe. This is a regression, introduced by
`16bb15f`, severity CRITICAL** (a change that lets a member — here, a commit —
bypass the audit/attribution mechanism the whole gate exists to provide; the
prime-directive analogy is exact: this is the mechanical-governance equivalent
of an unattributable rank-granting side channel).

Note for the record: `test(governance): cover the ballot-integrity fix;
reconcile the registry` (114f3af's neighbour `1dfefa1`) is unrelated and out of
scope; mentioned only to avoid any confusion with this round's subject.

### 2. Is call site (b), the coverage-check refactor, semantically identical?

**Yes — confirmed as a pure refactor, no behaviour change.** Diffed:

```
# 6b386d7 (inline):
if ! grep -qE "^[[:space:]]*[-*]?[[:space:]]*($sha|$short)\b" "$REVIEWED" 2>/dev/null; then

# 16bb15f (via helper):
is_reviewed() {  # $1 = sha
  local short
  short="$(git rev-parse --short "$1" 2>/dev/null || echo "$1")"
  grep -qE "^[[:space:]]*[-*]?[[:space:]]*($1|$short)\b" "$REVIEWED" 2>/dev/null
}
...
if ! is_reviewed "$sha"; then
```

Checked each concern named in the task:
- **`local` under `set -u`.** The script runs with `set -uo pipefail` (no
  `-e`). `local short` declares the variable before any read, then
  immediately assigns it — never read unset. `local` inside a function shadows
  the outer, script-level `short` (set at line 293 in the caller's loop, e.g.
  `short="$(git rev-parse --short "$sha")"`) only for the function's duration;
  bash restores visibility of the outer variable on return, so the caller's
  own `short` (used later at line 308 in the "unreviewed commit: $short ..."
  message) is unaffected. Verified by execution, not just reading: ran the
  live gate against a repo with an actually-unreviewed commit and confirmed
  the printed short SHA is correct (see missing-`REVIEWED.md` test below,
  which exercises this exact line).
- **Short-vs-full SHA handling.** Both compute `short` via
  `git rev-parse --short`; the helper adds a `|| echo "$1"` fallback the
  inline code did not have, but `$1`/`$sha` is always a resolved commit from
  `git rev-list`, so `git rev-parse --short` cannot fail in practice — the
  fallback is dead code, not a behaviour change.
- **`REVIEWED.md` missing or unreadable.** Both the inline grep and
  `is_reviewed()` suffix the grep with `2>/dev/null`, so a missing file makes
  the grep fail silently and the commit is correctly treated as unreviewed
  (fail closed). Confirmed by execution:
  ```
  === REVIEWED.md missing entirely -> should be treated as unreviewed, blocked ===
    unreviewed commit: 82a5c02 feat: X, no REVIEWED.md exists at all
    BLOCKED: 1 commit(s) above are named by no Sentinel report.
  EXIT=1
  ```

Call site (b) is a pure, behaviour-preserving refactor. All risk is
concentrated in call site (a), the new skip in the override loop (§1(b)
above), which is new behaviour by design, not a refactor artifact.

### 3. Test-suite re-run and fixture-baseline check

`./tests/sentinel/gate-check.sh` against the live (post-delta) gate:

```
passed=12 failed=0
```

12 tests, up from the prior round's 11, as expected. The 12th test
("override need not re-name an already-REVIEWED.md commit") is genuinely
discriminating — built the pre-delta gate from the reflog-only commit and
re-ran the identical suite against it:

```
$ git show 6b386d7:scripts/sentinel-push-gate.sh > /tmp/gate-6b386d7.sh && chmod +x /tmp/gate-6b386d7.sh
$ ./tests/sentinel/gate-check.sh /tmp/gate-6b386d7.sh
...
  FAIL  override need not re-name an already-REVIEWED.md commit (expected exit 0, got 1)
...
passed=11 failed=1
```

Exactly the 12th test fails against the pre-fix gate; the other 11 are
unchanged. The suite discriminates before/after correctly.

**The two repointed baselines (`$C` → `$O3` in the FAIL-verdict regression
section) — checked for a weakened test, not accepted on the comment's say-so.**
Reconstructed the fixture manually with the OLD baseline (`$C`) against the
**new** gate to see what the un-repointed test would actually have done:

```
=== using OLD baseline C (pre-repoint) against NEW gate ===
FAIL blocks substantive push (baseline C): 1
bookkeeping-only allowed under FAIL (baseline C): 1     <- expected 0, would be a FAIL
=== using NEW baseline O3 (post-repoint) against NEW gate ===
FAIL blocks substantive push (baseline O3): 1
bookkeeping-only allowed under FAIL (baseline O3): 0    <- matches expected 0
```

Confirmed: leaving the old baseline (`$C`) in place would sweep the
newly-added `R`/`REG`/`U`/`O3` fixture commits (two of which, `R` and `U`,
touch `programs/`) into the diff range, so "bookkeeping-only push allowed
under FAIL" would stop being bookkeeping-only and the test would legitimately
fail (exit 1 against an expectation of 0) — not weakened, but genuinely
broken by fixture drift if left unrepointed. Repointing to `$O3` (the tip
immediately before this section) is a correct fixture fix that restores the
test's original intent; it changes no assertion, expected value, or scenario,
only which commit is used as the diff floor. This is not the kind of edit
that hides a regression — it is necessary bookkeeping for a linear fixture
history where an earlier section grew by four commits.

### 4. Scope confirmation

```
$ git diff 6b386d7 16bb15f --name-only
scripts/sentinel-push-gate.sh
tests/sentinel/gate-check.sh
```

Confirmed: exactly the two files claimed, nothing else. `programs/`,
`circuits/`, `frontend/`, `indexer/`, `docs/` all untouched by this delta.

## Privacy-invariant status (Layer D)

Not applicable / not re-run this round — out of scope per the task framing (a
governance/CI script, no application or proof-layer code in the diff, no
member data touched). Not claimed as PASS; simply not exercised.

## Traditions check (rank/compare/aggregate/name-a-sponsor/leak-a-relationship)

None found — the delta touches only push-gate shell logic and its test
harness; no member-facing model or UI is in scope.

## Baseline changes this round

None. No file under `tests/sentinel/baselines/` was touched by this delta,
and this round did not create or update one.

## Coverage gaps

- The pre-existing weakness in §1(a) (a `REVIEWED.md` line requires no actual
  round and is itself bookkeeping-exempt) is **not** newly introduced, but it
  is also **not yet tracked anywhere** as its own finding — `gate-check.sh`'s
  "commit named in REVIEWED.md -> allowed" test (line 87) and the new
  "override need not re-name an already-REVIEWED.md commit" test (line 128)
  both construct their `REVIEWED.md` entries by hand, exactly the way a
  forger would, and neither asserts that the entry corresponds to a real
  round. There is no mechanism in this repo, mechanical or otherwise, that
  makes a `REVIEWED.md` line correspond to an actual Sentinel round having
  run. This is a coverage gap for a future round to close (e.g., a required
  companion NRR file reference, checked to exist and contain a PASS verdict
  naming the same SHA) — recommend opening it explicitly rather than letting
  it stay implicit.
- This round did not re-verify Layers A–F of the full checklist; that
  remains the responsibility of the next full round, which per CLAUDE.md must
  also account for `16bb15f` (not `6b386d7`) as the reviewed SHA once this
  finding is resolved.

## Verdict rationale

The specific question this round was asked to answer — does letting an
override skip commits already in `REVIEWED.md` create a hole — is answered
plainly: yes. It is not the pre-existing weakness that `REVIEWED.md` entries
can be forged (that was already true before this fix, and is not this round's
finding to make). It is that the *override path*, which used to be a complete
and honest record of every substantive commit that ever bypassed review
requiring a human-legible entry naming it, no longer is: pairing one
bookkeeping-exempt fake line in `REVIEWED.md` with an override now lets a
real, application-changing commit go out with zero trace in the one file this
whole mechanism promises will always have a trace. I built and ran the exact
attack, twice, once against each version of the gate, and watched the
pre-delta gate correctly refuse it and the post-delta gate wave it through.
That is not a theoretical concern; it is a working bypass demonstrated with
real commands and real exit codes, in a repo where — per the project's own
accepted-risk note — several agent sessions already share one git identity and
overrides are already unattributable to a person. Removing the one remaining
guarantee (that the override log is at least complete) makes that accepted
risk meaningfully worse, not merely theoretically worse. This round's verdict
is FAIL; the fix (making the override loop's `is_reviewed` skip require
something in `REVIEWED.md` that cannot be self-certified in the same
bookkeeping breath, or removing the skip and returning to "every substantive
commit is named" as `6b386d7` had it) is for the main agent, not for this
report.
