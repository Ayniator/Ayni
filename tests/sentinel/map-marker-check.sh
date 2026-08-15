#!/usr/bin/env bash
# Sentinel gate — the "You are here" map marker (F99).
#
# WHY A STATIC CHECK. The marker only renders once the visitor grants browser
# geolocation, which no test in this repo can do: Playwright can fake a position,
# but the permission prompt and the secure-context requirement make it a device
# property, and a test that quietly never reaches the marker would pass whether
# or not any of this held. That failure mode has bitten this repo twice already
# (a privacy assertion that ran only where the component never mounted; a
# wording assertion that passed with the wrong word live). So the properties are
# asserted against the SOURCE, where they can actually fail.
#
# Four properties, from the change request:
#   1. the location marker renders the static asset;
#   2. no avatar/identicon generator is invoked on the map's own-position path;
#   3. the popup and alt text resolve through i18n, not a literal;
#   4. no geolocation coordinate reaches a network request, storage, or a log.
set -uo pipefail
cd "$(dirname "$0")/../.."

MAP="frontend/components/CircleMap.tsx"
HOME_PAGE="frontend/app/page.tsx"
ASSET="frontend/public/img/you-are-here.svg"
DICT="frontend/lib/i18n.generated.ts"
KEY="home.youAreHere"

fail=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=$((fail+1)); }

echo "F99 map-marker checks:"

for f in "$MAP" "$HOME_PAGE" "$ASSET" "$DICT"; do
  [ -f "$f" ] || { bad "$f is missing"; echo; echo "RESULT: $fail check(s) FAILED."; exit 1; }
done

# --- 1. the static asset, served from our own origin -----------------------
if grep -q "iconUrl: \"/img/you-are-here.svg\"" "$MAP"; then
  ok "the marker points at the vendored asset"
else
  bad "the marker no longer references /img/you-are-here.svg"
fi

# A root-relative path is what keeps this first-party. An absolute URL would
# hand the visitor's IP and a Referer naming this page to a third party — on the
# one page that has just read their location.
if grep -nE "iconUrl:\s*['\"]https?://" "$MAP" >/dev/null 2>&1; then
  bad "the marker icon is fetched from a remote host"
else
  ok "the marker icon is first-party (no remote iconUrl)"
fi

# The asset must be a real, self-contained SVG with no script and no external ref.
if head -c 200 "$ASSET" | grep -q "<svg"; then
  ok "the asset is an SVG"
else
  bad "the asset does not look like an SVG"
fi
# `xmlns="http://www.w3.org/2000/svg"` is a namespace NAME, not a fetch — the
# parser never requests it. Strip xmlns declarations before looking for a real
# remote reference, or the check fails on every valid SVG ever written.
if sed -E 's/xmlns(:[a-zA-Z]+)?="[^"]*"//g' "$ASSET" \
     | grep -qiE "<script|xlink:href|href=|https?://|<image|url\\(" ; then
  bad "the asset contains a script or an external reference"
else
  ok "the asset has no script and no external reference"
fi

# --- 2. no identicon on the own-position path ------------------------------
# The identicon helper is still legitimately used for CIRCLE markers, so this
# does not forbid the import — it forbids the OWN-POSITION marker using it. The
# old code seeded it with the literal "__you__"; that literal reappearing is the
# precise regression.
# Match the CALL, not the word: the comment above the helper explains the old
# "__you__" seed on purpose, and a gate that forbade naming the thing it
# prevents would force the explanation out of the code.
if grep -nE "^[^*/]*icon\\(\"__you__\"\\)" "$MAP" >/dev/null 2>&1; then
  bad "the own-position marker is seeding an identicon again (icon(\"__you__\"))"
else
  ok "no identicon seed on the own-position path"
fi
# The marker element itself must carry the static icon, not a divIcon.
if grep -q "icon={youAreHereIcon}" "$MAP"; then
  ok "the own-position Marker uses the static icon"
else
  bad "the own-position Marker no longer uses youAreHereIcon"
fi

# --- 3. the label resolves through i18n ------------------------------------
if grep -q "t(\"$KEY\")" "$MAP"; then
  ok "the label resolves through t(\"$KEY\")"
else
  bad "the label no longer resolves through t(\"$KEY\")"
fi

# A hardcoded English literal is the thing this replaced. Match it as JSX text
# or a string, not in a comment.
if grep -nE "^[^*/]*(<Popup>You are here|alt=\"You are here\"|[\"'\`]You are here[\"'\`])" "$MAP" >/dev/null 2>&1; then
  bad "a hardcoded \"You are here\" literal is back in the map component"
else
  ok "no hardcoded \"You are here\" literal in the map component"
fi

# Both the popup and the alt must use the SAME resolved label — an alt that
# drifts back to English is invisible to a sighted reviewer.
if grep -q "alt={hereLabel}" "$MAP" && grep -q "<Popup>{hereLabel}</Popup>" "$MAP"; then
  ok "popup and alt share one translated label"
else
  bad "popup and alt no longer share the translated label"
fi

# The key must exist in EVERY locale, not just English: a missing key renders as
# its own literal name (translate() ends `?? key`), which is how `admin.config.add`
# once reached the screen in all 19 languages.
locales=$(grep -cE '^  [a-z]{2}: \{' "$DICT")
defined=$(grep -c "\"$KEY\":" "$DICT")
if [ "$locales" -gt 0 ] && [ "$defined" -eq "$locales" ]; then
  ok "$KEY is defined in all $locales locales"
else
  bad "$KEY is defined in $defined of $locales locales"
fi

# And none of them may be left as the English placeholder.
english_copies=$(grep -c "\"$KEY\": \"You are here\"" "$DICT")
if [ "$english_copies" -le 1 ]; then
  ok "no non-English locale was left holding the English string"
else
  bad "$english_copies locales carry the English string verbatim"
fi

# --- 4. the coordinate stays on the device ---------------------------------
# The position is read by navigator.geolocation on the home page and passed to
# the map as props. It must never be persisted, transmitted, or logged.
if grep -nE "(localStorage|sessionStorage|indexedDB)[^\n]*(coords|latitude|longitude|\blat\b|\blon\b)" "$HOME_PAGE" "$MAP" >/dev/null 2>&1; then
  bad "a coordinate is being written to storage"
else
  ok "no coordinate written to storage"
fi

if grep -nE "(fetch|axios|XMLHttpRequest|navigator\.sendBeacon)\(" "$MAP" >/dev/null 2>&1; then
  bad "the map component makes a network call"
else
  ok "the map component makes no network call of its own"
fi

if grep -nE "console\.[a-z]+\([^)]*(coords|latitude|longitude)" "$HOME_PAGE" "$MAP" >/dev/null 2>&1; then
  bad "a coordinate is being logged"
else
  ok "no coordinate logged"
fi

# The position must come from the browser only — never an IP-geolocation service.
if grep -nEi "(ipapi|ip-api|geoip|ipinfo|freegeoip|geolocation-db)" "$HOME_PAGE" "$MAP" >/dev/null 2>&1; then
  bad "an IP-geolocation service is referenced"
else
  ok "no IP-geolocation service — the browser API only"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: F99 map-marker contract holds."
  exit 0
fi
echo "RESULT: $fail map-marker check(s) FAILED."
exit 1
