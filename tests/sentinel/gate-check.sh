#!/usr/bin/env bash
# Regression suite for scripts/sentinel-push-gate.sh — the pre-push gate.
#
# The gate is the only mechanical thing standing between unreviewed work and a
# live network, and every bug found in it so far has been a SILENT one: a check
# that still printed its reassuring success line while doing nothing (three
# `while read` loops racing for one stdin), a path pattern that no longer
# matched what Sentinel actually writes, an override that logged one commit and
# carried eight. Reading the script does not catch that class. Executing it
# against known-answer inputs does.
#
# Builds a throwaway repo in a tmpdir, replays the scenarios that matter, and
# asserts exit codes. Touches nothing in this repo and pushes nothing.
#
#   tests/sentinel/gate-check.sh                     # test the live gate
#   tests/sentinel/gate-check.sh /path/to/other.sh   # or any other copy
#
# When changing the gate, run this FIRST against the unmodified script: a test
# that does not fail before the fix is not evidence the fix did anything.
set -uo pipefail

GATE="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/sentinel-push-gate.sh}"
[ -x "$GATE" ] || { echo "not executable: $GATE" >&2; exit 2; }
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1
git init -q -b main .
git config user.email t@t; git config user.name t

mk() { mkdir -p "$(dirname "$1")"; echo "$2" >> "$1"; git add "$1"; }

pass=0; fail=0
check() { # $1 desc  $2 expected  $3 actual
  if [ "$2" = "$3" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1))
  else printf '  FAIL  %s (expected exit %s, got %s)\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
run() { # stdin refline; env passed by caller
  printf '%s\n' "$1" | "$GATE" origin x >/dev/null 2>&1; echo $?
}

# --- base: a PASS report, a registry, an empty override log -----------------
mk reports/sentinel/NRR-1.md "Verdict: **PASS**"
mk reports/sentinel/latest.md "Verdict: **PASS**"
mk reports/sentinel/REVIEWED.md "# registry"
mk reports/sentinel/OVERRIDES.md "# overrides"
git commit -qm base
BASE=$(git rev-parse HEAD)

echo "== B: exemption scope =="

# a new check SCRIPT under tests/sentinel/ (the 525aa7b class)
mk tests/sentinel/glossary-check.sh "echo hi"
mk reports/sentinel/NRR-2.md "Verdict: **PASS**"
git commit -qm "chore(sentinel): round adding a check script"
S1=$(git rev-parse HEAD)
check "new tests/sentinel/*.sh script is bookkeeping -> allowed" 0 "$(run "r $S1 r $BASE")"

# checklist.yaml still exempt (no regression)
mk tests/sentinel/checklist.yaml "a: 1"
git commit -qm "chore(sentinel): checklist"
S2=$(git rev-parse HEAD)
check "tests/sentinel/checklist.yaml still exempt" 0 "$(run "r $S2 r $S1")"

# docs/ must NOT be exempt
mk docs/presence.md "amends an Epic 4 rule"
git commit -qm "chore(sentinel): round + a design doc"
S3=$(git rev-parse HEAD)
check "docs/ is NOT exempt -> blocked" 1 "$(run "r $S3 r $S2")"

# real code must NOT be exempt
mk programs/ayni/src/lib.rs "fn main(){}"
git commit -qm "chore(sentinel): totally innocent bookkeeping"
S4=$(git rev-parse HEAD)
check "programs/ NOT exempt even with chore(sentinel) subject" 1 "$(run "r $S4 r $S3")"

# a tests/ file OUTSIDE tests/sentinel/ must not be exempt
mk tests/epic2.ts "it('x')"
git commit -qm "test: outside sentinel"
S5=$(git rev-parse HEAD)
check "tests/ outside tests/sentinel/ NOT exempt" 1 "$(run "r $S5 r $S4")"

# registry coverage still works
SHORT=$(git rev-parse --short $S5)
mk reports/sentinel/REVIEWED.md "- $SHORT reviewed"
git commit -qm "chore(sentinel): register"
S6=$(git rev-parse HEAD)
check "commit named in REVIEWED.md -> allowed" 0 "$(run "r $S6 r $S4")"

echo "== C: override must name every substantive commit =="

mk programs/ayni/src/a.rs "1"; git commit -qm "feat: A"; A=$(git rev-parse HEAD)
mk programs/ayni/src/b.rs "2"; git commit -qm "feat: B"; B=$(git rev-parse HEAD)
AS=$(git rev-parse --short $A); BS=$(git rev-parse --short $B)

# entry naming only ONE of the two substantive commits
mk reports/sentinel/OVERRIDES.md "override for $AS: reason"
git commit -qm "chore(sentinel): record override"
O1=$(git rev-parse HEAD)
check "override naming 1 of 2 substantive commits -> BLOCKED" 1 \
  "$(SENTINEL_OVERRIDE=why run "r $O1 r $S6")"

# now name both
mk reports/sentinel/OVERRIDES.md "also $BS: reason"
git commit -qm "chore(sentinel): record override 2"
O2=$(git rev-parse HEAD)
check "override naming both -> allowed" 0 \
  "$(SENTINEL_OVERRIDE=why run "r $O2 r $S6")"

# override with NO log entry at all
mk programs/ayni/src/c.rs "3"; git commit -qm "feat: C"; C=$(git rev-parse HEAD)
check "override with no OVERRIDES.md touch -> BLOCKED" 1 \
  "$(SENTINEL_OVERRIDE=why run "r $C r $O2")"

# An override is a record of what was NOT reviewed. A commit a round already
# cleared must NOT need an entry, or every override re-lists reviewed work and
# the log fills with padding. Here R is registered in REVIEWED.md and named
# nowhere in OVERRIDES.md; only U is unreviewed and named.
mk programs/ayni/src/r.rs "reviewed"; git commit -qm "feat: R"; R=$(git rev-parse HEAD)
RS=$(git rev-parse --short $R)
mk reports/sentinel/REVIEWED.md "- $RS covered by a round"
git commit -qm "chore(sentinel): register R"
REG=$(git rev-parse HEAD)
mk programs/ayni/src/u.rs "unreviewed"; git commit -qm "feat: U"; U=$(git rev-parse HEAD)
US=$(git rev-parse --short $U)
mk reports/sentinel/OVERRIDES.md "override for $US: reason"
git commit -qm "chore(sentinel): record override for U"
O3=$(git rev-parse HEAD)
check "override need not re-name an already-REVIEWED.md commit" 0 \
  "$(SENTINEL_OVERRIDE=why run "r $O3 r $C")"

echo "== regressions =="

# FAIL verdict still vetoes
mk reports/sentinel/latest.md "Verdict: **FAIL**"
git commit -qm "chore(sentinel): fail verdict"
F=$(git rev-parse HEAD)
mk programs/ayni/src/d.rs "4"; git commit -qm "feat: D"; D=$(git rev-parse HEAD)
# Baseline is $O3, the tip before this section. Using an older baseline sweeps
# the intervening code commits into the range and the "bookkeeping-only" case
# stops being bookkeeping — which is how this fixture broke once already.
check "FAIL verdict blocks substantive push" 1 "$(run "r $D r $O3")"

# bookkeeping-only push allowed even under FAIL (so the FAIL can be recorded)
check "bookkeeping-only push allowed under FAIL verdict" 0 "$(run "r $F r $O3")"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
