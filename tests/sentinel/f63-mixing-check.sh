#!/usr/bin/env bash
# Sentinel Layer A/D regression gate — F63 v2 (mailbox metadata mixing).
# New this round (NRR-2026-08-12-f35-f63v2).
#
# This gate re-checks, MECHANICALLY, the privacy claims F63 v2's own files and
# docs/messaging.md make. Do not weaken this script to make a round pass
# (Sentinel spec §4) — a relaxed assertion needs a commit note citing the
# backlog line that authorises it.
#
# Five checks:
#   1. The cover marker lives INSIDE the ciphertext (a distinct InnerEnvelope
#      field), never as a body prefix — so a real message's own text can never
#      be mistaken for / suppress a dummy, and the relay (route.ts) has no
#      notion of "cover" at all.
#   2. The cover budget (maxOutstandingCover) is strictly less than the relay's
#      MAX_PER_BOX, so cover traffic can never FIFO-evict real mail.
#   3. mbxReleaseAt is a monotone, non-decreasing ceiling of arrival time (FIFO
#      cannot invert) — re-derived from source, not just asserted by a test.
#   4. The relay's `get` handler sorts stamped rows on full-precision arrival
#      time strictly BEFORE the 100-row cap is applied.
#   5. The member-facing copy (msg.inbox.metadata) states BOTH what mixing now
#      protects and the residual leaks (source IP correlation + first-contact
#      uncovered), and docs/messaging.md §5 documents the same residuals —
#      under-claiming the leak is as serious as over-claiming the protection.

set -uo pipefail
cd "$(dirname "$0")/../.."
FE="frontend"
fail=0
pass() { echo "✔ $1"; }
bad()  { echo "✘ $1"; fail=$((fail+1)); }

MIX="$FE/lib/mailboxMixing.ts"
CRYPTO="$FE/lib/mailboxCrypto.ts"
ROUTE="$FE/app/api/mailbox/route.ts"
DOC="docs/messaging.md"

echo "=== F63 v2 mailbox-mixing regression gate ==="

for f in "$MIX" "$CRYPTO" "$ROUTE" "$DOC"; do
  [ -f "$f" ] || { bad "missing surface file: $f"; }
done

# ---- 1. cover marker is a ciphertext field, not a body prefix ---------------
if grep -q 'cover?: number' "$CRYPTO"; then
  pass "InnerEnvelope carries 'cover' as a distinct typed field (mailboxCrypto.ts)"
else
  bad "InnerEnvelope no longer declares a distinct 'cover' field"
fi

if grep -qE 'cover:\s*MBX_COVER_MARKER' "$MIX"; then
  pass "makeCoverInner sets cover as an object field, not a body prefix"
else
  bad "cover marker construction not found as an object field in mailboxMixing.ts"
fi

# The dummy's body must stay empty, not "cover:"-prefixed real-looking text.
if grep -qE 'body:\s*""' "$MIX"; then
  pass "the dummy body is empty (marker is not smuggled into body text)"
else
  bad "dummy body construction changed — verify the marker still isn't a body prefix"
fi

# The relay itself must have NO notion of the cover field — it can't
# distinguish real mail from dummies (that's what makes cover work).
# Strip full-line and trailing // comments first: the design is explained IN
# COMMENTS (that is honest documentation, not a leak) — what must never exist
# is CODE that reads/branches on a `cover` property.
CODE_ONLY=$(sed -E 's://.*$::' "$ROUTE")
if echo "$CODE_ONLY" | grep -qE '\.cover\b|\bcover\s*:' ; then
  bad "relay route.ts's CODE (not comments) references a 'cover' property — the relay must stay blind to it"
else
  pass "relay route.ts's code never reads/branches on a 'cover' property (relay-blind by construction; comments may explain the design)"
fi

