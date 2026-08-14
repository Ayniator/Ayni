#!/usr/bin/env bash
# The mechanical guard Sentinel has now recommended twice, after the same
# failure occurred twice in one day (PC-2026-08-12-64c936d, and its recurrence
# recorded in reports/sentinel/NRR-2026-08-12-f60-f61-verify.md, Regression 3).
#
# THE FAILURE IT STOPS. CLAUDE.md requires a Sentinel round before a round's
# commit is considered done, and says a CRITICAL finding means the round FAILS
# and must be addressed before moving on. Nothing enforced that. Twice, work was
# committed, pushed to origin, and upgraded onto a live network before any
# verdict existed — including once *during* the round convened to review the
# first occurrence. The fixes were good both times; that is not the point. An
# unreviewed path to a live network is the class of thing the non-regression
# gate exists to stand in front of.
#
# WHAT IT DOES. On `git push`, it refuses when the latest Sentinel report is not
# a PASS, or when the commits being pushed are not named by any report. It is a
# speed bump, not a lock: an explicit, deliberate override exists, because a
# guard with no escape hatch gets deleted the first time it is inconvenient, and
# then protects nothing.
#
#   SENTINEL_OVERRIDE="reason" git push ...
#
# The reason is required and is echoed, so overriding is a visible act rather
# than a reflex.
#
# INSTALL (per clone; git hooks are not versioned):
#   ln -sf ../../scripts/sentinel-push-gate.sh .git/hooks/pre-push
#
# Called by git as: pre-push <remote-name> <remote-url>, with
# "<local ref> <local sha> <remote ref> <remote sha>" lines on stdin.

set -uo pipefail

# Resolve through the symlink before locating the repo root. git invokes this as
# .git/hooks/pre-push, so a bare `dirname "$0"` lands in .git/hooks and `cd ..`
# lands in .git/ — where reports/sentinel/ does not exist. That silently broke
# every file-based check when run as a hook (and only as a hook), which is
# exactly the path that matters. Prefer git's own answer for the top level.
self="$0"
if command -v readlink >/dev/null 2>&1; then
  self="$(readlink -f "$0" 2>/dev/null || echo "$0")"
fi
root="$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$self")")"
cd "$root" || exit 1

REPORTS="reports/sentinel"
LATEST="$REPORTS/latest.md"
REVIEWED="$REPORTS/REVIEWED.md"

# Sentinel's own bookkeeping: the files a round writes ABOUT the code, never the
# code itself. A commit confined to these carries no application change, so "was
# this reviewed" is not a meaningful question about it — and a report can never
# contain its own commit's SHA, so without an exemption the registry commit would
# deadlock the gate forever.
#
# ONE definition. This pattern was previously spelled out twice — in the
# whole-push check and again in the per-commit check — and the two copies were
# free to drift apart. They are now the same string by construction.
#
# tests/sentinel/ is a PREFIX as of 2026-08-14, widened from the single exact
# file tests/sentinel/checklist.yaml. A round that adds a new check script was
# blocked from committing it: tests/sentinel/glossary-check.sh in 525aa7b did
# exactly that, so the gate stopped the reviewer from doing the thing CLAUDE.md
# mandates, and cost an override. Scripts under tests/sentinel/ are executable,
# but they run only during a round — nothing there ships to programs/, circuits/,
# frontend/ or indexer/.
#
# Deliberately NOT included: docs/. A design-of-record document can amend a
# privacy invariant — docs/presence.md amends an Epic 4 rule — and that is
# precisely the reviewer's business. Do not add it here.
#
# Also deliberately not a commit-SUBJECT match. "^chore(sentinel):" is trivially
# spoofable, and worse: applied to 1e3c738 it would have exempted that commit
# whole, laundering the Epic 4 amendment in docs/presence.md through as
# bookkeeping. The exemption is decided by paths touched, never by wording.
BOOKKEEPING='^(reports/sentinel/|tests/sentinel/)'

say() { printf '%s\n' "$*" >&2; }

