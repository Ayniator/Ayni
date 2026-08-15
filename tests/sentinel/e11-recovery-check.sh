#!/usr/bin/env bash
# Sentinel Layer F regression gate — F85 (Epic 11 recovery UX) + F66 (blinded
# guardian keys). Adds coverage for the human-layer UI shipped this round over
# F72-F79's already-tested cores (tests/sharding.ts, NRR-2026-08-11-F.md).
#
# This gate re-checks, MECHANICALLY, every locked position in CLAUDE.md that
# this round's files touch. Do not weaken this script to make a round pass
# (Sentinel spec §4) — a relaxed assertion needs a commit note citing the
# backlog line that authorises it.
#
# Surfaces under test (F85):
#   frontend/app/recovery/page.tsx
#   frontend/app/recovery/setup/page.tsx
#   frontend/components/ShardSend.tsx
#   frontend/components/ShardReceive.tsx
#   frontend/lib/shardSeal.ts
#   frontend/lib/recoveryUi.ts
#   frontend/lib/recovery.ts       (pre-existing, F75-F78 core)
#   frontend/lib/sharding.ts       (pre-existing, F72 core)
#   frontend/lib/shardCustody.ts   (pre-existing, F73 core)
#   frontend/lib/shardHandover.ts  (pre-existing, F74 core)
# Surface under test (F66):
#   frontend/lib/recoveryKeys.ts

set -uo pipefail
cd "$(dirname "$0")/../.."
FE="frontend"
fail=0

SURFACE=(
  "$FE/app/recovery/page.tsx"
  "$FE/app/recovery/setup/page.tsx"
  "$FE/components/ShardSend.tsx"
  "$FE/components/ShardReceive.tsx"
  "$FE/lib/shardSeal.ts"
  "$FE/lib/recoveryUi.ts"
  "$FE/lib/recovery.ts"
  "$FE/lib/sharding.ts"
  "$FE/lib/shardCustody.ts"
  "$FE/lib/shardHandover.ts"
  # F91 — the master secret is the CREDENTIAL OF RECORD (CLAUDE.md locked
  # position): recovery reconstructs it, and /recovery/setup creates it before
  # splitting it into shards. It was outside this list only because it landed
  # after the gate was written, which is why the import check kept failing.
  # Being in the surface means every invariant below now applies to it.
  "$FE/lib/masterSecret.ts"
)

for f in "${SURFACE[@]}"; do
  [ -f "$f" ] || { echo "✘ missing surface file: $f"; fail=$((fail+1)); }
done

echo "=== E11 recovery regression gate (F85 + F66) ==="

# ---- 1. no network code path anywhere in the recovery surface --------------
NET_PATTERN='fetch\(|XMLHttpRequest|WebSocket|sendBeacon|RTCPeerConnection|EventSource|new[[:space:]]+Image\(|\.src[[:space:]]*=|axios|http\.request|https\.request|navigator\.sendBeacon'
net_hits=$(grep -nE "$NET_PATTERN" "${SURFACE[@]}" 2>/dev/null)
if [ -n "$net_hits" ]; then
  echo "✘ network primitive found in the recovery surface:"
  echo "$net_hits"
  fail=$((fail+1))
else
  echo "✔ no network primitive (fetch/XHR/WebSocket/sendBeacon/WebRTC/EventSource/img-src) in the recovery surface"
fi

# ---- 1b. no chain/wallet import anywhere in the recovery surface -----------
CHAIN_PATTERN='@solana/web3\.js|@coral-xyz/anchor|wallet-adapter|@solana-mobile'
chain_hits=$(grep -nE "$CHAIN_PATTERN" "${SURFACE[@]}" 2>/dev/null)
if [ -n "$chain_hits" ]; then
  echo "✘ chain/wallet import found in the recovery surface:"
  echo "$chain_hits"
  fail=$((fail+1))
else
  echo "✔ no @solana/web3.js, anchor, or wallet-adapter import anywhere in the recovery surface"
fi

