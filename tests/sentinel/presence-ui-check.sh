#!/usr/bin/env bash
# Sentinel gate — F59's presence UI and its relay plumbing.
#
# The properties here are the ones that fail SILENTLY. A drifted nullifier
# derivation produces proofs that verify against nothing; a "not yet attested"
# placeholder quietly re-creates the third state docs/presence.md §5 forbids; a
# stale relay allowlist refuses transactions only on the relayed path while the
# self-paying fallback keeps working, so nothing surfaces (that exact failure
# shipped once: establish_wing_peer's entry said 7 accounts for a week after
# F98 grew it to 11).
set -uo pipefail
cd "$(dirname "$0")/../.."

LIB="frontend/lib/presence.ts"
CARD="frontend/components/PresenceCard.tsx"
MEMBER="frontend/app/member/[commitment]/page.tsx"
POLICY="frontend/lib/relayPolicy.ts"

fail=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=$((fail+1)); }

echo "F59 presence-UI checks:"

for f in "$LIB" "$CARD" "$MEMBER" "$POLICY"; do
  [ -f "$f" ] || { bad "$f is missing"; echo; echo "RESULT: $fail check(s) FAILED."; exit 1; }
done

# --- 1. the client derivation is pinned to the program's frozen vectors ------
if node tests/presence-client-vectors.test.mjs >/dev/null 2>&1; then
  ok "client external-nullifier derivation matches the program's frozen vectors (5 tests)"
else
  bad "tests/presence-client-vectors.test.mjs FAILS — the browser and the program disagree on E"
fi

# --- 2. a month, or NOTHING -------------------------------------------------
# docs/presence.md §5: an absent record and a member who never attested must be
# indistinguishable. The old placeholder rendered a permanent "not wired" card.
if grep -q "presenceNotWired" "$MEMBER"; then
  bad "the member page still renders the not-yet-attested placeholder"
else
  ok "no not-yet-attested placeholder on the member page"
fi
if grep -q "presenceMonth !== null" "$MEMBER"; then
  ok "the presence card renders only when a record exists"
else
  bad "the month-or-nothing guard is gone from the member page"
fi

# --- 3. vouching wording, never verification ---------------------------------
# The chain records that two members attested a month; nobody verified
# attendance. CODE ONLY — comments legitimately explain the distinction.
# Comments are STRIPPED first (both /* */ and {/* */} spans): the code is
# allowed — encouraged — to explain the verification/vouching distinction in a
# comment, and the first version of this check flagged exactly such a comment.
hits=$(for f in "$CARD" "$MEMBER" "$LIB"; do
  perl -0pe 's~\{?/\*.*?\*/\}?~~gs; s~//[^\n]*~~g' "$f" \
    | grep -nE '(verified attendance|attendance verified|"[Vv]erified)' \
    | sed "s|^|$f:|"
done)
if [ -n "$hits" ]; then
  bad "presence UI claims verification:"; echo "$hits" | sed 's/^/         /'
else
  ok "no verification claim in the presence UI (vouching wording only)"
fi

# --- 4. the ceremony discloses the handoff BEFORE the scan -------------------
if grep -q "handoffWarn" "$CARD"; then
  ok "the handoff screen warns that the code carries the public commitment"
else
  bad "the handoff warning is gone — docs/presence.md §4.5 requires it BEFORE the scan"
fi

# --- 5. relay preferred; the self-pay fallback budgets its own compute -------
if grep -q "relayerPubkey()" "$LIB"; then
  ok "submission prefers the relayer (the fee-payer must not date the attestation)"
else
  bad "presence.ts no longer consults the relayer"
fi
if grep -q "setComputeUnitLimit" "$LIB"; then
  ok "the self-pay fallback prepends its own compute budget"
else
  bad "the self-pay fallback would run at the 200k default and fail on two proofs"
fi

# --- 6. the relay allowlist carries the two instructions, budget on the right one
if grep -q '"e03288b8bff02607"' "$POLICY" && grep -A3 '"e03288b8bff02607"' "$POLICY" | grep -q "computeUnits"; then
  ok "attest_presence_zk is allowlisted WITH a compute-units declaration"
else
  bad "attest_presence_zk is missing from the relay allowlist or lacks computeUnits"
fi
if grep -q '"3f8285671a9e3447"' "$POLICY"; then
  if grep -E '"3f8285671a9e3447".*computeUnits' "$POLICY" >/dev/null 2>&1; then
    bad "clear_presence declares computeUnits it does not need — review what widened it"
  else
    ok "clear_presence is allowlisted, no extra budget (one proof fits the default)"
  fi
else
  bad "clear_presence is missing from the relay allowlist"
fi

# The figure the route will grant must equal the figure the fallback requests —
# two paths that differ in whether they fit is the silent-divergence shape.
# [0-9][0-9_]* requires a LEADING DIGIT: plain [0-9_]+ also matches the bare
# underscores inside the identifier ATTEST_COMPUTE_UNITS itself, which is how
# the first version of this check compared "600000" against "\n\n600000" and
# reported a divergence that did not exist.
policy_units=$(grep -A4 '"e03288b8bff02607"' "$POLICY" | grep -oE "computeUnits: [0-9][0-9_]*" | grep -oE "[0-9][0-9_]*" | tr -d _)
lib_units=$(grep -oE "ATTEST_COMPUTE_UNITS = [0-9][0-9_]*" "$LIB" | grep -oE "[0-9][0-9_]*" | tr -d _)
if [ -n "$policy_units" ] && [ "$policy_units" = "$lib_units" ]; then
  ok "relayed and self-paid paths request the same compute budget ($policy_units)"
else
  bad "compute budgets diverge: policy=$policy_units lib=$lib_units"
fi

# --- 7. the regression that already shipped once ------------------------------
if grep -A1 '"91152f076c655741"' "$POLICY" | grep -q "accountCount: 11"; then
  ok "establish_wing_peer's relay entry matches its post-F98 account count (11)"
else
  bad "establish_wing_peer's relay entry is stale AGAIN — relayed sponsorships are silently refused"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: F59 presence-UI contract holds."
  exit 0
fi
echo "RESULT: $fail presence-UI check(s) FAILED."
exit 1
