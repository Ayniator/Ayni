#!/usr/bin/env bash
# Sentinel e2e smoke gate — the RENDERED-UI layer.
#
# WHY THIS GATE EXISTS
# --------------------
# checklist.yaml has recorded, since round 1, that "Playwright ... none of that
# exists in this repo" and mapped the UX layer onto static checks instead. That
# gap is the reason the Circle Administration incident shipped: 244 `admin.*`
# keys resolved to nothing and rendered as the literal text `admin.config.add`
# across the whole console, in all 19 languages, while
# tests/sentinel/i18n-key-check.sh reported every key present and PASSED.
#
# A static key check proves a string exists in a dictionary. It cannot see:
#   - a blank page,
#   - a raw i18n key rendered on screen,
#   - a component that threw and rendered nothing,
#   - a page body that never left English.
# This gate renders the real pages in a real browser and asserts on what a
# member actually sees.
#
# WHAT IT RUNS AGAINST
# --------------------
# A DEPLOYED build, never `next dev` — this repo's node is 18 and Next 16 needs
# >= 20, so the dev server cannot start here at all. Default target is the live
# deployment on :8443. Override with E2E_BASE_URL.
#
# NOTE the deployed build can LAG the working tree. This gate reports the
# version it actually tested; a failure that does not reproduce in the source
# usually means the deployment needs redeploying, which is itself worth knowing.
#
# NEVER FALSE-PASSES
# ------------------
# If Playwright or a launchable browser is unavailable, this gate exits NON-ZERO
# with a loud notice rather than skipping quietly. Set E2E_OPTIONAL=1 to
# downgrade "unavailable" (and only "unavailable" — never a real test failure)
# to a warning + exit 0, for environments that genuinely cannot host a browser.
#
# Do not weaken this script to make a round pass (Sentinel spec §4) — a relaxed
# assertion needs a commit note citing the backlog line that authorises it.

set -uo pipefail
cd "$(dirname "$0")/../.."
FE="frontend"
fail=0

E2E_BASE_URL="${E2E_BASE_URL:-https://aha.a13z.org:8443}"
E2E_OPTIONAL="${E2E_OPTIONAL:-0}"
# Run the suite inside the official Playwright image instead of on the host.
# Useful where the browser's system libraries cannot be installed (no root).
E2E_DOCKER="${E2E_DOCKER:-0}"
# The image tag MUST match the installed Playwright: each release pins a browser
# revision, and the image only ships the browsers its own version expects.
# Derive it from node_modules so a dependency bump cannot silently desync them.
PW_VERSION=$(node -p "require('$PWD/$FE/node_modules/playwright/package.json').version" 2>/dev/null)
PW_IMAGE="${PW_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION:-1.60.0}-noble}"

echo "=== e2e smoke gate (rendered-UI layer) ==="
echo "target: $E2E_BASE_URL"

# ---- 0. the suite itself is present ----------------------------------------
SUITE_FILES=(
  "$FE/playwright.config.ts"
  "$FE/e2e/helpers.ts"
  "$FE/e2e/smoke.spec.ts"
  "$FE/e2e/i18n.spec.ts"
  "$FE/e2e/twelve.spec.ts"
  "$FE/e2e/dark-mode.spec.ts"
)
missing=0
for f in "${SUITE_FILES[@]}"; do
  [ -f "$f" ] || { echo "✘ missing suite file: $f"; missing=$((missing+1)); }
done
if [ "$missing" -ne 0 ]; then
  echo
  echo "RESULT: e2e smoke gate FAILED — the suite is missing ($missing file(s))."
  exit 1
fi
echo "✔ suite present (${#SUITE_FILES[@]} files under $FE/e2e)"

# ---- 0b. the route inventory has not silently shrunk ------------------------
# A regression that "fixes" a failing page by deleting it from ROUTES would
# otherwise pass. The count is the floor, not the ceiling — add routes freely.
ROUTE_COUNT=$(grep -cE '^\s*"/' "$FE/e2e/helpers.ts")
MIN_ROUTES=16
if [ "$ROUTE_COUNT" -lt "$MIN_ROUTES" ]; then
  echo "✘ $FE/e2e/helpers.ts covers only $ROUTE_COUNT routes (expected >= $MIN_ROUTES) — coverage was removed"
  fail=$((fail+1))
