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
