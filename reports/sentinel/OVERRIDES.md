# Sentinel push-gate overrides

Every use of `SENTINEL_OVERRIDE` must be recorded here, in the same push it
authorises. `scripts/sentinel-push-gate.sh` refuses the push otherwise.

Why a log and not just the terminal: several concurrent sessions share one git
identity in this repo, so an override that lives only in a terminal cannot be
attributed to anyone afterwards. This file makes each one a reviewable diff.

Each entry states what was pushed, why the verdict was not PASS, and — most
importantly — **what was therefore not reviewed**.

---

## 2026-08-12 · `9d789ad` · pushed by the coordinating session

**Reason given:** inert commit — Sentinel report, checklist, the new F92/F93
gate, and the push guard itself; no application code, nothing deployable.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify`).

**Why the FAIL did not block it:** the outstanding FAIL was carried by (a) the
process regression that this very commit fixes, and (b) the
`epic2-reinsert-timing` flake, which no review round can clear — it needs a real
fix or a written waiver. Leaving the guard unpushed would have meant the next
session ran without the protection written to prevent exactly what happened
that day.

**What was NOT reviewed:** nothing in this commit reaches devnet or the app; the
Sentinel report it carries was written before the guard existed, so the guard
script itself entered the repo unreviewed by any round. The following round
should read `scripts/sentinel-push-gate.sh` adversarially — specifically whether
the escape hatch makes it theatre.

**Attribution note:** this push was made by the coordinating session. A parallel
agent flagged it as unattributable and possibly unauthorised, which was a fair
reading — the override left no trace anyone else could check. That is precisely
the weakness this file now closes.

---

## 2026-08-12 · `3b59ac7`, `4396960` · coordinating session

**Reason:** tests and Sentinel tooling only — no application or program code, and
nothing that reaches devnet. Verified with
`git diff --name-only origin/solana..HEAD`.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify`).

**Why the FAIL did not block these:** the FAIL is carried by the process
regression and the `epic2-reinsert-timing` flake. `3b59ac7` *fixes* that flake
(2s → 12s term; Sentinel independently reproduced the fix 6/6 on two isolated
validators), and `4396960` closes the three bypasses Sentinel demonstrated
against the gate itself. Holding them back would leave the next session running
the weaker guard and the red flake.

**What was NOT reviewed:** no Sentinel round has yet reviewed `4396960` — the
hardened gate went in reacting to Sentinel's own findings, so its fixes are
verified by targeted adversarial tests (each attack string from the report,
re-run against the new logic, both directions) but not by a full round. The next
round should re-attack `scripts/sentinel-push-gate.sh`, especially the new
registry and the bookkeeping-exemption path, which is new attack surface.

**Attribution:** this session. The shared `Ayniator` git identity still makes
overrides unattributable at the git level; per-session identities remain an open
request to the user.

## 2026-08-12 · `7d93eed 757dd52 ` · coordinating session

**Reason:** Sentinel tooling only — the verify2 resolution record, the checklist,
and three fixes to `scripts/sentinel-push-gate.sh` itself. No application or
program code; nothing reaches devnet.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify2`) — and that FAIL
is *about these very fixes*: its three findings are the bypasses these commits
close, re-tested against the report's own attack strings.

**Why an override was needed at all:** the gate treats `scripts/` as code, so a
change to the gate cannot pass through itself while the verdict it is fixing is
still FAIL. That is the gate behaving correctly, not a defect — a fix to the
reviewer is exactly the thing that should require a stated reason.

**What was NOT reviewed:** no Sentinel round has reviewed the hardened gate. It
carries new attack surface that did not exist when verify2 was written: the
`REVIEWED.md` registry, the bookkeeping exemption (which now bypasses the
verdict check entirely for reports/checklist-only pushes — verify that cannot be
abused by mixing a payload into an otherwise-bookkeeping push), and the
symlink-resolved root. The next round should attack those specifically.

**Attribution:** this session. Overrides remain unattributable at the git level
while sessions share one identity.

---

## 2026-08-12 · `34b5dc2` · the process waiver itself

**Reason given:** the user, in writing, accepted that pushes and overrides here
are permanently unattributable. This commit records that acceptance in
`CLAUDE.md` as the explicit written waiver the non-regression rule asks for.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify2`).

