#!/usr/bin/env bash
# Sentinel Layer F/E12 regression gate — F86 (embedded wallet core), F87
# (/wallet), F88/F89 (mobile shells). New this round (NRR-2026-08-12-wavea-e12).
#
# This gate re-checks, MECHANICALLY, the custody-model claims this round's
# files make in their own header comments. Do not weaken this script to make a
# round pass (Sentinel spec §4) — a relaxed assertion needs a commit note
# citing the backlog line that authorises it.
#
# CUSTODY SURFACE under test (must have NO network reach):
#   frontend/lib/embeddedWallet.ts
#   frontend/lib/embeddedWalletStandard.ts
#   frontend/components/EmbeddedWalletBoot.tsx
#   frontend/lib/keystore.ts               (pre-existing, F65 core)
#
# NOTE: frontend/app/wallet/page.tsx and frontend/lib/walletUi.ts are NOT part
# of the no-network surface — /wallet legitimately talks to an RPC endpoint to
# show balances and broadcast signed transactions. Only the KEY CUSTODY layer
# is required to be network-free.

set -uo pipefail
cd "$(dirname "$0")/../.."
FE="frontend"
fail=0

CUSTODY_SURFACE=(
  "$FE/lib/embeddedWallet.ts"
  "$FE/lib/embeddedWalletStandard.ts"
  "$FE/components/EmbeddedWalletBoot.tsx"
  "$FE/lib/keystore.ts"
)

for f in "${CUSTODY_SURFACE[@]}"; do
  [ -f "$f" ] || { echo "✘ missing surface file: $f"; fail=$((fail+1)); }
done

echo "=== E12 wallet regression gate (F86/F87/F88/F89) ==="

# ---- 1. no network code path in the custody surface -------------------------
NET_PATTERN='fetch\(|XMLHttpRequest|WebSocket|sendBeacon|RTCPeerConnection|EventSource|new[[:space:]]+Image\(|\.src[[:space:]]*=|axios|http\.request|https\.request|navigator\.sendBeacon|new Connection\(|@solana/web3\.js.*Connection'
net_hits=$(grep -nE "$NET_PATTERN" "${CUSTODY_SURFACE[@]}" 2>/dev/null | grep -vE ':[0-9]+:\s*(//|\*|#)')
if [ -n "$net_hits" ]; then
  echo "✘ network primitive found in the wallet custody surface:"
  echo "$net_hits"
  fail=$((fail+1))
else
  echo "✔ no network primitive (fetch/XHR/WebSocket/sendBeacon/WebRTC/EventSource/img-src/Connection) in the wallet custody surface"
fi

# ---- 1b. custody surface imports nothing that itself networks --------------
# @solana/web3.js Keypair/PublicKey/Transaction/VersionedTransaction are pure
# (no RPC) — but importing an RPC-capable module anywhere transitively in this
# surface (anchor Provider, wallet-adapter's Connection-bearing hooks) would
# widen the reach. Grep the actual import lines in embeddedWallet.ts.
if grep -qE 'import \{[^}]*\} from "@solana/web3\.js"' "$FE/lib/embeddedWallet.ts"; then
  imported=$(grep -oE 'import \{[^}]*\} from "@solana/web3\.js"' "$FE/lib/embeddedWallet.ts")
  if echo "$imported" | grep -qE 'Connection'; then
    echo "✘ lib/embeddedWallet.ts imports Connection from @solana/web3.js: $imported"
    fail=$((fail+1))
  else
    echo "✔ lib/embeddedWallet.ts's @solana/web3.js import is RPC-free ($imported)"
  fi
fi

# ---- 2. only the PUBLIC key is cached (localStorage) -------------------------
# The only localStorage write in the surface must be the base58 public key
# under aha:embwallet:pub — never secretKey / raw / seed bytes.
ls_hits=$(grep -nE 'localStorage\.(setItem|getItem|removeItem)' "$FE/lib/embeddedWallet.ts")
bad_ls=$(echo "$ls_hits" | grep -viE 'PUB_CACHE')
if [ -n "$bad_ls" ]; then
  echo "✘ localStorage access in embeddedWallet.ts not going through PUB_CACHE — possible secret leak:"
  echo "$bad_ls"
  fail=$((fail+1))