else
  echo "✔ route inventory covers $ROUTE_COUNT routes (floor $MIN_ROUTES)"
fi

# ---- 0c. the raw-key detector still covers every namespace ------------------
# The whole point of the suite is that a missing key renders as its own name.
# If a new namespace is added to the dictionaries but not to I18N_NAMESPACES,
# that namespace becomes invisible to the check — silently.
if [ -f "$FE/lib/i18n.ts" ] && [ -f "$FE/lib/i18n.generated.ts" ]; then
  dict_ns=$(grep -ohE '"[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9][a-zA-Z0-9.]*":' \
              "$FE/lib/i18n.ts" "$FE/lib/i18n.generated.ts" \
            | cut -d. -f1 | tr -d '"' | sort -u)
  spec_ns=$(sed -n '/I18N_NAMESPACES = \[/,/\];/p' "$FE/e2e/helpers.ts" \
            | grep -oE '"[a-z]+"' | tr -d '"' | sort -u)
  uncovered=$(comm -23 <(echo "$dict_ns") <(echo "$spec_ns"))
  if [ -n "$uncovered" ]; then
    echo "✘ i18n namespace(s) present in the dictionaries but NOT in e2e/helpers.ts I18N_NAMESPACES —"
    echo "  a missing key in these would render on screen undetected:"
    echo "$uncovered" | sed 's/^/    /'
    fail=$((fail+1))
  else
    echo "✔ raw-key detector covers every namespace in the dictionaries ($(echo "$dict_ns" | wc -l) namespaces)"
  fi
else
  echo "✘ cannot locate the i18n dictionaries to cross-check the raw-key detector"
  fail=$((fail+1))
fi

# ---- 1. is the target reachable? -------------------------------------------
if command -v curl >/dev/null 2>&1; then
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 20 "$E2E_BASE_URL/" 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "✔ target reachable ($E2E_BASE_URL -> HTTP 200)"
  else
    echo "✘ target NOT reachable: $E2E_BASE_URL -> HTTP ${code:-none}"
    echo "  The e2e suite tests a DEPLOYED build. Start the app (frontend/docker-compose.yml)"
    echo "  or point E2E_BASE_URL at a running instance."
    if [ "$E2E_OPTIONAL" = "1" ]; then
      echo "! E2E_OPTIONAL=1 — downgrading unreachable-target to a WARNING"
      echo
      echo "RESULT: e2e smoke gate SKIPPED (target unreachable, E2E_OPTIONAL=1). Coverage NOT verified this round."
      exit 0
    fi
    echo
    echo "RESULT: e2e smoke gate FAILED — e2e unavailable in this environment (target unreachable)."
    exit 1
  fi
else
  echo "! curl unavailable — skipping the reachability probe, letting Playwright report instead"
fi

# ---- 2. can we actually drive a browser? ------------------------------------
run_mode=""