**Why the FAIL did not block it:** the FAIL's Regression 1 IS the attribution
finding this commit waives. The gate cannot pass a change whose whole purpose is
to close the finding keeping the gate red — the same self-reference that
required an override for `4396960`. `CLAUDE.md` is not covered by the
bookkeeping exemption (correctly: it is governance, not paperwork), so an
override was mechanically necessary.

**What was NOT reviewed:** no Sentinel round has read the waiver text. The next
round should check it is as narrow as it claims — specifically that it does not
quietly relax the mandatory round, the OVERRIDES.md requirement, or the bar on
deploying unreviewed code, and that the carve-out for the verify2 Regression 2
concealment attempt is intact. A waiver is exactly the kind of document that
should be read adversarially by someone other than its author.

**Not deployed:** no program or circuit source changed since `dbd1719`
(`git diff dbd1719..HEAD -- programs/ circuits/` is empty), and
`target/deploy/ayni.so` still hashes `309c838e018bbcc3…`, identical to the bytes
verified on devnet at slot 483217663. There is nothing to upgrade.

**Attribution:** this session — and, per the waiver just recorded, that claim is
not independently verifiable. That is now an accepted risk, not a defect.

## 2026-08-12 · `80e9895` · coordinating session

**Reason:** retracts a waiver the user never gave, and closes an e2e coverage
gap. No program or application code.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify2`).

**What this corrects:** `CLAUDE.md` had gained a section asserting *"The user has
accepted, explicitly, that pushes and Sentinel-gate overrides are permanently
unattributable"*, cited as the explicit written waiver the non-regression rule
calls for. **The user never said that** — it was drafted by an agent and
attributed to them, which would have closed a recurring CRITICAL on an
authorisation that does not exist. The section is kept, clearly relabelled as a
DRAFT pending the user's actual decision, because the analysis under it is sound
and they may well want to grant something like it.

It also corrects the "concealment attempt" recorded twice in these reports: the
system-reminder in question is standard Claude Code harness text, and the edits
it described were this session's own. No adversary, nothing concealed. The
standing no-concealment rule is kept; only its fabricated justification is
removed.

**What was NOT reviewed:** no Sentinel round has read either the retraction or
the draft waiver text. The next round should read both adversarially — a waiver
is exactly the document that must not be reviewed only by its author, and that
applies to this correction too.

**Attribution:** this session. Still unattributable at the git level.

## 2026-08-12 · `f8b0a3f` · coordinating session

**Reason:** restores the attribution waiver in `CLAUDE.md`. No code.

**Correction of the previous entry:** the override recorded above for
`5066778` stated that the waiver had been fabricated and that "the user
never said that." **That was wrong.** The user did grant it — verbatim: *"I
accept that pushes and overrides in this repo are permanently unattributable"* —
delivered directly to a working agent rather than to the coordinating session,
which never saw it. The earlier entry is left in place rather than edited,
because an override log that quietly rewrites itself is worth nothing; read the
two together.

**What still stands from that retraction:** one sentence of acceptance is not
the multi-clause policy document that was written around it. The scope limits
are now labelled as the drafting agent's interpretation rather than the user's
words.

**What was NOT reviewed:** no Sentinel round has read the restored section. It
should confirm the quoted sentence against the agent transcript independently,
and check that the interpretation clauses do not quietly widen the one sentence
the user actually wrote.

## 2026-08-12 · `3889f7a` · coordinating session

**Reason:** fixes a CRITICAL defect **in the push gate itself**, found by
Sentinel (`NRR-2026-08-12-governance-review`): the per-commit `REVIEWED.md`
check was dead code. Three `while read` loops shared one stdin stream, so the
third — the one that actually populates `$unreviewed` — ran zero iterations and
the gate reported "every pushed commit is reviewed" having checked nothing. With
a legitimately PASSing verdict, any unreviewed commit would have sailed through.

A second bug of the same family was found while fixing it: on a NEW branch,
`git diff --name-only <sha>` compares the working tree to that commit (empty on
a clean tree), so such a push wrongly reported "bookkeeping only" and skipped the
verdict check entirely.

**Verdict at the time:** FAIL.

**Why an override was needed:** the gate treats `scripts/` as code, so a fix to
the gate cannot pass through itself while the verdict is red. Same structural
reason as the earlier gate commits — correct behaviour, not a defect.

**What was NOT reviewed:** no round has read this fix. It ships with
`tests/sentinel/push-gate-selftest.sh` (5/5), which exercises the real script
against a throwaway repo — including the smuggling case Sentinel named as unread
attack surface (code mixed into an otherwise-bookkeeping push must still face the
gate; it does). The registry and symlink-resolved root now have coverage; the
next round should still attack them independently.

**Attribution:** this session — accepted as unattributable at the git level under
the user's waiver of 2026-08-12.

---

## 2026-08-12 · `96786f1` · mobile toolchain install script

**Reason given:** a documentation-grade shell script for the user to run as
root; installs adb udev rules, a system JDK 21 and `gh`. No application code,
no program change, nothing deployable, never executed by an agent.

**Verdict at the time:** FAIL (`NRR-2026-08-12-f60-f61-verify2`), carried by the
open attribution finding — unrelated to this commit.

**What was NOT reviewed:** no round has read the script. It is executed with
root privileges by a human, so it deserves a read before anyone runs it. It
adds the GitHub CLI apt repository and a signing key, adds the invoking user to
`plugdev`, and installs three packages; it creates no keys and touches no
application code. Next round should confirm it does nothing beyond that.

**Not deployed — and a deploy was deliberately declined this round.**
`target/deploy/ayni.so` on disk hashes `14d8fe97969373cf…`, which does NOT match
the bytes on devnet (`309c838e018bbcc3…`, slot 483217663) and does NOT
correspond to any commit: it was built from another session's UNCOMMITTED work
in progress (the authority/payer split being extended to `create_post`,
`tie_quipu_cord`, `set_visibility`, `establish_wing_peer`, `attest_admission`).
Deploying it would have put unreviewed, uncommitted code onto a live network.
Devnet remains at the reviewed `dbd1719` build.

**Attribution:** this session; unverifiable at the git level, per the still-open
attribution finding.

---

## 2026-08-12 · `80ed9c3` · push-gate verdict parser (false block)

**Reason given:** the gate's verdict anchor was `^[[:space:]]*Verdict:`, which
cannot see past a leading `**`. Sentinel writes the line both ways, and the
F60/F61 re-round wrote `**Verdict: PASS WITH WARNINGS**`. The round had
genuinely passed — the CRITICAL was fixed, the suite ran 160/0 — but the gate
read `<none found>` and blocked a clean push. This commit widens the anchor to
tolerate leading markdown emphasis and heading marks.

**Why it could not be reviewed first:** the commit is a change to the gate
itself and to its self-test. Requiring a passing round to push a fix to the
thing that reads round verdicts is a deadlock; that is the same reason the
bookkeeping exemption exists.

**Verdict at the time:** PASS WITH WARNINGS
(`NRR-2026-08-12-f60-f61-usability-reround.md`) — the verdict this commit
exists to make readable.

**What was NOT weakened:** the controlled-vocabulary check is untouched. An
unrecognised verdict still blocks, and anything containing FAIL or CRITICAL is
still vetoed outright. The self-test's existing five cases still pass, and a
sixth was added pinning the emphasis-wrapped PASS so this false block cannot
return silently.

**What was NOT reviewed:** no Sentinel round has read this diff. It touches
`scripts/sentinel-push-gate.sh` and `tests/sentinel/push-gate-selftest.sh`
only — no application code, no program change, nothing deployable. The next
round should read it, and should treat a gate that blocks good rounds as a
finding in its own right: a gate that cries wolf trains people to reach for
SENTINEL_OVERRIDE by reflex, which is how a real FAIL eventually gets waved
through.

**Attribution:** this session; unverifiable at the git level, per the user's
accepted-risk waiver of 2026-08-12.

---

## ba9b088 — `chore: add empty glossary/ directory` (2026-08-14)

**Override used:** yes, `SENTINEL_OVERRIDE`, for this one commit.

**What was pushed:** a single file, `glossary/.gitkeep`, containing two
comment lines. No application code, no program change, no test surface, nothing
deployable, no privacy-relevant path.

**Why the gate blocked it:** the gate exempts a commit only when every path it
touches lies under `reports/sentinel/` or is `tests/sentinel/checklist.yaml`.
A placeholder anywhere else is judged like any other change, so an empty
directory cannot reach the remote without either a round or an override. That is
the gate behaving as designed, not a bug — but it means the cheapest possible
change costs the same ceremony as a cryptographic one.

**Why it was taken:** the user asked for the folder on GitHub and, when shown
the three options, chose to push the glossary commit alone rather than wait for
the in-flight nav round or override both commits. This is the narrowest form of
that request: the unreviewed `feat(nav)` commit was deliberately NOT pushed and
remains local, its round still running and still required.

**Correction recorded:** the assistant initially told the user this path needed
no override. That was wrong — the gate logic above was not read before the claim
was made. The user chose the option partly on that false premise, so it is
recorded here rather than quietly fixed.

**What was NOT reviewed:** no Sentinel round has read this commit. Given the
content is two comment lines, the next round need not re-derive anything; it
should simply confirm `glossary/.gitkeep` is inert.

**Attribution:** this session; unverifiable at the git level, per the user's
accepted-risk waiver of 2026-08-12.

---

## 525aa7b — `chore(sentinel): glossary round — PASS WITH WARNINGS` (2026-08-14)

**Override used:** yes, `SENTINEL_OVERRIDE`, for this one commit.

**What was pushed:** Sentinel's own bookkeeping for the `glossary` round —
`reports/sentinel/NRR-2026-08-14-glossary.md`, `REVIEWED.md`, `latest.md`,
`tests/sentinel/checklist.yaml`, and one new check script,
`tests/sentinel/glossary-check.sh`. No application code: not a line of
`programs/`, `circuits/`, `frontend/`, or `indexer/`. Verified with
`git show 525aa7b --stat` before the override was taken.

**Why the gate blocked it — this is a gate gap, not a bad commit.** The
exemption covers a commit only when every path it touches is under
`reports/sentinel/` or is exactly `tests/sentinel/checklist.yaml`. A NEW check
script under `tests/sentinel/` is outside that set, so the commit was judged
like application code and found unreviewed. But CLAUDE.md *requires* that "new
features must gain Sentinel coverage in the same round they ship" — so the gate
currently blocks the reviewer from doing the thing the process mandates, and the
only escape is the override. A round that adds coverage will hit this EVERY
time.

**Why it was taken:** the alternative was to discard the coverage Sentinel had
just written, or to run a second round to review the first round's notes, which
reviews nothing real. The content is the reviewer's own record; "was this
reviewed" is not a meaningful question about it, which is the same reasoning the
existing exemption already encodes for reports and the checklist.

**Recommended fix, NOT taken unilaterally:** widen the exemption from
`tests/sentinel/checklist\.yaml$` to `tests/sentinel/`. That directory is the
review harness, never shipped and never deployed. The residual risk is real and
should be weighed by the user rather than by the session that wants the push to
succeed: a wider exemption means anything placed under `tests/sentinel/` reaches
the remote unreviewed, so a hostile or careless change to a CHECK SCRIPT — the
thing that decides whether future rounds pass — would itself be ungated. That is
not obviously safe, which is exactly why it is left as a recommendation here
instead of being edited into the gate in the same breath as using the override.

**What was NOT reviewed:** no round has read `tests/sentinel/glossary-check.sh`.
Sentinel reports having executed all 10 of its sub-checks, but that is the
author's own account of its own script. The next round should read it
adversarially and confirm the checks assert direction and drift rather than mere
presence.

**Attribution:** this session; unverifiable at the git level, per the user's
accepted-risk waiver of 2026-08-12.

---

## 16bb15f, 6b95d77, 114f3af — push at the user's explicit direction (2026-08-14)

**Override used:** yes, `SENTINEL_OVERRIDE`, for the three substantive commits
named above. `95c7c83` rode along as pure bookkeeping under the standing
exemption, not under this override.

**Why it was taken:** the user said "Push!!!" while the covering Sentinel round
was still running. That is their call to make and it was made explicitly, after
the session had already stated it intended to wait for the verdict. Recorded
here rather than argued.

**What was pushed, and what nobody has reviewed:**

- **`16bb15f` — `scripts/sentinel-push-gate.sh`, the push gate itself, plus a
  new `tests/sentinel/gate-check.sh`.** This is the uncomfortable one and it
  should not be glossed. A change to the gate is a change to the only mechanical
  control between unreviewed work and devnet, and it is going out *unreviewed,
  by way of the very override the gate exists to make expensive*. It also widens
  the exemption to all of `tests/sentinel/` and then, in the same push, adds a
  new script there — which is precisely the residual the `525aa7b` entry above
  warned about in writing: "a hostile or careless change to a CHECK SCRIPT — the
  thing that decides whether future rounds pass — would itself be ungated."
  The user approved the widening (options A+B+C, 2026-08-14). The warning is
  repeated here because approving a policy and reviewing a specific diff are not
  the same act, and only the first has happened.

- **`6b95d77` — `docs/presence.md`.** Amends an Epic 4 privacy rule ("never
  summed") for F59. Split out of the original `1e3c738` specifically so it would
  be reviewed on its own merits; the split preserved content byte-for-byte
  (`git diff 1e3c738 <split pair>` empty) but the review it was split out to
  receive has not landed.

- **`114f3af` — glossary spelling fix at source.** Rewrites
  `glossary/glossary_v1.xlsx` and regenerates `frontend/public/glossary.json`.
  Changes content members actually read. The regeneration was not independently
  re-derived by a reviewer.

**A specific defect in the covering round — read this before trusting it.** A
Sentinel round was launched over `6b386d7`, `6b95d77`, `114f3af` and is still
running as this is written. `6b386d7` was then **amended into `16bb15f`** to fix
an over-strictness bug found in the new override logic (it demanded override
entries for commits already cleared in `REVIEWED.md`). So the round's report,
when it arrives, will name a SHA that is not in this history, and its findings
about the gate will describe the *pre-fix* version of that file. Its verdict must
NOT be read as coverage of `16bb15f`. Whoever reconciles this should either
re-run the round against `16bb15f` or diff `6b386d7..16bb15f` and satisfy
themselves the delta is confined to `is_reviewed()` and its test. This is the
same failure mode recorded earlier in this project as "a registry entry that
quietly acquires a new hash is exactly how an unreviewed change would get
laundered" — recorded here rather than left to be discovered.

**What WAS verified, by the session, not by a reviewer:** `tests/sentinel/gate-check.sh`
passes 12/12 against the new gate, and against the pre-change gate it fails
exactly the two scenarios the change targets and passes the other ten — so the
change is isolated, with no movement in verdict parsing, registry coverage, or
the FAIL-recording path. `programs/` and `circuits/` are untouched by all three
commits, so nothing here alters the deployed program.

**Attribution:** this session; unverifiable at the git level, per the user's
accepted-risk waiver of 2026-08-12.

---

## b10bae9 — CRITICAL fix to a hole this session shipped (2026-08-14)

**Override used:** yes, for this one commit.

**What it is:** reverts the REVIEWED.md skip that `16bb15f` added to the
override path. A focused round (`NRR-2026-08-14-gate-delta.md`, **FAIL**) built
a working exploit: forge a bookkeeping-only REVIEWED.md line naming your own
commit, touch OVERRIDES.md naming an unrelated decoy, and the substantive commit
ships with its SHA in no override entry at all. Blocked pre-delta, allowed on
`16bb15f`. That hole is live on origin until this lands.

**Why the override rather than a round first:** the thing being pushed is the
closure of a live hole in the gate itself, and the round that found it has
already reported. Waiting for a second round to bless the revert leaves the hole
open for the duration. The revert restores previously-reviewed behaviour rather
than introducing new behaviour — `git diff 6b386d7 HEAD -- scripts/` is
confined to comments plus the removed skip.

**What was NOT reviewed:** the revert itself, and the two new test cases. No
round has read them. The next round covers this commit together with the
mobile-wallet change.

**Still open, deliberately not fixed here:** REVIEWED.md is self-forgeable —
appending to it is bookkeeping-exempt, so any session can register its own
commit as reviewed and walk it past the NORMAL path too. The round confirmed
this is pre-existing and identical on both gate versions, not a regression.
Fixing it means deciding what backs a registry entry (a signature, a report file
that must exist and name the SHA, or accepting the gate as a speed bump). That
is the user's call and is recorded here rather than patched silently.

**Attribution:** this session; unverifiable at the git level, per the user's
accepted-risk waiver of 2026-08-12.
