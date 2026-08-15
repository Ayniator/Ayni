#!/usr/bin/env bash
# Sentinel gate — the vendored frontend IDL must not fall behind the program.
#
# THE DEFECT THIS EXISTS FOR, because it nearly shipped. The frontend carries its
# OWN copy of the Anchor IDL at frontend/lib/ayni.json. When the program gained
# F59's two instructions and F98's karma accounts, that copy stayed behind — 82
# instructions against the program's 85, and `establish_wing_peer` missing four
# accounts. Nothing failed: not the build, not tsc, not the e2e suite, not any
# existing gate. It would have failed in a member's browser, on the live site,
# the first time anyone pressed "set my sponsor" — AccountNotEnoughKeys — and the
# Sponsors & Sponsees UI had shipped one commit earlier.
#
# A vendored IDL is a second source of truth for the account layout, and second
# sources of truth drift silently. This gate is the thing that notices.
#
# Recorded by the idl-sync round as F98-IDL-SYNC-GAP with a fail-next-round
# clause; this is that gate.
set -uo pipefail
cd "$(dirname "$0")/../.."

FE_IDL="frontend/lib/ayni.json"
BUILT_IDL="target/idl/ayni.json"
LIB="programs/ayni/src/lib.rs"

fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }
note() { echo "  note $1"; }

echo "IDL sync checks:"

[ -f "$FE_IDL" ] || { bad "$FE_IDL is missing"; echo; echo "RESULT: 1 check FAILED."; exit 1; }
[ -f "$LIB" ]    || { bad "$LIB is missing";    echo; echo "RESULT: 1 check FAILED."; exit 1; }

# --- 1. Every handler the program exposes must exist in the vendored IDL -----
#
# Source-based, so it works with no build artifacts — which matters, because
# target/ is not committed and a CI checkout has no built IDL to compare with.
# This is the check that would have caught the actual incident.
missing=$(python3 - "$LIB" "$FE_IDL" <<'PY'
import json, re, sys
lib, idl = sys.argv[1], sys.argv[2]
src = open(lib, encoding="utf8").read()
# The #[program] module's body: every `pub fn` in it is an instruction.
m = re.search(r"#\[program\]\s*pub mod \w+\s*\{(.*)\n\}", src, re.S)
body = m.group(1) if m else src
handlers = set(re.findall(r"^\s*pub fn (\w+)\s*\(", body, re.M))
have = {i["name"] for i in json.load(open(idl, encoding="utf8"))["instructions"]}
for h in sorted(handlers - have):
    print(h)
PY
)
if [ -n "$missing" ]; then
  bad "the vendored IDL is missing instruction(s) the program exposes:"
  echo "$missing" | sed 's/^/         /'
else
  ok "every program handler appears in the vendored IDL"
fi

# --- 2. If a built IDL is present, the vendored copy must be identical -------
#
# Byte-identity is the only comparison worth making: an account added in the
# middle of a list is as breaking as a missing instruction, and no summary
# statistic catches reordering.
if [ -f "$BUILT_IDL" ]; then
  if cmp -s "$BUILT_IDL" "$FE_IDL"; then
    ok "vendored IDL is byte-identical to target/idl/ayni.json"
  else
    bad "vendored IDL DIFFERS from the freshly built target/idl/ayni.json"
    echo "         run: cp target/idl/ayni.json frontend/lib/ayni.json"
    # Name what moved, so the failure is actionable rather than just red.
    python3 - "$BUILT_IDL" "$FE_IDL" <<'PY' | sed 's/^/         /'
import json, sys
a = json.load(open(sys.argv[1], encoding="utf8"))
b = json.load(open(sys.argv[2], encoding="utf8"))
an = {i["name"]: i for i in a["instructions"]}
bn = {i["name"]: i for i in b["instructions"]}
for n in sorted(set(an) - set(bn)):
    print(f"missing instruction: {n}")
for n in sorted(set(bn) - set(an)):
    print(f"stale instruction (not in program): {n}")
for n in sorted(set(an) & set(bn)):
    aa = [x["name"] for x in an[n].get("accounts", [])]
    bb = [x["name"] for x in bn[n].get("accounts", [])]
    if aa != bb:
        print(f"account list differs for {n}:")
        print(f"  program:  {aa}")
        print(f"  frontend: {bb}")
PY
  fi
else
  # Not a silent pass: say plainly that the strongest check could not run.
  note "target/idl/ayni.json absent — byte-identity NOT checked (run 'anchor build' for the full gate)"
fi

# --- 3. The karma award PDA is derived in two places; they must agree --------
#
# `karmaAward`'s seed is a SORTED pair, which Anchor cannot auto-resolve, so the
# client derives it by hand — and `tests/karma.ts` keeps its own parallel copy.
# Two hand-written implementations of one consensus-critical ordering is exactly
# the shape that drifts. Flagged by the idl-sync round as a coverage gap; this
# asserts both still sort, and tests/pda-sort-check.mjs proves they agree.
PEERS="frontend/lib/peers.ts"
KTEST="tests/karma.ts"
# Match the COMPARISON, not the destructuring. `[lo, hi]` on its own is not
# evidence of sorting: `const [lo, hi] = [a, b]` contains it and sorts nothing.
# The first version of this check did exactly that and passed on an unsorted
# implementation — a false pass caught by mutating the client and seeing the
# gate stay green.
if [ -f "$PEERS" ] && grep -q "karmaaward" "$PEERS"; then
  if grep -qF 'cmp <= 0 ? [a, b] : [b, a]' "$PEERS"; then
    ok "peers.ts orders the pair by comparison before seeding"
  else
    bad "peers.ts no longer SORTS the award pair — it will not match the program"
  fi
fi
if [ -f "$KTEST" ] && grep -q "karmaaward" "$KTEST"; then
  if grep -qF 'Buffer.compare(a, b) <= 0 ? [a, b] : [b, a]' "$KTEST"; then
    ok "karma.ts orders the pair by comparison before seeding"
  else
    bad "karma.ts no longer SORTS the award pair — it will not match the program"
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: IDL sync contract holds."
  exit 0
fi
echo "RESULT: $fail IDL sync check(s) FAILED."
exit 1
