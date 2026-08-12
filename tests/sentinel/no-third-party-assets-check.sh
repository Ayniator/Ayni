#!/usr/bin/env bash
# Sentinel gate — no page may fetch a third-party asset.
#
# Origin: the Playwright suite caught every AHA page loading Google Fonts,
# because @solana/wallet-adapter-react-ui/styles.css opens with an @import to
# fonts.googleapis.com and WalletProviders wraps the whole app. That handed
# Google each member's IP, User-Agent and a Referer naming the page — including
# /recovery and /settings-security. Static privacy checks could not see it.
#
# This gate is deliberately blunt: no remote @import or url() in any CSS we
# ship, and no direct import of the upstream stylesheet.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$ROOT/frontend"
fail=0
ok() { echo "✔ $1"; }
bad() { echo "✖ $1"; fail=1; }

# 1. No app CSS may reference a remote host in an ACTIVE rule (comments are fine
#    — the vendored file documents the URL it removed).
hits=$(grep -rnE "^[^*/]*(@import[^;]*https?://|url\(\s*['\"]?https?://)" \
        "$FRONTEND/app" --include="*.css" 2>/dev/null || true)
if [ -n "$hits" ]; then bad "remote asset reference in app CSS:"; echo "$hits"; else
  ok "no remote @import/url() in any app CSS"; fi

# 2. Nothing may import the upstream wallet-adapter stylesheet directly.
# Scan only TS/TSX (a .css file may legitimately NAME the upstream file in its
# provenance header; only an actual JS/TS import pulls it into the bundle), and
# ignore commented-out lines.
up=$(grep -rn --include="*.ts" --include="*.tsx" \
      "@solana/wallet-adapter-react-ui/styles.css" \
      "$FRONTEND/app" "$FRONTEND/components" "$FRONTEND/lib" 2>/dev/null \
      | grep -vE ":\s*(//|\*)" || true)
if [ -n "$up" ]; then
  bad "upstream wallet-adapter stylesheet imported directly (it pulls Google Fonts):"; echo "$up"
else ok "upstream wallet-adapter stylesheet is not imported (vendored copy in use)"; fi

# 3. The vendored copy must exist and be free of the font import.
V="$FRONTEND/app/wallet-adapter.css"
if [ ! -f "$V" ]; then bad "vendored app/wallet-adapter.css is missing"; else
  if grep -qE "^[^*/]*fonts\.(googleapis|gstatic)\.com" "$V"; then
    bad "vendored CSS still references Google Fonts in an active rule"
  else ok "vendored CSS carries no active Google Fonts reference"; fi
fi

# 4. The re-vendor script must exist, so an upgrade cannot quietly reintroduce it.
if [ -x "$ROOT/scripts/vendor-wallet-adapter-css.mjs" ]; then
  ok "re-vendor script present for wallet-adapter upgrades"
else bad "scripts/vendor-wallet-adapter-css.mjs missing or not executable"; fi

echo
if [ "$fail" -eq 0 ]; then echo "RESULT: no third-party asset fetches in shipped CSS."; else
  echo "RESULT: third-party asset gate FAILED."; fi
exit "$fail"