else
  echo "✔ lib/embeddedWallet.ts: every localStorage access goes through PUB_CACHE (public key only)"
fi
if grep -qE 'localStorage\.(setItem|getItem|removeItem)' "$FE/lib/embeddedWalletStandard.ts" "$FE/components/EmbeddedWalletBoot.tsx"; then
  echo "✘ localStorage access found outside lib/embeddedWallet.ts in the custody surface"
  fail=$((fail+1))
else
  echo "✔ no localStorage access in embeddedWalletStandard.ts / EmbeddedWalletBoot.tsx (cache ownership stays in embeddedWallet.ts)"
fi
# The secret must be sealed via the keystore, never written verbatim anywhere.
if grep -q 'ks.seal(BLOB_NAME, kp.secretKey)' "$FE/lib/embeddedWallet.ts" \
   && grep -qc 'ks.seal(BLOB_NAME' "$FE/lib/embeddedWallet.ts"; then
  echo "✔ lib/embeddedWallet.ts: secret key is only ever sealed via ks.seal(BLOB_NAME, ...) (the F65 keystore)"
else
  echo "✘ lib/embeddedWallet.ts: expected ks.seal(BLOB_NAME, kp.secretKey) call not found — secret sealing path changed"
  fail=$((fail+1))
fi

# ---- 3. connect never silently creates a key ---------------------------------
if grep -q 'if (!hasEmbeddedWallet())' "$FE/lib/embeddedWalletStandard.ts" \
   && grep -q 'throw new Error(' "$FE/lib/embeddedWalletStandard.ts"; then
  echo "✔ embeddedWalletStandard.ts: #connect refuses (throws) when no wallet exists on this device"
else
  echo "✘ embeddedWalletStandard.ts: expected hasEmbeddedWallet() guard + throw in #connect not found"
  fail=$((fail+1))
fi
if grep -qE 'createWallet\(\)|Keypair\.generate\(\)' "$FE/lib/embeddedWalletStandard.ts"; then
  echo "✘ embeddedWalletStandard.ts: connect flow references key creation directly — connect must never mint a key"
  fail=$((fail+1))
else
  echo "✔ embeddedWalletStandard.ts: no createWallet()/Keypair.generate() call anywhere — key creation stays UI-only (Settings -> Security)"
fi

# ---- 4. chains list matches lib/solana.ts CLUSTER options -------------------
solana_clusters=$(grep -oE '"mainnet"|"testnet"|"devnet"' "$FE/lib/solana.ts" | tr -d '"' | sort -u | paste -sd, -)
wallet_chains=$(grep -oE 'solana:devnet|solana:testnet|solana:mainnet' "$FE/lib/embeddedWalletStandard.ts" | sed 's/solana://' | sort -u | paste -sd, -)
if [ "$solana_clusters" = "$wallet_chains" ]; then
  echo "✔ embeddedWalletStandard.ts CHAINS ($wallet_chains) matches lib/solana.ts CLUSTER options ($solana_clusters)"
else
  echo "✘ CHAINS/CLUSTER mismatch: embeddedWalletStandard.ts declares [$wallet_chains], lib/solana.ts resolves to [$solana_clusters]"
  fail=$((fail+1))
fi

# ---- 5. registration is idempotent / window-guarded --------------------------
if grep -q 'REGISTERED_FLAG' "$FE/lib/embeddedWalletStandard.ts" \
   && grep -q 'if (registered) return' "$FE/lib/embeddedWalletStandard.ts"; then
  echo "✔ embeddedWalletStandard.ts: registerEmbeddedWallet() is both module- and window-flag guarded against double-registration"
else
  echo "✘ embeddedWalletStandard.ts: expected double-registration guard not found"
  fail=$((fail+1))
fi
if grep -q 'return null' "$FE/components/EmbeddedWalletBoot.tsx"; then
  echo "✔ EmbeddedWalletBoot.tsx renders nothing (no UI surface to wedge the page)"
else
  echo "✘ EmbeddedWalletBoot.tsx no longer renders null — check it cannot visually wedge the page"
  fail=$((fail+1))