probe_host_browser() {
  [ -d "$FE/node_modules/@playwright/test" ] || return 1
  ( cd "$FE" && node -e '
      const { chromium } = require("playwright");
      chromium.launch().then(b => b.close()).then(
        () => process.exit(0),
        e => { console.error(String(e).split("\n").slice(0,6).join("\n")); process.exit(1); });
    ' ) >/tmp/e2e-launch-probe.$$ 2>&1
}

if [ "$E2E_DOCKER" != "1" ] && probe_host_browser; then
  run_mode="host"
  echo "✔ Playwright + a launchable chromium are available on this host"
else
  host_probe_out=$(cat /tmp/e2e-launch-probe.$$ 2>/dev/null)
  if [ "$E2E_DOCKER" != "1" ]; then
    if [ ! -d "$FE/node_modules/@playwright/test" ]; then
      echo "! @playwright/test is not installed (run: cd $FE && npm install)"
    else
      echo "! chromium is installed but will not launch on this host:"
      echo "$host_probe_out" | sed 's/^/    /'
    fi
  fi
  # Fall back to the official image, which ships the browser and its libraries.
  if command -v docker >/dev/null 2>&1 && docker image inspect "$PW_IMAGE" >/dev/null 2>&1; then
    run_mode="docker"
    echo "✔ falling back to the official Playwright image ($PW_IMAGE)"
  elif command -v docker >/dev/null 2>&1; then
    echo "! $PW_IMAGE is not pulled locally (run: docker pull $PW_IMAGE)"
  fi
fi
rm -f /tmp/e2e-launch-probe.$$

if [ -z "$run_mode" ]; then
  echo
  echo "✘ e2e unavailable in this environment — no way to drive a browser."
  echo
  echo "  A CI runner needs ONE of:"
  echo "    (a) node >= 18, then:  cd frontend && npm install \\"
  echo "          && npx playwright install --with-deps chromium"
  echo "        '--with-deps' needs root; it installs libatk-1.0-0t64, libatk-bridge2.0-0t64,"
  echo "        libatspi2.0-0t64, libxcomposite1, libxdamage1, libxfixes3, libxrandr2,"
  echo "        libxi6, libxrender1, libxtst6, libasound2t64, libgbm1, libnss3, libnspr4,"
  echo "        libcups2t64, libxkbcommon0, libpango-1.0-0, libcairo2."
  echo "    (b) or run the suite in $PW_IMAGE (no root needed on the host):"
  echo "          docker run --rm --network host -v \$PWD/frontend:/w -w /w \\"
  echo "            -e HOME=/tmp -e E2E_BASE_URL=$E2E_BASE_URL \\"
  echo "            $PW_IMAGE npx playwright test"
  echo "        Set E2E_DOCKER=1 to make this gate take that path automatically."
  if [ "$E2E_OPTIONAL" = "1" ]; then
    echo
    echo "! E2E_OPTIONAL=1 — downgrading unavailability to a WARNING"
    echo "RESULT: e2e smoke gate SKIPPED (no browser available, E2E_OPTIONAL=1). Coverage NOT verified this round."
    exit 0
  fi
  echo
  echo "RESULT: e2e smoke gate FAILED — e2e unavailable in this environment."
  exit 1
fi

# ---- 3. record what was actually tested -------------------------------------
if command -v curl >/dev/null 2>&1; then
  deployed_ver=$(curl -sk --max-time 20 "$E2E_BASE_URL/" 2>/dev/null | grep -oE 'buildId"?:"?[A-Za-z0-9_-]+' | head -1)
  src_ver=$(grep -oE '"version": "[0-9.]+"' "$FE/package.json" | head -1 | grep -oE '[0-9.]+')
  echo "  source frontend/package.json version: ${src_ver:-unknown}"
  [ -n "$deployed_ver" ] && echo "  deployed $deployed_ver"
fi

# ---- 4. run the suite -------------------------------------------------------
echo
echo "--- running the suite ($run_mode) ---"
if [ "$run_mode" = "host" ]; then
  ( cd "$FE" && E2E_BASE_URL="$E2E_BASE_URL" npx playwright test "$@" )
  rc=$?
else
  docker run --rm --network host \
    -v "$PWD/$FE":/w -w /w \
    -e HOME=/tmp \
    -e E2E_BASE_URL="$E2E_BASE_URL" \
    -e E2E_WORKERS="${E2E_WORKERS:-2}" \
    -e E2E_RETRIES="${E2E_RETRIES:-1}" \
    --user "$(id -u):$(id -g)" \
    "$PW_IMAGE" npx playwright test "$@"
  rc=$?
fi

echo
if [ "$rc" -ne 0 ]; then
  echo "✘ the e2e suite reported failures (playwright exit $rc)"
  fail=$((fail+1))
else
  echo "✔ the e2e suite passed"
fi

if [ "$fail" -eq 0 ]; then
  echo "RESULT: e2e smoke gate holds (rendered-UI layer verified against $E2E_BASE_URL)."
  exit 0
else
  echo "RESULT: e2e smoke gate FAILED ($fail check(s))."
  exit 1
fi