# ---- 1c. import-graph spot check: every relative import inside the surface
#          must resolve to another file already inside the declared surface
#          (or the one explicit UI leaf, SettingsProvider) — anything else is
#          an undeclared expansion of the surface and must be audited by hand.
ALLOWED_TARGETS="app/recovery/page app/recovery/setup/page components/ShardSend components/ShardReceive components/SettingsProvider lib/shardSeal lib/recoveryUi lib/recovery lib/sharding lib/shardCustody lib/shardHandover lib/masterSecret lib/keystore"
# lib/keystore is an ALLOWED IMPORT TARGET but deliberately NOT in SURFACE, and
# the distinction is the point. It is the Epic 8 passkey keystore and genuinely
# handles WebAuthn material, which this surface forbids — so pulling it INTO the
# surface would either fail check 10 correctly or force that check to be
# weakened. The boundary is: recovery may TRY to seal into the keystore, and
# must work when it cannot. Check 11 is what makes allowing this import safe;
# without it, a bare `await unlock()` in adoptMaster would sail through here.
import_graph_fail=0
for f in "${SURFACE[@]}"; do
  [ -f "$f" ] || continue
  dir=$(dirname "$f")
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    resolved_abs=$(cd "$dir" 2>/dev/null && node -e '
      const path = require("path");
      console.log(path.resolve(process.argv[1]));
    ' "$rel" 2>/dev/null)
    [ -z "$resolved_abs" ] && continue
    # relative to $FE, extension-stripped, for a stable comparison key
    rel_to_fe=$(node -e '
      const path = require("path");
      const fe = path.resolve(process.argv[1]);
      let p = path.relative(fe, process.argv[2]);
      p = p.replace(/\.(tsx|ts)$/, "");
      console.log(p);
    ' "$FE" "$resolved_abs")
    ok=0
    for allowed in $ALLOWED_TARGETS; do
      [ "$rel_to_fe" = "$allowed" ] && ok=1 && break
    done
    if [ "$ok" -ne 1 ]; then
      echo "✘ $f imports '$rel' -> resolves to '$rel_to_fe', outside the declared recovery surface — audit it"
      import_graph_fail=1
    fi
  done < <(grep -oE 'from "\.\./[^"]+"|from "\./[^"]+"' "$f" | sed -E 's/^from "(.*)"$/\1/')
done
if [ "$import_graph_fail" -ne 0 ]; then
  fail=$((fail+1))
else
  echo "✔ import graph of every surface file resolves only within the declared recovery surface (+ SettingsProvider)"
fi

# ---- 2. member-present requires a genuine member shard ----------------------
if grep -q 'mine.role !== "member"' "$FE/lib/recovery.ts" \
   && grep -q 'sponsor.role !== "sponsor"' "$FE/lib/recovery.ts"; then
  echo "✔ lib/recovery.ts: recoverMemberPresent enforces role !== member / !== sponsor"
else
  echo "✘ lib/recovery.ts: member-present role guard not found as expected"
  fail=$((fail+1))
fi
# Cryptographic teeth: the wizard unseals the member's own shard under the
# "member" role key specifically — a sponsor blob cannot open under it.
if grep -q 'openShard("member", c, sealed)' "$FE/app/recovery/page.tsx"; then
  echo "✔ app/recovery/page.tsx: member-present unlock opens under the \"member\" seal-role key"
else
  echo "✘ app/recovery/page.tsx: member-present unlock no longer opens under the \"member\" role key"
  fail=$((fail+1))
fi

# ---- 3. 7-day challenge window is not client-shortenable --------------------
if grep -q 'windowMs: CHALLENGE_WINDOW_MS' "$FE/lib/recoveryUi.ts"; then
  echo "✔ lib/recoveryUi.ts: loadPendingRecovery ignores any stored windowMs, always uses CHALLENGE_WINDOW_MS"
else
  echo "✘ lib/recoveryUi.ts: loadPendingRecovery no longer pins windowMs to CHALLENGE_WINDOW_MS — a tampered record could shorten the window"
  fail=$((fail+1))
fi
if grep -q 'disabled={!elapsed || busy}' "$FE/app/recovery/page.tsx" \
   && grep -q 'const elapsed = windowElapsed(pending, now)' "$FE/app/recovery/page.tsx"; then
  echo "✔ app/recovery/page.tsx: completion button is gated on a fresh windowElapsed(pending, now) call, no skip affordance"
else
  echo "✘ app/recovery/page.tsx: sponsor-only completion no longer gates on a fresh windowElapsed() check"
  fail=$((fail+1))
fi
if grep -qE 'dev|skip|bypass|shorten' "$FE/app/recovery/page.tsx" | grep -viq 'DevNote\|comment'; then
  : # no-op — the grep above is a placeholder; real skip-affordance check below
fi
skip_hits=$(grep -niE '\bskip[- ]?window\b|\bdev[- ]?shortcut\b|\bbypass[- ]?window\b' "$FE/app/recovery/page.tsx" "$FE/lib/recoveryUi.ts" "$FE/lib/recovery.ts")
if [ -n "$skip_hits" ]; then
  echo "✘ possible dev/skip affordance for the challenge window found:"
  echo "$skip_hits"
  fail=$((fail+1))
else
  echo "✔ no dev/skip/bypass affordance for the challenge window"
fi

# ---- 4. no shard on any server, no enumeration ------------------------------
if grep -qE '^\s*(list|keys|count|entries|iterate|has)\s*\(' "$FE/lib/shardCustody.ts"; then
  echo "✘ lib/shardCustody.ts: an enumeration method appeared on the ShardCustody interface/impl"
  fail=$((fail+1))
else
  echo "✔ lib/shardCustody.ts: no list/keys/count/entries/iterate/has method exists"
fi
custody_net=$(grep -nE "$NET_PATTERN" "$FE/lib/shardCustody.ts")
if [ -n "$custody_net" ]; then
  echo "✘ lib/shardCustody.ts has a network primitive: $custody_net"
  fail=$((fail+1))
else
  echo "✔ lib/shardCustody.ts: no network code path (local-only, browser localStorage)"
fi

# ---- 5. shard handling: vetted libs only, no hand-rolled field arithmetic ---
if grep -q '"shamir-secret-sharing"' "$FE/package.json" && grep -q '"tweetnacl"' "$FE/package.json"; then
  echo "✔ package.json declares shamir-secret-sharing + tweetnacl as direct dependencies"
else
  echo "✘ package.json is missing a direct dependency on shamir-secret-sharing and/or tweetnacl"
  fail=$((fail+1))
fi
# Scan only non-comment lines for hand-rolled field-arithmetic code (the file's
# own header comment approvingly NAMES "GF(256)" to describe the vetted
# library it delegates to — that mention must not itself trip the gate).
sharding_code_only=$(grep -vE '^\s*//' "$FE/lib/sharding.ts")
if grep -q 'from "shamir-secret-sharing"' "$FE/lib/sharding.ts" \
   && ! echo "$sharding_code_only" | grep -qiE 'galois|gf\(256\)|lagrange' \
   && ! grep -qE 'for \(|while \(' "$FE/lib/sharding.ts"; then
  echo "✔ lib/sharding.ts: split/combine delegate to the vetted library, no hand-rolled field arithmetic (no loop construct in the file at all)"
else
  echo "✘ lib/sharding.ts: expected import from shamir-secret-sharing (and no hand-rolled GF(256)/Lagrange code, no loop) not found as expected"
  fail=$((fail+1))
fi
if grep -q 'import nacl from "tweetnacl"' "$FE/lib/shardSeal.ts" && grep -q 'nacl.secretbox' "$FE/lib/shardSeal.ts"; then
  echo "✔ lib/shardSeal.ts: sealing uses tweetnacl secretbox, not a hand-rolled cipher"
else
  echo "✘ lib/shardSeal.ts: expected tweetnacl secretbox usage not found"
  fail=$((fail+1))
fi
# qrcode dependency hygiene: ShardSend imports it, so it must be a DIRECT
# dependency in package.json, not merely present transitively in node_modules.
if grep -q 'import QRCode from "qrcode"' "$FE/components/ShardSend.tsx"; then
  if grep -qE '^\s*"qrcode":' "$FE/package.json"; then
    echo "✔ package.json declares qrcode as a direct dependency"
  else
    echo "✘ frontend/components/ShardSend.tsx imports \"qrcode\" but frontend/package.json declares no direct dependency on it — it currently resolves only because @solana-mobile/wallet-standard-mobile happens to pull it in transitively (see package-lock.json). This is a real regression risk, not a style nit: if that transitive edge ever changes, the import breaks with no warning from tsc (which only checks types, not registered dependencies)."
    fail=$((fail+1))
  fi
fi

# ---- 5b. burn-and-reissue is mandatory in the wizard, not optional ---------
if grep -q 'function RecoveredPanel' "$FE/app/recovery/page.tsx" \
   && ! grep -qE 'onDone\(\)\s*}\s*/>' "$FE/app/recovery/page.tsx" ; then
  : # sanity placeholder, see next real check
fi
if grep -q 'stage === "finished"' "$FE/app/recovery/page.tsx" \
   && grep -c '"prompt" | "sendA" | "sendB" | "finished"' "$FE/app/recovery/page.tsx" | grep -q '^[1-9]'; then
  echo "✔ app/recovery/page.tsx: the \"done\" button only renders at stage \"finished\" — reissue is not skippable inside the wizard"
else
  echo "✘ app/recovery/page.tsx: could not confirm the reissue stage machine still gates \"done\" behind \"finished\""
  fail=$((fail+1))
fi
if grep -q 'localShardCustody.burn(intentShardCode(pending.code, 1))' "$FE/app/recovery/page.tsx" \
   && grep -q 'localShardCustody.burn(intentShardCode(pending.code, 2))' "$FE/app/recovery/page.tsx"; then
  echo "✔ app/recovery/page.tsx: sponsor-only completion unconditionally burns both consumed sponsor-shard custody entries"
else
  echo "✘ app/recovery/page.tsx: sponsor-only completion no longer burns the consumed sponsor shards"
  fail=$((fail+1))
fi

# ---- 6. provisional-member disclosure: onboarding AND ceremony -------------
if grep -q 'onboarding.f78.title' "$FE/app/onboarding/page.tsx"; then
  echo "✔ onboarding/page.tsx: F78 disclosure card present"
else
  echo "✘ onboarding/page.tsx: F78 disclosure card missing"
  fail=$((fail+1))
fi
if grep -q 'sponsorRecoveryAvailable(1)' "$FE/app/recovery/setup/page.tsx"; then
  echo "✔ recovery/setup/page.tsx: ceremony consults the shared sponsorRecoveryAvailable() guard for a 1-sponsor split"
else
  echo "✘ recovery/setup/page.tsx: ceremony no longer refuses a 1-sponsor split via the shared guard"
  fail=$((fail+1))
fi
if grep -q 'function StepProvisional' "$FE/app/recovery/setup/page.tsx"; then
  echo "✔ recovery/setup/page.tsx: a real StepProvisional dead-end exists (no fake ceremony for one sponsor)"
else
  echo "✘ recovery/setup/page.tsx: StepProvisional dead-end not found"
  fail=$((fail+1))
fi

# ---- 7. F66 — derivation-only, unlinkable, NOT wired into local recovery ---
recoverykeys_ref=$(grep -rlE 'recoveryKeys' "$FE/app/recovery" "$FE/components/ShardSend.tsx" "$FE/components/ShardReceive.tsx" "$FE/lib/shardSeal.ts" "$FE/lib/recoveryUi.ts" "$FE/lib/recovery.ts" 2>/dev/null)
if [ -n "$recoverykeys_ref" ]; then
  echo "✘ frontend/lib/recoveryKeys.ts (F66, on-chain guardian rebind) is imported from the LOCAL recovery surface — locked-position violation:"
  echo "$recoverykeys_ref"
  fail=$((fail+1))
else
  echo "✔ lib/recoveryKeys.ts is not imported anywhere in the local-recovery surface (F85 pages/components/lib)"
fi
if grep -qE '^\s*(list|enumerate|getAll|dump)\s*\(' "$FE/lib/recoveryKeys.ts"; then
  echo "✘ lib/recoveryKeys.ts: an enumeration/listing export appeared — F66 must stay derivation-only"
  fail=$((fail+1))
else
  echo "✔ lib/recoveryKeys.ts: no storage/enumeration export — derivation-only, as declared"
fi
if grep -qE 'localStorage|indexedDB|sessionStorage' "$FE/lib/recoveryKeys.ts"; then
  echo "✘ lib/recoveryKeys.ts: unexpected persistence call found"
  fail=$((fail+1))
else
  echo "✔ lib/recoveryKeys.ts: no persistence call (derivation-only, as declared)"
fi

# member.ts still declares the F66 wiring a deliberate follow-up (2 sites:
# the dev-only fixture signer at :88, and the real issueMembership call at
# :251) — both must still pass PublicKey.default, i.e. blinded keys are not
# silently wired in this round.
member_default_count=$(grep -c 'PublicKey.default' "$FE/lib/member.ts")
if [ "$member_default_count" -ge 2 ]; then
  echo "✔ lib/member.ts: still passes PublicKey.default ($member_default_count occurrences) — F66 wiring remains a declared follow-up, not a silent change"
else
  echo "✘ lib/member.ts: PublicKey.default occurrence count dropped to $member_default_count — F66 may have been silently wired into issueMembership this round; requires an explicit backlog note, not a quiet edit"
  fail=$((fail+1))
fi

# ---- 8. seal-derivation consistency between the two usage sites ------------
# /recovery/setup and /recovery must derive shard seal keys IDENTICALLY, or a
# shard sealed at the ceremony could silently fail to open at recovery. Both
# pages must import from the ONE shared lib/shardSeal.ts, not a local copy.
if grep -q 'from "\(\.\./\)\{1,2\}lib/shardSeal"' "$FE/app/recovery/page.tsx" \
   && grep -q 'from "\(\.\./\)\{1,3\}lib/shardSeal"' "$FE/app/recovery/setup/page.tsx"; then
  echo "✔ both /recovery and /recovery/setup import sealing from the SAME frontend/lib/shardSeal.ts (single derivation, no drift)"
else
  echo "✘ /recovery and /recovery/setup no longer both import from the shared frontend/lib/shardSeal.ts — seal-derivation drift risk"
  fail=$((fail+1))
fi
if grep -q 'aha-shard-seal-v1' "$FE/lib/shardSeal.ts" && [ "$(grep -c 'aha-shard-seal-v1' "$FE/lib/shardSeal.ts")" = "1" ]; then
  echo "✔ the seal-key domain tag \"aha-shard-seal-v1\" is defined exactly once (in the header comment AND the derivation — see below)"
fi
# The domain tag must appear in the actual key-derivation line, not just prose.
if grep -q 'aha-shard-seal-v1:' "$FE/lib/shardSeal.ts"; then
  echo "✔ lib/shardSeal.ts: sealKeyFor derives from the versioned domain tag \"aha-shard-seal-v1:<role>:<code>\""
else
  echo "✘ lib/shardSeal.ts: expected domain-tag string in the key derivation not found"
  fail=$((fail+1))
fi

# ---- 9. secret hygiene: no console.log of secret-bearing material ----------
console_hits=$(grep -n 'console\.' "${SURFACE[@]}" 2>/dev/null)
if [ -n "$console_hits" ]; then
  echo "✘ console.* call found in the recovery surface:"
  echo "$console_hits"
  fail=$((fail+1))
else
  echo "✔ no console.* call anywhere in the recovery surface"
fi

# ---- 10. no biometric byte handling in recovery (passkey never gates it) ---
# The strong tokens are real WebAuthn API surface and are matched anywhere. The
# bare word "biometric" is matched only OUTSIDE comments: a file in this surface
# may legitimately EXPLAIN that the passkey is a device-local unlock and never
# gates recovery — forbidding it from saying so would push the explanation out
# of the code, and masterSecret.ts's comment is exactly that sentence.
bio_hits=$(grep -nE 'attestationObject|rawId|PublicKeyCredential' "${SURFACE[@]}" 2>/dev/null
           grep -niE '^[^*/]*\bbiometric\b' "${SURFACE[@]}" 2>/dev/null)
if [ -n "$bio_hits" ]; then
  echo "✘ biometric/WebAuthn material referenced in the recovery surface:"
  echo "$bio_hits"
  fail=$((fail+1))
else
  echo "✔ no biometric/WebAuthn byte handling anywhere in the recovery surface — recovery does not gate on a passkey"
fi

# ---- 11. recovery must not GATE on the passkey ----------------------------
# CLAUDE.md, binding: "The passkey (Epic 8) is a device-local unlock for a
# locally-encrypted keystore — it is never the credential of record and never
# gates recovery on its own."
#
# `adoptMaster` is the function recovery calls once the master is reconstructed.
# It may TRY to seal into the keystore, but a device with no keystore must still
# end up with a working member — so the unlock has to be inside a try/catch that
# returns rather than throws. If that ever becomes a bare `await unlock()`, a
# member recovering onto a fresh device is locked out by a passkey they do not
# have, and nothing else in this gate would notice.
MS="$FE/lib/masterSecret.ts"
if [ -f "$MS" ]; then
  adopt=$(sed -n '/export async function adoptMaster/,/^}/p' "$MS")
  if ! printf '%s' "$adopt" | grep -q "unlock()"; then
    echo "✔ adoptMaster does not touch the keystore at all — recovery cannot gate on a passkey"
  elif printf '%s' "$adopt" | grep -q "try {" && printf '%s' "$adopt" | grep -qE "\} catch"; then
    echo "✔ adoptMaster tolerates a missing keystore (unlock is inside try/catch) — recovery does not gate on a passkey"
  else
    echo "✘ adoptMaster calls unlock() WITHOUT a catch — recovery would gate on a passkey (CLAUDE.md locked position)"
    fail=$((fail+1))
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: E11 recovery regression gate holds (F85 + F66, $((${#SURFACE[@]})) core surface files + recoveryKeys.ts)."
  exit 0
else
  echo "RESULT: E11 recovery regression gate FAILED ($fail check(s))."
  exit 1
fi
