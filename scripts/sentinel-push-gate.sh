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
cd "$(dirname "$0")/.."

REPORTS="reports/sentinel"
LATEST="$REPORTS/latest.md"

say() { printf '%s\n' "$*" >&2; }

if [ -n "${SENTINEL_OVERRIDE:-}" ]; then
  say ""
  say "  Sentinel push gate OVERRIDDEN."
  say "  Reason given: ${SENTINEL_OVERRIDE}"
  say "  This is recorded only here, in your terminal. If the reason was not a"
  say "  good one, the next Sentinel round is where it surfaces."
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

# The verdict line looks like: "Verdict: **FAIL**" / "**PASS**" /
# "**PASS WITH WARNINGS**".
verdict="$(grep -m1 -iE '^[[:space:]]*Verdict:' "$LATEST" | tr -d '*' | sed -E 's/.*[Vv]erdict:[[:space:]]*//' | tr -d '\r')"
case "$(printf '%s' "$verdict" | tr '[:lower:]' '[:upper:]')" in
  PASS*) ;;
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
    if ! grep -rqE "\b($sha|$short)\b" "$REPORTS" 2>/dev/null; then
      say "  unreviewed commit: $short $(git log -1 --format=%s "$sha" | cut -c1-60)"
      unreviewed=$((unreviewed + 1))
    fi
  done
done

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
