#!/usr/bin/env bash
# Self-test for scripts/sentinel-push-gate.sh, built from a real defect.
#
# The per-commit REVIEWED.md check was DEAD CODE: three `while read` loops shared
# one stdin stream, so the third saw an empty stream, ran zero iterations, and
# the gate printed "every pushed commit is reviewed" — which was false. Any
# unreviewed commit sailed through the moment a verdict legitimately said PASS.
# It went unnoticed only because every round until then had been FAIL, caught by
# the earlier verdict check.
#
# A gate nobody tests is a gate nobody has. This runs the real script against a
# throwaway repo and asserts the directions that matter.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/scripts/sentinel-push-gate.sh"
ZERO=0000000000000000000000000000000000000000
fail=0
ok()  { echo "✔ $1"; }
bad() { echo "✖ $1"; fail=1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/scripts" "$TMP/reports/sentinel"
cp "$GATE" "$TMP/scripts/"
cd "$TMP" || exit 1
git init -q .; git config user.email t@t; git config user.name t
G=scripts/sentinel-push-gate.sh
# NOTE: the gate exits non-zero when it blocks — which is the CORRECT outcome we
# are asserting. Under `set -o pipefail`, piping it straight into grep would make
# the whole pipeline fail and mask grep's success, so capture first, match after.
# (That bug cost a debugging round when this file first reported the gate broken
# while the gate was fine.)
run() { printf 'refs/heads/main %s refs/heads/main %s\n' "$1" "$2" | bash "$G" 2>&1 || true; }
saw() { printf '%s' "$1" | grep -q "$2"; }

printf 'Verdict: **PASS**\n' > reports/sentinel/latest.md
: > reports/sentinel/REVIEWED.md
echo app > app.ts && git add -A && git commit -q -m "unreviewed app code"; A=$(git rev-parse HEAD)

# THE regression: unreviewed app code must be blocked even on a PASS verdict.
saw "$(run "$A" "$ZERO")" "BLOCKED" \
  && ok "unreviewed commit blocked on a new branch (the dead-code regression)" \
  || bad "unreviewed commit ALLOWED on a new branch — the reviewed check is dead again"

echo more >> app.ts && git add -A && git commit -q -m "more app code"; B=$(git rev-parse HEAD)
saw "$(run "$B" "$A")" "BLOCKED" \
  && ok "unreviewed commit blocked on an existing branch" \
  || bad "unreviewed commit ALLOWED on an existing branch"

# A named commit must pass, or the gate is merely a wall.
printf -- "- %s\n" "$B" > reports/sentinel/REVIEWED.md
git add -A && git commit -q -m "sentinel: review B"; C=$(git rev-parse HEAD)
saw "$(run "$C" "$A")" "every pushed commit is reviewed" \
  && ok "a registry-named commit passes (gate is not merely a wall)" \
  || bad "a properly reviewed commit was blocked"

# Verdict parsing must be exact, not a prefix glob. The push must carry CODE:
# a commit touching only reports/ is legitimately bookkeeping-exempt from the
# verdict check, so testing this with a docs-only change would assert nothing.
printf 'Verdict: **PASS (just kidding, actually FAIL)**\n' > reports/sentinel/latest.md
echo "payload" >> app.ts
git add -A && git commit -q -m "flip verdict + code"; D=$(git rev-parse HEAD)
saw "$(run "$D" "$C")" "did not pass" \
  && ok "a PASS-prefixed fake verdict is rejected" \
  || bad "prefix-glob verdict matching is back"

# The bookkeeping exemption must not become a smuggling route: a push mixing
# code into an otherwise reports-only change must still face the full gate.
printf 'Verdict: **FAIL**\n' > reports/sentinel/latest.md
echo "smuggled" >> app.ts
git add -A && git commit -q -m "reports + smuggled code"; E=$(git rev-parse HEAD)
saw "$(run "$E" "$D")" "BLOCKED" \
  && ok "code mixed into a bookkeeping push still faces the gate" \
  || bad "the bookkeeping exemption can smuggle code past the verdict"

echo
if [ "$fail" -eq 0 ]; then echo "RESULT: push-gate self-test holds."; else echo "RESULT: push-gate self-test FAILED."; fi
exit "$fail"