# git streams the ref list on stdin ONCE. Three separate `while read` loops used
# to consume it, so whichever ran last saw an empty stream and silently did
# nothing — that is exactly how the per-commit REVIEWED.md check became dead
# code while still printing "every pushed commit is reviewed". Read it once here
# and let every check iterate over the same captured text.
REFLINES="$(cat)"

# Files changed by a push. For an existing branch that is remote..local; for a
# NEW branch there is no remote side, so `git diff <sha>` would compare the
# WORKING TREE to that commit and return nothing on a clean tree — which wrongly
# reported "bookkeeping only". Use the commit's own contents in that case.
changed_files() {  # $1 = local sha, $2 = remote sha
  if printf '%s' "${2:-}" | grep -qE '^0*$'; then
    git log --pretty=format: --name-only "$1" 2>/dev/null | grep -vE '^[[:space:]]*$' | sort -u
  else
    git diff --name-only "$2..$1" 2>/dev/null
  fi
}

# Commits introduced by a push, same new-branch caveat.
pushed_commits() {  # $1 = local sha, $2 = remote sha
  if printf '%s' "${2:-}" | grep -qE '^0*$'; then
    git rev-list "$1" 2>/dev/null
  else
    git rev-list "$2..$1" 2>/dev/null
  fi
}

# True when a single commit touches NOTHING outside Sentinel's bookkeeping.
# Used by both the coverage check and the override check, so the two can never
# disagree about what "bookkeeping" means. A commit touching no files at all is
# vacuously bookkeeping — it carries no code either way.
is_bookkeeping_commit() {  # $1 = sha
  ! git show --pretty=format: --name-only "$1" 2>/dev/null \
      | grep -vE '^[[:space:]]*$' \
      | grep -qvE "$BOOKKEEPING"
}

# True when a commit is genuinely covered by a round: a structured registry line
# in REVIEWED.md, "<sha>" or "- <sha> note". Prose in a report does not count —
# a bare grep across the reports once counted a commit as reviewed when a report
# named it only to say it was BAD.
is_reviewed() {  # $1 = sha
  local short
  short="$(git rev-parse --short "$1" 2>/dev/null || echo "$1")"
  grep -qE "^[[:space:]]*[-*]?[[:space:]]*($1|$short)\b" "$REVIEWED" 2>/dev/null
}

OVERRIDES="$REPORTS/OVERRIDES.md"