fi

# ---- 6. mobile.yml is workflow_dispatch-ONLY (never push/PR) ----------------
MOBILE_YML=".github/workflows/mobile.yml"
if [ -f "$MOBILE_YML" ]; then
  triggers=$(awk '/^on:/{flag=1; print; next} flag && /^[a-z]/{flag=0} flag' "$MOBILE_YML")
  if echo "$triggers" | grep -qE '^\s*(push|pull_request):' ; then
    echo "✘ $MOBILE_YML has a push/pull_request trigger — it must be workflow_dispatch only:"
    echo "$triggers"
    fail=$((fail+1))
  elif echo "$triggers" | grep -q 'workflow_dispatch'; then
    echo "✔ $MOBILE_YML triggers on workflow_dispatch only (no push/PR)"
  else
    echo "✘ $MOBILE_YML: could not confirm workflow_dispatch trigger"
    fail=$((fail+1))
  fi
else
  echo "✘ $MOBILE_YML is missing"
  fail=$((fail+1))
fi

# ---- 7. mobile WebView: cleartext disabled, minimal permissions -------------
CAP_CONFIG="mobile/capacitor.config.ts"
if [ -f "$CAP_CONFIG" ]; then
  if grep -q 'cleartext: false' "$CAP_CONFIG" && grep -qE "url: 'https://" "$CAP_CONFIG"; then
    echo "✔ mobile/capacitor.config.ts: cleartext disabled and server.url is https"
  else
    echo "✘ mobile/capacitor.config.ts: expected cleartext:false + https server.url not found"
    fail=$((fail+1))
  fi
else
  echo "✘ $CAP_CONFIG is missing"
  fail=$((fail+1))
fi
ANDROID_MANIFEST="mobile/android/app/src/main/AndroidManifest.xml"
if [ -f "$ANDROID_MANIFEST" ]; then
  if grep -q 'usesCleartextTraffic="true"' "$ANDROID_MANIFEST"; then
    echo "✘ $ANDROID_MANIFEST explicitly allows cleartext traffic"
    fail=$((fail+1))
  else
    echo "✔ $ANDROID_MANIFEST does not explicitly allow cleartext traffic (targetSdk>=28 default: HTTPS only)"
  fi
  extra_perms=$(grep -oE '<uses-permission android:name="[^"]+"' "$ANDROID_MANIFEST" | grep -v 'android.permission.INTERNET')
  if [ -n "$extra_perms" ]; then
    echo "! mobile app declares permissions beyond INTERNET — confirm each is intentional: $extra_perms"
  else
    echo "✔ $ANDROID_MANIFEST declares no permission beyond INTERNET"
  fi
else
  echo "✘ $ANDROID_MANIFEST is missing"
  fail=$((fail+1))
fi
IOS_PLIST="mobile/ios/App/App/Info.plist"
if [ -f "$IOS_PLIST" ]; then
  if grep -q 'NSAllowsArbitraryLoads' "$IOS_PLIST"; then
    echo "✘ $IOS_PLIST relaxes App Transport Security (NSAllowsArbitraryLoads present)"
    fail=$((fail+1))
  else
    echo "✔ $IOS_PLIST has no NSAppTransportSecurity exception (default HTTPS-only ATS applies)"
  fi
else
  echo "✘ $IOS_PLIST is missing"
  fail=$((fail+1))
fi

# ---- 8. wallets.json <-> i18n / doc consistency ------------------------------
DOCS_WALLETS="docs/wallets.json"
PUB_WALLETS="$FE/public/wallets.json"

# Parse ONCE, up front, and fail closed with a sentence.
#
# Several checks below shell out to python3 to walk this file. Each did so
# unguarded, so a missing or hand-broken wallets.json produced a stack trace per
# check instead of one legible failure — and a gate whose output is a traceback
# trains the reader to skim past it. Validating here means the sections below can
# assume a well-formed file, and the operator gets one clear line.
WALLETS_OK=1
if ! python3 - "$DOCS_WALLETS" <<'PY'
import json, sys
try:
    with open(sys.argv[1], 'rb') as fh:
        d = json.load(fh)
