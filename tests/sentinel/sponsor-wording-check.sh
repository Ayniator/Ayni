#!/usr/bin/env bash
# F97 — the compassionate-wording contract for sponsorship.
#
# WHY THIS IS A STATIC CHECK AND NOT AN E2E TEST. The accept/decline controls on
# /sponsor-request, and the release buttons on /me, render only for a CONNECTED
# member of the relevant Circle. No browser test in this repo can be that, so an
# e2e assertion like "the page never says 'reject'" passes whether or not the
# word is in the product — it was written that way once, and it passed with
# "Reject" live in the dictionary. Coverage that cannot fail reads as proof and
# is not.
#
# The strings themselves are what a careless edit changes, so the strings are
# what this checks. Run:  bash tests/sentinel/sponsor-wording-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

DICT="frontend/lib/i18n.generated.ts"
fail=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=$((fail+1)); }

echo "F97 sponsorship wording checks:"

[ -f "$DICT" ] || { echo "  FAIL $DICT missing"; exit 1; }

# The English block is the canonical registry; every other locale falls back to
# it, so a blunt string here reaches every language.
en_value() { # $1 = key
  grep -m1 "\"$1\":" "$DICT" | sed 's/.*: *"//; s/",\{0,1\}$//'
}

# 1. The keys must exist at all. A missing key renders as its own literal name
#    (translate() ends `?? key`), which is how `admin.config.add` once reached
#    the screen.
for k in sponreq.accept sponreq.decline sponreq.declined \
         me.spon.releaseLink me.spon.confirmReleaseSponsor me.spon.confirmReleaseSponsee \
         me.spon.sponsorsTitle me.spon.sponseesTitle me.spon.softMinimum; do
  if grep -q "\"$k\":" "$DICT"; then ok "$k is defined"; else bad "$k is MISSING (would render as a raw key)"; fi
done

# 2. No blunt vocabulary in the member-facing sponsorship strings. "Reject" and
#    "Delete" are the two the spec explicitly replaces.
for k in sponreq.decline sponreq.accept me.spon.releaseLink; do
  v="$(en_value "$k")"
  if printf '%s' "$v" | grep -qiE '\b(reject|delete|remove|deny|refuse)\b'; then
    bad "$k uses blunt wording: \"$v\""
  else
    ok "$k reads compassionately: \"$v\""
  fi
done

# 3. The decline affordance must be the agreed phrase, not merely non-blunt.
v="$(en_value sponreq.decline)"
if printf '%s' "$v" | grep -qi 'not at this time'; then
  ok "decline is \"Not at this time\""
else
  bad "decline drifted from \"Not at this time\": \"$v\""
fi

# 4. "bond" was renamed to "Link" by the user (2026-08-15). Catch a revert.
if grep -oE '"(me\.spon|sponreq)\.[A-Za-z]+": "[^"]*"' "$DICT" | grep -qi '\bbond\b'; then
  bad "a sponsorship string still says \"bond\" (renamed to \"Link\")"
else
  ok "no sponsorship string says \"bond\""
fi

# 5. Declining must record nothing — the copy must not promise a stored refusal.
v="$(en_value sponreq.declined)"
if printf '%s' "$v" | grep -qi 'nothing was recorded'; then
  ok "declining states plainly that nothing was recorded"
else
  bad "the declined message no longer says nothing was recorded: \"$v\""
fi

# 6. The recommended-minimum hint must stay a SUGGESTION. If this copy ever
#    starts promising a gate, the soft rule has quietly become a hard one.
v="$(en_value me.spon.softMinimum)"
if printf '%s' "$v" | grep -qiE '\b(must|required|cannot|blocked|denied)\b'; then
  bad "the minimum-sponsors hint reads as a gate: \"$v\""
else
  ok "the minimum-sponsors hint stays a suggestion"
fi

# 7. Release confirmations must reassure the member they lose nothing else.
for k in me.spon.confirmReleaseSponsor me.spon.confirmReleaseSponsee; do
  v="$(en_value "$k")"
  if printf '%s' "$v" | grep -qi 'full use of the platform'; then
    ok "$k reassures about continued access"
  else
    bad "$k no longer reassures the member they keep full use: \"$v\""
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: F97 wording contract holds."
  exit 0
fi
echo "RESULT: $fail wording check(s) FAILED."
exit 1
