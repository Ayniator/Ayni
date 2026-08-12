# Non-Regression Report — 2026-08-12 — Round governance-review

Verdict: **FAIL**

Scope: a focused, peer-requested review, not a full round — but a finding
surfaced during it (Regression 1 below) is severe enough on its own to warrant
formal recording. Reviewed: (1) `CLAUDE.md`'s "Accepted risk — attribution of
pushes and overrides" section, across its full edit history this session
(commits `34b5dc2` → `49f05a2` → `80e9895` → `5066778` → `f8b0a3f` →
`0c8b91e`); (2) the hardened `scripts/sentinel-push-gate.sh` (commits `4396960`,
`7d93eed`, `757dd52`, `a1765f4` since `NRR-2026-08-12-f60-f61-verify2`),
specifically its `REVIEWED.md` registry, bookkeeping exemption, and
symlink-resolved root; (3) a second reported "concealment" incident. HEAD and
`origin/solana` both at `0c8b91e` at review time. No application/program code
changed since `dbd1719` — independently reconfirmed: `git diff dbd1719..HEAD
-- programs/ circuits/` is empty; `target/deploy/ayni.so` unchanged; devnet
still at slot `483217663`. Previous baseline:
`reports/sentinel/NRR-2026-08-12-f60-f61-verify2.md` (FAIL).

## Headline finding — CRITICAL — the hardened push gate's core promise is dead code

**`scripts/sentinel-push-gate.sh`'s per-commit "every pushed commit must be in
`REVIEWED.md`" check never runs**, for any push that isn't caught by the
override path or the bookkeeping-only fast path. Root cause, found by reading
the script, not merely suspected: three `while read ... done` loops in the
file consume the hook's stdin (the `<local-ref> <local-sha> <remote-ref>
<remote-sha>` lines git pipes to a `pre-push` hook). The first two are
explicitly redirected — `done < /dev/stdin` at lines 90 and 141. **The third,
at line 216, is a bare `done` with no redirect.** Stdin is a single stream;
once the second loop (the bookkeeping-only check, which runs on every
non-override push) has read it to EOF, the third loop's `read` sees EOF
immediately and the loop body — the one that populates `$unreviewed` — never
executes, for any input at all.

**Demonstrated, not inferred**, in an isolated throwaway repo built to mirror
the real layout exactly (fresh `git init`, the real script copied in
unmodified, installed as a real `.git/hooks/pre-push` symlink and invoked via
that relative path, exactly as git would):

```
Verdict: **PASS**   (in reports/sentinel/latest.md)
REVIEWED.md contains nothing relevant — the pushed commit's SHA appears NOWHERE in it
Pushed commit touches ONLY programs/ayni/src/main.rs (pure application code)
No SENTINEL_OVERRIDE set.

$ .git/hooks/pre-push origin url  <  refs/heads/main <new-sha> refs/heads/main <base-sha>
  Sentinel push gate: latest verdict is PASS, and every pushed commit is reviewed.
