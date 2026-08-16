#!/usr/bin/env bash
# Detached, SSH-cut-proof verification battery for the ui-batch round.
#
# WHY THIS EXISTS. The Sentinel agent runs inside the Claude Code session, so an
# SSH disconnect kills it — that happened twice on this round, losing the report
# each time. This script is the DETERMINISTIC half of what Sentinel does: every
# gate, every test suite, and the two source-mutation probes that prove the
# critical checks can actually fail. Launched with `setsid nohup … &`, it
# survives the connection dropping and the Claude process exiting.
#
# WHAT IT DOES NOT DO: it does not commit, push, or deploy. Pushing is gated on a
# recorded Sentinel verdict, and writing that verdict (the NRR file + naming the
# commit in REVIEWED.md) is a judgement step for the operator once this battery's
# log is read. This script only establishes, durably, whether the mechanical
# checks pass.
#
# Reads its result from the last line of the log: "VERDICT: PASS" or
# "VERDICT: FAIL (n)".  Run: setsid nohup bash scripts/sentinel-verify.sh &
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOG="${SENTINEL_LOG:-$HOME/ayni-sentinel-verify.log}"
SCRATCH="${SENTINEL_SCRATCH:-/tmp/ayni-sentinel-verify}"
mkdir -p "$SCRATCH"

fails=0
: > "$LOG"
say()  { echo "$(date -u +%H:%M:%S) $*" | tee -a "$LOG"; }
step() { # name, command...
  local name="$1"; shift
  say "── $name"
  if "$@" >>"$LOG" 2>&1; then
    say "   ok   $name"
  else
    say "   FAIL $name (exit $?)"
    fails=$((fails + 1))
  fi
}

say "=== ui-batch verification — HEAD $(git rev-parse --short HEAD) — started ==="

# --- 1. every sentinel gate ------------------------------------------------
for g in "$ROOT"/tests/sentinel/*.sh; do
  step "gate $(basename "$g")" bash "$g"
done

# --- 2. unit / proof / cross-impl suites -----------------------------------
step "cargo test (program)" cargo test --manifest-path programs/ayni/Cargo.toml
step "presence-zk proofs"        node tests/presence-zk.test.mjs
step "presence client vectors"   node tests/presence-client-vectors.test.mjs
step "badge display rules"       node tests/badge-count.test.mjs
step "pda sort cross-impl"       node tests/pda-sort-check.mjs
step "tsc --noEmit" bash -c "cd frontend && npx tsc --noEmit"

# --- 3. reflections extractor is idempotent --------------------------------
say "── extractor idempotency"
node scripts/extract-reflections-xlsx.mjs >>"$LOG" 2>&1
if git diff --quiet -- frontend/lib/daily-reflections-default.ts frontend/public/reflections.json; then
  say "   ok   extractor regenerates both outputs byte-identically"
else
  say "   FAIL extractor is not idempotent — the generated files changed"
  fails=$((fails + 1))
fi

# --- 4. mutation probes: prove the critical checks can FAIL -----------------
# Each: back up, mutate one source line, assert the guard goes red, restore,
# assert green. The single writer, serialized, so no revert race.
mutate_probe() { # name, file, sed-expr, checker-command...
  local name="$1" file="$2" expr="$3"; shift 3
  local bak="$SCRATCH/$(echo "$name" | tr ' /' '__').bak"
  cp "$file" "$bak"
  sed -i "$expr" "$file"
  if "$@" >/dev/null 2>&1; then
    say "   FAIL probe '$name' — the guard STILL PASSED with the defect injected (false pass)"
    fails=$((fails + 1))
  else
    say "   ok   probe '$name' — guard went red on the injected defect"
  fi
  cp "$bak" "$file"
  if "$@" >/dev/null 2>&1; then
    say "   ok   probe '$name' — restored, guard green again"
  else
    say "   FAIL probe '$name' — did NOT restore cleanly"
    fails=$((fails + 1))
  fi
}

say "── mutation probe: presence nullifier mask"
mutate_probe "presence-mask" "frontend/lib/presence.ts" 's/d\[0\] &= 0x1f;/d[0] \&= 0x3f;/' \
  node tests/presence-client-vectors.test.mjs

say "── mutation probe: get-app store disclosure"
mutate_probe "getapp-disclosure" "frontend/lib/i18n.generated.ts" \
  's/not yet on Google Play or the App Store/available in the usual places/' \
  bash tests/sentinel/f92-f93-check.sh

say "── mutation probe: relay allowlist wing_peer account count"
mutate_probe "wingpeer-accountcount" "frontend/lib/relayPolicy.ts" \
  's/accountCount: 11, dataLen: 8, authorityIndex: 8/accountCount: 7, dataLen: 8, authorityIndex: 4/' \
  bash tests/sentinel/presence-ui-check.sh

# --- 5. e2e against the deployed container ---------------------------------
# The container already serves this commit; the suite talks to it over HTTPS.
step "playwright e2e (deployed)" bash -c "cd frontend && npx playwright test"

# --- 6. final tree check ----------------------------------------------------
say "── working-tree cleanliness (no probe left behind)"
if git diff --quiet -- frontend/ tests/ programs/ scripts/; then
  say "   ok   no tracked source file left modified by this run"
else
  say "   FAIL a probe or step left a tracked file modified:"
  git diff --name-only -- frontend/ tests/ programs/ scripts/ | tee -a "$LOG"
  fails=$((fails + 1))
fi

say "=== finished ==="
if [ "$fails" -eq 0 ]; then
  say "VERDICT: PASS"
  exit 0
fi
say "VERDICT: FAIL ($fails)"
exit 1
