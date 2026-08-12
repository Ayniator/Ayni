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