if [ -n "${SENTINEL_OVERRIDE:-}" ]; then
  # An override recorded only in a terminal is worthless: several sessions share
  # one git identity here, so "who overrode this, and why" is unanswerable after
  # the fact. (That weakness was raised against the first version of this gate,
  # and it was right.) An override must therefore leave a trace IN THE REPO:
  # at least one commit being pushed has to touch reports/sentinel/OVERRIDES.md.
  # That makes every override attributable to a commit, reviewable in the diff,
  # and impossible to use silently.
  # EVERY substantive commit must be named, not merely one of them.
  #
  # This check used to stop at the first match ("named=1; break") and then let
  # the WHOLE push through. So an entry naming a one-line typo fix carried an
  # arbitrary number of unreviewed programs/ commits with it, unnamed, in the
  # same push — the override log would then describe a fraction of what actually
  # shipped. With several sessions on one git identity that is unreconstructable
  # afterwards, which is the precise thing this gate exists to prevent.
  #
  # Bookkeeping commits are skipped rather than required: the commit that appends
  # the entry cannot contain its own future SHA, so demanding that every commit
  # be named — without this skip — would deadlock the override path exactly the
  # way the missing coverage exemption would have deadlocked the coverage path.
  override_logged=0
  override_unnamed=""
  while read -r _local_ref local_sha _remote_ref remote_sha; do
    [ -z "${local_sha:-}" ] && continue
    case "$local_sha" in *[!0]*) : ;; *) continue ;; esac   # skip deletions
    # changed_files() rather than a bare `git diff "$rng"`: for a NEW branch the
    # range is a single sha, and `git diff <sha>` compares the WORKING TREE to
    # it — on a clean tree that is empty, so a new-branch override silently
    # failed to find its own log entry.
    if changed_files "$local_sha" "${remote_sha:-}" \
         | grep -q '^reports/sentinel/OVERRIDES\.md$'; then
      override_logged=1
    fi
    for c in $(pushed_commits "$local_sha" "${remote_sha:-}"); do
      is_bookkeeping_commit "$c" && continue
      # Already covered by a round: an override is a record of what was NOT
      # reviewed, so demanding an entry for reviewed work would force every
      # override to re-list commits a round already cleared. That noise is not
      # free — a log padded with entries that mean nothing is a log people stop
      # reading, and it dilutes the entries that do mean something.
      is_reviewed "$c" && continue
      c_short="$(git rev-parse --short "$c" 2>/dev/null || echo "$c")"
      grep -qE "\b($c|$c_short)\b" "$OVERRIDES" 2>/dev/null \
        || override_unnamed="$override_unnamed $c_short"
    done
  done <<< "$REFLINES"

  if [ "$override_logged" -ne 1 ] || [ -n "$override_unnamed" ]; then
    say ""
    if [ "$override_logged" -ne 1 ]; then
      say "  BLOCKED: SENTINEL_OVERRIDE was set, but no commit in this push records it."
    else
      say "  BLOCKED: SENTINEL_OVERRIDE was set, but $OVERRIDES does not name:"
      for c_short in $override_unnamed; do
        say "    $c_short $(git log -1 --format=%s "$c_short" 2>/dev/null | cut -c1-60)"
      done
      say ""
      say "  An override must account for EVERY commit it carries, not just one."
    fi
    say ""
    say "  An override must be auditable. Append an entry to:"
    say "    $OVERRIDES"
    say "  naming the commit(s), the reason, and what was NOT reviewed — then"
    say "  commit that file and push again."
    say ""
    say "  Rationale: several sessions share one git identity in this repo, so an"
    say "  override that lives only in a terminal cannot be attributed to anyone."
    say ""
    exit 1
  fi

  say ""
  say "  Sentinel push gate OVERRIDDEN — and recorded in $OVERRIDES."
  say "  Reason given: ${SENTINEL_OVERRIDE}"
  say "  The next Sentinel round reviews that entry."
  say ""
  exit 0
fi

if [ ! -f "$LATEST" ]; then
  say ""
  say "  BLOCKED: no Sentinel report found at $LATEST."
  say "  Run the sentinel agent for this round, then push."
  say "  Override: SENTINEL_OVERRIDE=\"why\" git push ..."
  say ""
  exit 1
fi

# A push carrying NOTHING but Sentinel's own bookkeeping is always allowed, and
# deliberately so: otherwise a FAIL verdict blocks the very push that records
# the FAIL, and the audit trail can never be committed. Such a push changes no
# application code, so there is nothing for a verdict to be about. Anything with
# a single non-bookkeeping file still faces the full gate below.
bookkeeping_only=1
saw_any=0
while read -r _lr lsha _rr rsha; do
  [ -z "${lsha:-}" ] && continue
  case "$lsha" in *[!0]*) : ;; *) continue ;; esac
  saw_any=1
  if changed_files "$lsha" "${rsha:-}" | grep -qvE "$BOOKKEEPING"; then
    bookkeeping_only=0
  fi
done <<< "$REFLINES"
if [ "$saw_any" -eq 1 ] && [ "$bookkeeping_only" -eq 1 ]; then
  say ""
  say "  Sentinel push gate: bookkeeping-only push (reports/checklist), allowed."
  say "  No application code changes, so no verdict applies."
  say ""
  exit 0
fi

