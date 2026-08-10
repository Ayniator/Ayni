#!/usr/bin/env bash
# Sentinel Layer C — proof-layer integrity, without needing a validator.
#
# Three things must stay true, or a ballot verified in the browser is not the
# ballot the on-chain program checks:
#   1. each committed *_vkey.json really is the verification key of the
#      committed *_final.zkey (re-export and compare),
#   2. each programs/ayni/src/verifying_key*.rs really is that vkey compiled to
#      Rust (regenerate via scripts/vk_to_rust.js and diff the constants),
#   3. no embedded key is a placeholder (all-zero) — SECURITY.md forbids
#      shipping placeholder VKs.
# Established as a Round 1 baseline: all three circuits matched exactly.

set -uo pipefail
cd "$(dirname "$0")/../.."
BUILD=build
fails=0

command -v npx >/dev/null || { echo "npx required"; exit 1; }
[ -d "$BUILD" ] || { echo "✘ build/ (zkeys + vkeys) missing"; exit 1; }

echo "=== Sentinel Layer C — verifying-key integrity ==="

declare -A RS=( [member_vote]=verifying_key_vote.rs [lineage_grant]=verifying_key.rs [ack_disclose]=verifying_key_ack.rs )

for c in member_vote lineage_grant ack_disclose; do
  zkey="$BUILD/${c}_final.zkey"; vkey="$BUILD/${c}_vkey.json"; rs="programs/ayni/src/${RS[$c]}"
  if [ ! -f "$zkey" ] || [ ! -f "$vkey" ] || [ ! -f "$rs" ]; then
    echo "✘ $c: missing artifact (zkey/vkey/rs)"; fails=$((fails+1)); continue
  fi

  # 1. vkey == re-export of the zkey
  if npx --yes snarkjs@0.7.4 zkey export verificationkey "$zkey" "/tmp/${c}_reexport.json" >/dev/null 2>&1; then
    if node -e '
      const a=require(process.argv[1]), b=require(process.argv[2]);
      const norm=o=>JSON.stringify(o,Object.keys(o).sort());
      process.exit(norm(a)===norm(b)?0:1);
    ' "$PWD/$vkey" "/tmp/${c}_reexport.json"; then
      echo "✔ $c: committed vkey matches its zkey"
    else
      echo "✘ $c: committed vkey does NOT match its zkey"; fails=$((fails+1))
    fi
  else
    echo "✘ $c: snarkjs vkey export failed"; fails=$((fails+1))
  fi

  # 2. Rust constants == the vkey
  if node scripts/vk_to_rust.js "$vkey" > "/tmp/${c}.gen.rs" 2>/dev/null; then
    if diff <(grep -o '[0-9]\+' "/tmp/${c}.gen.rs" | tr '\n' ' ') \
            <(grep -o '[0-9]\+' "$rs" | tr '\n' ' ') >/dev/null; then
      echo "✔ $c: $rs constants identical to the vkey"
    else
      echo "✘ $c: $rs DIFFERS from the committed vkey"; fails=$((fails+1))
    fi
  else
    echo "✘ $c: vk_to_rust.js failed"; fails=$((fails+1))
  fi

  # 3. not a placeholder
  nz=$(grep -o '[0-9]\+' "$rs" | grep -vc '^0$')
  if [ "$nz" -gt 100 ]; then
    echo "✔ $c: real key embedded ($nz non-zero constants)"
  else
    echo "✘ $c: PLACEHOLDER key embedded ($nz non-zero constants)"; fails=$((fails+1))
  fi
done

echo
if [ "$fails" -gt 0 ]; then
  echo "RESULT: $fails proof-integrity check(s) FAILED — verifier drift, the round FAILS."
  exit 1
fi
echo "RESULT: proof layer intact (browser prover and on-chain verifier agree)."
