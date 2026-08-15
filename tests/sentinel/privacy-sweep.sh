#!/usr/bin/env bash
# Sentinel Layer D — the mechanical half: forbidden-pattern sweep.
#
# This is a REGRESSION GATE, not an audit. It enforces only the invariants that
# were verified clean in Round 1 (see reports/sentinel/NRR-2026-08-10-1.md), so
# any hit here is something new that a commit introduced. Exit 1 on any hit.
#
# Architectural privacy findings (public roster, public sponsor edge, message
# metadata) are NOT grep-detectable and are deliberately NOT gated here — they
# live in the report and in tests/sentinel/checklist.yaml as known exceptions.
# Do not weaken this script to make a round pass (Sentinel spec §4).

set -uo pipefail
cd "$(dirname "$0")/../.."

EX="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build --exclude-dir=target --exclude-dir=.next --exclude-dir=reports"
SRC="--include=*.ts --include=*.tsx --include=*.js --include=*.jsx --include=*.rs --include=*.circom"
fails=0

report() { # name, hits
  if [ -n "$2" ]; then
    echo "✘ FAIL — $1"
    echo "$2" | head -30
    fails=$((fails + 1))
  else
    echo "✔ pass — $1"
  fi
}

echo "=== Sentinel Layer D — forbidden-pattern sweep ==="

# 1. Analytics / telemetry SDKs and tracking pixels. Nothing may phone home.
hits=$(grep -rniE '(google-analytics|googletagmanager|gtag\(|mixpanel|segment\.(com|io)|@amplitude/|amplitude\.com|posthog|hotjar|fullstory|sentry\.io|datadog|newrelic|plausible\.io|plausible-tracker|usefathom\.com|fathom-client|matomo|facebook\.net|fbq\(|doubleclick\.net)' $SRC $EX . 2>/dev/null | grep -viE 'onDoubleClick|handleDoubleClick')
report "no analytics/telemetry SDK" "$hits"

hits=$(grep -rniE '<img[^>]+(1x1|pixel\.gif|track\.(gif|png))' --include=*.tsx --include=*.ts --include=*.html $EX . 2>/dev/null)
report "no tracking pixels" "$hits"

# 2. Identity material must never reach a log. The program is silent by design
#    (zero msg!/println!) — keep it that way; a msg! of a commitment or
#    nullifier would publish it in every validator's log forever.
hits=$(grep -rnE 'msg!|println!|eprintln!|dbg!|sol_log' --include=*.rs $EX programs/ 2>/dev/null)
report "no logging macros in the Anchor program" "$hits"

hits=$(grep -rniE 'console\.[a-z]+\([^)]*(secret|privkey|private_?key|mnemonic|trapdoor|nullifier|commitment|witness)' $SRC $EX frontend/ app/ indexer/ scripts/ 2>/dev/null)
report "no console.* of identity material" "$hits"

# 3. Traditions: nothing may rank, score, or compare a member (T11/T12).
#    `level` (shamanic lineage) and vote tallies are legitimate and excluded by
#    name.
#
#    KARMA IS WAIVED (user decision, 2026-08-15, F98). In their own words:
#
#      "I waive the Tradition 2 no-ranking rule for F98 karma, and accept that
#       it ranks members. Remove the no ranking from Tradition 2 as it is not
#       needed"
#
#    So `karma` is no longer a forbidden identifier and the F98 karma fields
#    build without an exemption. Two things this deliberately does NOT do:
#
#      * It does not touch the text of Tradition 2, which never contained a
#        no-ranking clause — "no ranking" was an ENGINEERING invariant this
#        project derived from it, and the derived rule is what the waiver
#        retires. The fellowship's own words are not ours to edit.
#      * It does not retire the rest of this check. The waiver names karma; a
#        gate that stopped catching `trustRating`, `memberScore` or a
#        leaderboard because one sibling was permitted would be a silent loss
#        of coverage that nobody asked for. Those stay forbidden until someone
#        waives them too, in writing, the same way.
# A ranking violation is a FIELD/IDENTIFIER, never prose: the whole point of a
# non-comparative design is documentation that says "no score, no rank", and a
# word-scanning gate that flagged those sentences would be useless. So match
# only identifier shapes:
#   * camelCase — `memberScore`, `trustRating` (a capitalised trigger glued to
#     a preceding identifier char),
#   * a field or assignment — `score:`, `rank =`, `karma:` (a lowercase trigger
#     immediately followed by `:` or `=`).
# `saturating_add`/`celebrating` (contain "rating") and prose "no score," never
# match. Case-sensitive on purpose.
RANK='score|rating|ranking|reputation|leaderboard|streak'
RANK_UC='Score|Rating|Ranking|Reputation|Leaderboard|Streak'
hits=$(grep -rnE "[a-zA-Z0-9_]($RANK_UC)|(^|[^a-zA-Z0-9_])($RANK)[[:space:]]*[:=]" $SRC $EX programs/ frontend/lib/ frontend/components/ frontend/app/ 2>/dev/null \
  | grep -viE 'underscore|scorecard')
report "no score/rating/rank/reputation field (karma waived, F98)" "$hits"
# Known, JUSTIFIED member-facing exceptions (Membership.level, ProgressToken
# chips) are documented in docs/traditions-justifications.md — they are personal
# milestones/credentials, not rankings; residual public-visibility is Epic 5.

echo
if [ "$fails" -gt 0 ]; then
  echo "RESULT: $fails privacy/Traditions invariant(s) BROKEN — this is CRITICAL, the round FAILS."
  exit 1
fi
echo "RESULT: all Layer D mechanical invariants hold."