# The verdict line looks like: "Verdict: **FAIL**" / "**PASS**" /
# "**PASS WITH WARNINGS**" — and also "**Verdict: PASS WITH WARNINGS**", where
# the emphasis wraps the whole line including the label. That last form is what
# Sentinel actually wrote on 2026-08-12, and the old anchor (`^[[:space:]]*
# Verdict:`) could not see past the leading `**`: the round had genuinely
# PASSED, the gate read "<none found>", and it blocked. Failing closed was the
# right instinct on an unreadable verdict, but the verdict was not unreadable —
# the pattern was too narrow. Allow leading markdown emphasis and heading marks
# before the label; the controlled-vocabulary check below is what keeps this
# honest, and it still rejects anything it cannot match exactly.
verdict="$(grep -m1 -iE '^[[:space:]]*[*_#[:space:]]*Verdict:' "$LATEST" | tr -d '*_' | sed -E 's/.*[Vv]erdict:[[:space:]]*//' | tr -d '\r')"
# Exact match only. A prefix glob (PASS*) let "PASS (just kidding, actually
# FAIL)" through — a verdict is a controlled vocabulary, not a free-text field
# to be matched loosely. Anything mentioning FAIL is vetoed outright, so a
# report cannot pass by leading with the right word.
verdict_uc="$(printf '%s' "$verdict" | tr '[:lower:]' '[:upper:]' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
case "$verdict_uc" in
  *FAIL*|*CRITICAL*)
    verdict_uc="__VETOED__" ;;
esac
case "$verdict_uc" in
  "PASS"|"PASS WITH WARNINGS") ;;
  *)
    say ""
    say "  BLOCKED: the latest Sentinel round did not pass."
    say "    report:  $(readlink -f "$LATEST" 2>/dev/null || echo "$LATEST")"
    say "    verdict: ${verdict:-<none found>}"
    say ""
    say "  CLAUDE.md: a CRITICAL finding means the round FAILS — address it, or"
    say "  get an explicit written waiver, before moving on. Pushing now carries"
    say "  the finding onward and, if a deploy follows, onto a live network."
    say ""
    say "  Override (deliberately, with a reason):"
    say "    SENTINEL_OVERRIDE=\"why this is safe to push now\" git push ..."
    say ""
    exit 1
    ;;
esac

# A PASS is not enough on its own: it must be a PASS about THIS work. Every
# commit being pushed should be named by some report in $REPORTS.
unreviewed=0
while read -r _localref localsha _remoteref remotesha; do
  [ -z "${localsha:-}" ] && continue
  case "$localsha" in *[!0]*) ;; *) continue ;; esac   # branch deletion
  if printf '%s' "${remotesha:-}" | grep -qE '^0+$'; then
    range="$localsha"                                  # new branch: just the tip
  else
    range="$remotesha..$localsha"
  fi
  for sha in $(git rev-list "$range" 2>/dev/null); do
    short="$(git rev-parse --short "$sha")"
    # A commit cannot name its own SHA, so the registry commit would otherwise
    # deadlock the gate forever. Exempt commits that touch NOTHING but Sentinel's
    # own bookkeeping — reports, the registry, the override log, the checklist.
    # These carry no application change, so "was this reviewed" is not a
    # meaningful question about them; anything outside that set is still judged.
    if is_bookkeeping_commit "$sha"; then
      continue
    fi
    # A bare grep across $REPORTS counted a commit as "reviewed" even when a
    # report named it only to say it was BAD. Require instead a structured
    # registry line: reports/sentinel/REVIEWED.md, one SHA per line (optionally
    # "- <sha> note"). Sentinel appends to it when a round genuinely covers a
    # commit, so mentioning a SHA in prose no longer launders it.
    if ! is_reviewed "$sha"; then
      say "  unreviewed commit: $short $(git log -1 --format=%s "$sha" | cut -c1-60)"
      unreviewed=$((unreviewed + 1))
    fi
  done
done <<< "$REFLINES"

if [ "$unreviewed" -gt 0 ]; then
  say ""
  say "  BLOCKED: $unreviewed commit(s) above are named by no Sentinel report."
  say "  The latest verdict is a PASS, but not about this work."
  say ""
  say "  Override: SENTINEL_OVERRIDE=\"why\" git push ..."
  say ""
  exit 1
fi

say "  Sentinel push gate: latest verdict is ${verdict}, and every pushed commit is reviewed."
exit 0