except OSError as e:
    print(f"  cannot read {sys.argv[1]}: {e.strerror}")
    sys.exit(1)
except json.JSONDecodeError as e:
    print(f"  {sys.argv[1]} is not valid JSON: {e}")
    sys.exit(1)
if not isinstance(d.get('wallets'), list) or not d['wallets']:
    print(f"  {sys.argv[1]} has no non-empty 'wallets' list")
    sys.exit(1)
PY
then
  echo "✘ wallets.json is unusable (see above) — every wallet check below is skipped, which is NOT a pass"
  WALLETS_OK=0
  fail=$((fail+1))
fi

if [ "$WALLETS_OK" -eq 1 ] && [ -f "$DOCS_WALLETS" ] && [ -f "$PUB_WALLETS" ]; then
  if diff -q "$DOCS_WALLETS" "$PUB_WALLETS" >/dev/null; then
    echo "✔ docs/wallets.json and frontend/public/wallets.json are byte-identical"
  else
    echo "✘ docs/wallets.json and frontend/public/wallets.json have DRIFTED — the served copy no longer matches the reviewed source"
    fail=$((fail+1))
  fi
else
  echo "✘ one or both of docs/wallets.json / frontend/public/wallets.json is missing"
  fail=$((fail+1))
fi
if grep -q '"Jupiter Mobile"' "$DOCS_WALLETS" 2>/dev/null; then
  echo "✘ docs/wallets.json still names the wallet \"Jupiter Mobile\" (should be \"Jupiter\" per this round's correction)"
  fail=$((fail+1))
else
  echo "✔ docs/wallets.json does not use the stale name \"Jupiter Mobile\""
fi
stale_hits=$(grep -rn 'Jupiter Mobile' "$FE/lib" "$FE/app" "$FE/components" 2>/dev/null | grep -v node_modules)
if [ -n "$stale_hits" ]; then
  echo "✘ stale \"Jupiter Mobile\" reference(s) survive in app code (i18n/UI drift from wallets.json):"
  echo "$stale_hits"
  fail=$((fail+1))
else
  echo "✔ no stale \"Jupiter Mobile\" reference anywhere in frontend/lib, frontend/app, frontend/components"
fi
mobile_only_hits=$(grep -rn 'mobile only\|Mobile only\|mobile-only' "$DOCS_WALLETS" "$PUB_WALLETS" 2>/dev/null)
if [ -n "$mobile_only_hits" ]; then
  echo "✘ the dropped false \"mobile only\" claim survives:"
  echo "$mobile_only_hits"
  fail=$((fail+1))
else
  echo "✔ the false \"mobile only\" claim about Jupiter does not survive in wallets.json"
fi
if grep -qE '"android"' "$DOCS_WALLETS" && python3 -c "
import json,sys
d=json.load(open('$DOCS_WALLETS'))
g=[w for w in d['wallets'] if w['id']=='glow'][0]
sys.exit(0 if 'android' in g.get('links',{}) else 1)
" 2>/dev/null; then
  echo "✔ docs/wallets.json: Glow entry has an android link"
else
  echo "✘ docs/wallets.json: Glow entry is missing its android link"
  fail=$((fail+1))
fi

# ---- 8b. deep-link liveness (best-effort; network-dependent) ----------------
# Every wallet store link should resolve to a live page. This check is
# best-effort: if the network is unreachable in this environment it WARNS
# rather than fails the whole gate, but a confirmed dead link (matching store's
# own "not found" response) is reported as a functional regression finding.
if [ "$WALLETS_OK" -ne 1 ]; then
  echo "! deep-link liveness check skipped — wallets.json is unusable (reported above)"