# ---- 2. cover budget strictly under MAX_PER_BOX -----------------------------
COVER_BUDGET=$(grep -oE 'maxOutstandingCover:\s*[0-9]+' "$MIX" | grep -oE '[0-9]+' | head -1)
MAX_PER_BOX=$(grep -oE 'AHA_MAILBOX_MAX_PER_BOX \|\| [0-9]+' "$ROUTE" | grep -oE '[0-9]+' | head -1)
if [ -n "$COVER_BUDGET" ] && [ -n "$MAX_PER_BOX" ] && [ "$COVER_BUDGET" -lt "$MAX_PER_BOX" ]; then
  pass "cover budget ($COVER_BUDGET) is strictly under MAX_PER_BOX ($MAX_PER_BOX) — cover cannot evict real mail"
else
  bad "cover budget ($COVER_BUDGET) is NOT strictly under MAX_PER_BOX ($MAX_PER_BOX)"
fi

# ---- 3. mbxReleaseAt is a monotone ceiling ----------------------------------
if grep -qE 'return \(Math\.floor\(nowSecs / bucketSecs\) \+ 1\) \* bucketSecs;' "$MIX"; then
  pass "mbxReleaseAt is the next-grid-boundary ceiling — monotone non-decreasing in nowSecs by construction"
else
  bad "mbxReleaseAt's implementation changed shape — re-verify monotonicity by hand"
fi
if grep -q 'bucketSecs <= 0) return 0;' "$MIX"; then
  pass "bucketSecs <= 0 disables the delay (returns 0, immediate visibility) — no divide-by-zero/negative path"
else
  bad "the bucketSecs<=0 guard is missing from mbxReleaseAt"
fi

# ---- 4. get sorts on full arrival time BEFORE the page cap ------------------
SORT_LINE=$(grep -n 'stamped.sort((a, b) => a.ms - b.ms)' "$ROUTE" | head -1 | cut -d: -f1)
CAP_LINE=$(grep -n 'page.length >= 100' "$ROUTE" | head -1 | cut -d: -f1)
if [ -n "$SORT_LINE" ] && [ -n "$CAP_LINE" ] && [ "$SORT_LINE" -lt "$CAP_LINE" ]; then
  pass "get sorts on full-precision arrival time (line $SORT_LINE) strictly before the 100-cap (line $CAP_LINE)"
else
  bad "get's sort-then-cap ordering could not be confirmed (sort=$SORT_LINE, cap=$CAP_LINE)"
fi

# ---- 5. member-facing copy states BOTH protection AND residuals ------------
COPY=$(grep -A2 '"msg.inbox.metadata"' "$FE/lib/i18n.ts" | tr '\n' ' ')
if echo "$COPY" | grep -qiE 'decoy|padded to one size|constant timetable'; then
  pass "msg.inbox.metadata states what mixing now protects"
else
  bad "msg.inbox.metadata does not describe the mixing protections"
fi
if echo "$COPY" | grep -qiE 'internet address'; then
  pass "msg.inbox.metadata plainly states the source-IP correlation residual"
else
  bad "msg.inbox.metadata omits the source-IP correlation residual — under-claiming the leak"
fi
if echo "$COPY" | grep -qiE 'first message'; then
  pass "msg.inbox.metadata plainly states the first-contact-uncovered residual"
else
  bad "msg.inbox.metadata omits the first-contact-uncovered residual — under-claiming the leak"
fi

# docs/messaging.md §5 must document all the residuals, honestly.
for phrase in "Source IP next to mailbox id" "First contact is uncovered" "enrollment oracle" "Cover stops when the budget is full"; do
  if grep -qi "$phrase" "$DOC"; then
    pass "docs/messaging.md documents: $phrase"
  else
    bad "docs/messaging.md is missing the residual: $phrase"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: F63 v2 mailbox-mixing regression gate holds."
  exit 0
else
  echo "RESULT: F63 v2 mailbox-mixing regression gate FAILED ($fail check(s))."
  exit 1
fi