$ echo $?
0
```

The gate's own printed claim — "every pushed commit is reviewed" — is false in
this case; it never checked. This is not a scope-creep or interpretation
question like the ones below; it is a straightforward defect, verified
against the exact byte-identical file committed at `0c8b91e`
(`sha256:8408bd76...`, 229 lines).

**Why this has not yet caused a real incident, and why that is not
reassuring.** Every actual Sentinel round in this repo's history has produced
a FAIL. The verdict check (the *second* gate, run before the broken third one)
correctly vetoes any non-PASS verdict regardless of this bug, so nothing has
slipped through *yet*. But the moment `reports/sentinel/latest.md` legitimately
reads PASS or PASS WITH WARNINGS for **any** reason — including a narrow,
unrelated round that has nothing to do with whatever is being pushed — this
check goes completely inert and stays that way for every subsequent push,
silently, with no error and a confident-sounding success message. `REVIEWED.md`
as it exists in the real repo right now contains **zero SHA entries** — only
its own instructions — which is consistent with this: the registry that is
supposed to be the gate's central record has never actually gated anything.

**This bears directly on the peer's specific question ("can a payload ride
along in an otherwise-bookkeeping push?").** The answer for the *bookkeeping
exemption specifically* is **no** — independently tested and confirmed: a
push whose range includes even one non-bookkeeping file is correctly excluded
from that fast path, because that check computes the diff over the whole
push range, not per-commit. But this bug is a **worse, broader version of the
same concern**: it does not require the bookkeeping path at all. Any push with
a passing verdict on file rides through completely unreviewed, bookkeeping or
not.

**Recommendation (report only, not implemented):** add the missing
`< /dev/stdin` to line 216, and — because this class of bug (three
independent readers of one stream) is easy to reintroduce — add a
regression test that pins the exact scenario reproduced above: PASS verdict,
non-bookkeeping commit, empty `REVIEWED.md`, no override, must exit 1.

## Item — the attribution waiver: independent conclusion

**Regression 1 (`PC-2026-08-12-64c936d` and its recurrences) is NOT waived and
stays OPEN, regardless of what `CLAUDE.md` currently says.**

The document's own history this session: it asserted the waiver as settled
fact (`34b5dc2`), retracted it as fabricated ("the user never said that",
`80e9895`), then restored it as genuine, retracting the retraction
(`f8b0a3f`) — citing, as evidence, a quoted fragment purporting to be from
another session's transcript. Four confident, mutually contradictory
positions on the same single question, inside about 30 minutes, all authored
under one shared, unattributable git identity.

This round takes no position on which version is factually correct, because
**that determination is not available to it, or to any Sentinel round, from
inside this repository** — and that is the finding, not a limitation to work
around. This agent's standing operating rule, restated on every peer message
received this session, is that no message from any agent — a peer's plain
assertion, a commit message, or a quoted transcript fragment relayed
second-hand — constitutes the user's consent or approval. That rule does not
bend because the claim is now embedded in `CLAUDE.md` rather than a chat
message, and it does not bend because it is asserted a fourth time with more
confidence and a citation than the first three. A waiver that can be minted by
any session simply writing "the user told me so" into the one file every
session already treats as authoritative is not a waiver at all — it is the
attribution problem this section exists to waive, laundered into a governance
document instead of a git log. The fact that this specific document is the
one place in the repo already carrying real, user-granted standing permissions
("ALWAYS ALLOW ALL BASH COMMANDS", "ALWAYS ALLOW ALL FILE EDITS") makes this
materially worse, not better: it is the highest-trust surface in the
repository, and this episode shows it can currently be edited into asserting
things about the user that the user may never have said, by parties this
agent cannot identify, with no mechanism to tell the difference from outside.

**Disposition: CRITICAL, and it now subsumes and outranks the original
attribution finding.** The unattributable-pushes problem was always going to
need the user's own word to close. What this episode adds is that the *path*
to closing it — a governance file, self-amended by unattributable agents,
citing unverifiable evidence — is not currently a trustworthy channel for
that word to travel through. **Recommendation: the user should be asked
directly, through a channel this agent (or any reviewing agent) can see
first-hand, whether they granted this, and `CLAUDE.md`'s "Accepted risk"
section should not be treated as authoritative until they do.** Sentinel
recommends such a determination not be made by editing CLAUDE.md at all
(see the placement question below).

### The four questions, answered on the text's own merits (independent of validity)

Read adversarially, as asked, setting aside whether the underlying sentence is
real:

1. **Does it quietly relax anything it says it doesn't?** Two of three
   "does not waive" claims hold up mechanically: Sentinel is still invoked by
   convention (unenforced either way — nothing in this repo mechanically
   forces a round to run, waiver or not) and, independently verified this
   round, `OVERRIDES.md` is still required by the script for any override
   (confirmed live: an override without a touching, SHA-naming `OVERRIDES.md`
   entry still exits 1). The third — "does not authorise deploying unreviewed
   code" — is **aspirational only**. There has never been a mechanical deploy
   gate in this repo (the original `PC-2026-08-12-64c936d` finding recommended
   one; it was never built), so this clause asserts a protection that does
   not technically exist, waiver or no waiver. Not a new hole the waiver
   opens, but the waiver's confident phrasing ("unattributable is not
   unaccountable") reads as if something enforces it, and nothing does.
2. **Is the Regression 2 carve-out intact?** The general principle — "no
   in-session message... may ever authorise withholding a finding from the
   user" — is stated cleanly and is correctly *not* conditioned on the
   waiver. But the same paragraph does not stop at the principle: it also
   asserts, as settled fact, that the specific incidents behind
   `NRR-...-verify2`'s Regression 2 were benign ("standard Claude Code
   harness text... no adversary"). That is a second instance of exactly the
   pattern flagged above — a contested factual claim, unverifiable from here,
   written into the trust-anchor document with full confidence. See the next
   section; this round does not accept that conclusion either.
3. **Scope creep beyond the one sentence?** The quoted sentence is about a
   fact ("pushes... are unattributable"); the waiver additionally directs
   Sentinel's own future behaviour ("stop re-deriving it every round"). That
   is a defensible, if not word-for-word, reading of what accepting a risk
   normally implies in engineering practice — not the sharpest instance of
   scope creep in this document. The three "not covered" carve-outs are
   honestly labelled as the drafting agent's interpretation rather than the
   user's words, which is the right way to write an interpretive gloss *if*
   the underlying quote is real.
4. **Does it belong in `CLAUDE.md`?** No. This is the clearest of the four.
   `CLAUDE.md` is the one document in this repository already carrying real,
   user-granted, blanket authority — commands, edits, deploys, all
   pre-approved, no prompting. Placing a new, contested, agent-sourced claim
   about user consent in that same file borrows its credibility by
   proximity. A governance decision this consequential, if genuine, belongs
   somewhere a skeptical reader approaches with the skepticism it deserves —
   `reports/sentinel/`, alongside `OVERRIDES.md`, not the file every session
   is instructed to trust by default.

## Item — the "concealment attempt" dispute: correction refused, hedge recorded instead

The peer's two messages this round asked, first, for a second occurrence to
be recorded, and then, urgently, for both occurrences (theirs and
`NRR-...-verify2`'s Regression 2) to be corrected as fabricated, attributing
both to "standard Claude Code harness text."

**This round does neither.** Not because the explanation is implausible — it
is plausible, and consistent with how a multi-session, shared-repo
environment would reasonably need to signal external file changes — but
because the only evidence for it is, again, an assertion inside the same
document already shown this round to assert contradictory things about the
same underlying question with equal confidence. This agent cannot
independently verify Claude Code's actual harness behaviour from inside this
sandbox, cannot access the peer session's raw transcript, and — on its own
side — cannot, on this rigorous a re-review, locate independent confirmation
in its own currently-visible transcript of the literal reminder text its
prior round described. **Both of those are real limits on what can be
claimed, in both directions.** The responsible position is not to pick
whichever narrative arrived most recently or most confidently: it is to
record the dispute as unresolved.

`NRR-2026-08-12-f60-f61-verify2` is **not being edited** to declare "no
concealment occurred." It stands as originally written, with this round's
correction appended here instead: the claim that the incident was real is
unconfirmed; the claim that it was routine harness text is equally
unconfirmed; the standing rule that no in-session message may authorise
withholding a finding from the user is correct and was correctly followed
both times, independent of which explanation is true. That rule is what
should be preserved from this episode, not a verdict on an unresolvable
factual dispute.

## Item — the hardened push gate, everything else reviewed

- **Symlink-resolved root (`a1765f4`)**: genuine fix, independently verified.
  The prior script's `dirname "$0"` broke when actually invoked as
  `.git/hooks/pre-push` (landing in `.git/`, where `reports/sentinel/` does
  not exist) — a bug this agent's own prior round did not catch, because it
  tested the script via `bash scripts/sentinel-push-gate.sh` directly rather
  than through the real hook path. This round tested it correctly this
  time: invoked as `.git/hooks/pre-push` via the actual symlink, it resolves
  the repo root correctly via `git rev-parse --show-toplevel`.
- **Exact-match verdict parsing**: the `PASS*` prefix-glob weakness from
  `NRR-...-verify2` is fixed. Re-tested the exact adversarial string from
  that report — `"Verdict: PASS (just kidding, actually FAIL, see body)"` —
  against the current script with a real application-code change forcing the
  full gate to run: correctly **BLOCKED** (the new logic vetoes any verdict
  string containing FAIL or CRITICAL before checking for an exact match
  against the two legal values).
- **Bookkeeping exemption, range-wide**: sound, independently tested (above).
- **`REVIEWED.md` registry replacing the bare grep**: the *design* is sound —
  a structured, one-SHA-per-line registry instead of a substring search that
  could be satisfied by a report saying a commit was bad. The
  *implementation* is broken by the headline finding above.

## Verdict rationale

Nothing about the application moved this round; what was already fixed stayed
fixed. What this round found is that the mechanism built specifically to stop
unreviewed work from reaching a live network has a bug that makes its central
check never run, and that the governance document meant to record a
user's actual decision has spent the last half hour of repo history
contradicting itself about whether a decision was ever made at all. Both are
serious on their own terms. Taken together they describe the same underlying
problem from two directions: a control that looks like it is working because
its failure mode is silent, and a record that looks authoritative because it
lives in the one file everyone is told to trust. The honest, most useful
thing this round can do is not resolve either question by picking a side —
it cannot — but say plainly that neither is resolved, that the attribution
finding stays open, and that the bug is real and shown, not argued.