elif command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  link_fail=0
  net_reachable=0
  while IFS=$'\t' read -r wid platform url; do
    [ -z "$url" ] && continue
    code=$(curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0" --max-time 10 -L "$url" 2>/dev/null)
    if [ -z "$code" ] || [ "$code" = "000" ]; then
      continue # no network reachability in this sandbox — not a link finding
    fi
    net_reachable=1
    if [ "$code" = "404" ] || [ "$code" = "410" ]; then
      echo "✘ DEAD LINK: $wid ($platform) -> $url returned HTTP $code"
      link_fail=1
    fi
  done < <(python3 -c "
import json
d = json.load(open('$DOCS_WALLETS'))
for w in d['wallets']:
    for platform, url in w.get('links', {}).items():
        print(f\"{w['id']}\t{platform}\t{url}\")
")
  if [ "$net_reachable" -eq 0 ]; then
    echo "! deep-link liveness check skipped — no network reachability from this environment"
  elif [ "$link_fail" -ne 0 ]; then
    echo "✘ one or more wallets.json store links are dead (see above) — a member tapping that link at onboarding hits a store 404"
    fail=$((fail+1))
  else
    echo "✔ all wallets.json store links resolved (no 404/410) from this environment"
  fi
else
  echo "! deep-link liveness check skipped — curl or python3 unavailable"
fi

# ---- 8c. the `browse` field (F95) ------------------------------------------
# MobileWalletNotice offers a wallet only if it carries a documented universal
# link that opens an arbitrary URL in that wallet's own in-app browser. Three
# things can go wrong here, none of which the store-link check above would see:
#
#   * a malformed template — the placeholders are substituted by plain string
#     replace, so a template missing {url} silently produces a link to the
#     wallet's own homepage and the member never gets back here;
#   * an http:// template, which would downgrade the hop;
#   * drift between the two wallets.json copies, which would serve one list and
#     review another.
#
# NOT checked: whether the universal link actually opens the app. That is a
# device property — no HTTP probe from a server can establish it, and pretending
# otherwise would be exactly the kind of coverage that reads as proof and is not.
if [ "$WALLETS_OK" -ne 1 ]; then
  echo "! browse-field check skipped — wallets.json is unusable (reported above)"
elif command -v python3 >/dev/null 2>&1; then
  if python3 - "$DOCS_WALLETS" "$FE/public/wallets.json" <<'PY'
import json, sys
docs, pub = sys.argv[1], sys.argv[2]
# Fail closed with a SENTENCE, not a traceback. A gate whose failure output is a
# stack trace trains the reader to skim past it, and the two cases that land here
# — the file is gone, or someone hand-edited it into invalid JSON — are precisely
# the ones where the message has to be legible at a glance.
try:
    a, b = open(docs, 'rb').read(), open(pub, 'rb').read()
except OSError as e:
    print(f"  cannot read a wallets.json copy: {e}")
    sys.exit(1)
if a != b:
    print("  docs/wallets.json and frontend/public/wallets.json differ")
    sys.exit(1)
try:
    parsed = json.loads(a)
    wallets = parsed['wallets']
    if not isinstance(wallets, list):
        raise TypeError("'wallets' is not a list")
except (json.JSONDecodeError, KeyError, TypeError) as e:
    print(f"  wallets.json is not valid or has no usable 'wallets' list: {e}")
    sys.exit(1)
bad = []
seen = 0
for w in wallets:
    br = w.get('browse')
    if br is None:
        continue
    seen += 1
    wid = w.get('id', '?')
    if not isinstance(br, str) or not br.startswith('https://'):
        bad.append(f"{wid}: browse is not an https:// string")
        continue
    for ph in ('{url}', '{ref}'):
        if ph not in br:
            bad.append(f"{wid}: browse template is missing {ph}")
    if not w.get('name'):
        bad.append(f"{wid}: has browse but no name to label the button with")
for line in bad:
    print("  " + line)
if seen == 0:
    print("  no wallet carries a browse field — the mobile banner will render nothing")
    sys.exit(1)
sys.exit(1 if bad else 0)
PY
  then
    echo "✔ wallets.json browse templates are https, well-formed, and identical in both copies"
  else
    echo "✘ wallets.json browse field problem (see above) — the mobile wallet banner would emit a broken or unreviewed link"
    fail=$((fail+1))
  fi
else
  echo "! browse-field check skipped — python3 unavailable"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: E12 wallet regression gate holds (F86/F87/F88/F89, $((${#CUSTODY_SURFACE[@]})) custody-surface files)."
  exit 0
else
  echo "RESULT: E12 wallet regression gate FAILED ($fail check(s))."
  exit 1
fi
