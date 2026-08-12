#!/usr/bin/env bash
# F35-R2 — mandatory sponsorship, still anonymous. Structural gate.
#
# `activate_faucet_zk` accepts a Groth16 proof against ONE root: the depth-20
# tree whose only leaf is `wing_peer.wing`, computed by the program. That single
# equality is the entire fix, and it has exactly two ways to die silently:
#
#   1. WIDENING. If the gate ever becomes
#        `root == member_tree.root || recent_roots.contains(root) || wing_root`
#      the regression is untouched — a self-endorsing neophyte simply keeps
#      sending the tree root, which is what tests/faucet.ts's "REFUSES the
#      current MEMBER TREE root" case submits. The wing root must REPLACE the
#      member-tree / F54-ring gate, never join it.
#   2. RING CONTAMINATION. If a wing-derived root were ever pushed into
#      `RecentRoots`, one commitment-holder could pass `attest_admission_zk`'s
#      gate as though they had proved membership of the whole tree — including a
#      commitment that is not in the tree at all. Every ring entry must remain a
#      genuine `member_tree.root` written by a seed-checked instruction.
#
# Both are grep-visible, so they are checked mechanically rather than argued.
set -uo pipefail
cd "$(dirname "$0")/../.."

IX=programs/ayni/src/instructions/activate_faucet_zk.rs
MK=programs/ayni/src/merkle.rs
fail=0
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

# Comments legitimately discuss `member_tree.root`; CODE must not read it.
code() { grep -vE '^\s*(//|///|\*)' "$1"; }

echo "F35-R2 wing-gate checks:"

if code "$IX" | grep -q 'member_tree\s*\.\s*root'; then
  bad "activate_faucet_zk CODE reads member_tree.root — the self-endorsement hole is open again"
else
  ok "activate_faucet_zk never reads member_tree.root"
fi

if code "$IX" | grep -qE 'recent_roots[^;]*\.contains'; then
  bad "activate_faucet_zk consults the F54 ring — the gate has been widened"
else
  ok "activate_faucet_zk never consults recent_roots"
fi

if code "$IX" | grep -q 'single_leaf_root(&ctx.accounts.wing_peer.wing)'; then
  ok "the expected root is computed from wing_peer.wing by the program"
else
  bad "activate_faucet_zk no longer derives the expected root from wing_peer.wing"
fi

if code "$IX" | grep -q 'EndorsementNotByWing'; then
  ok "the mismatch is refused with EndorsementNotByWing"
else
  bad "EndorsementNotByWing is gone — nothing enforces sponsorship"
fi

# The root must be compared, not merely computed: an unused `expected_root`
# would compile with a warning and enforce nothing.
if code "$IX" | grep -qE 'require!\(\s*root\s*==\s*expected_root'; then
  ok "root is required to EQUAL the wing root (a replacement, not one arm of an ||)"
else
  bad "no `require!(root == expected_root)` — the computed root is not enforced"
fi

if code "$IX" | grep -qE 'require!\([^)]*expected_root[^)]*\|\|'; then
  bad "the wing-root check is one arm of an || — that leaves the hole exactly as wide"
else
  ok "the wing-root check stands alone"
fi

# `single_leaf_root` must be called from the faucet and nowhere that writes the
# F54 ring. (Callers outside activate_faucet_zk.rs / merkle.rs / tests are a
# review trigger, not automatically wrong — so this reports, loudly.)
callers=$(grep -rln 'single_leaf_root' programs/ayni/src | grep -vE "(merkle.rs|activate_faucet_zk.rs|proptests.rs)$" || true)
if [ -n "$callers" ]; then
  bad "single_leaf_root has unexpected callers (ring contamination risk): $callers"
else
  ok "single_leaf_root is called only by activate_faucet_zk (+ merkle/proptests)"
fi

if grep -q 'pub(crate) static WING_ZEROS' "$MK"; then
  ok "WING_ZEROS is a static (.rodata guaranteed, not an LLVM courtesy)"
else
  bad "WING_ZEROS is not a `static` — a const is inlined as a 640-byte stack temporary"
fi

if code "$MK" | grep -q 'zeros(20)' && code "$MK" | grep -q 'single_leaf_root'; then
  # zeros(20) inside single_leaf_root would put 672 bytes on the caller's frame.
  if sed -n '/pub fn single_leaf_root/,/^}/p' "$MK" | grep -q 'zeros('; then
    bad "single_leaf_root calls zeros() — 672 bytes by value onto a 4 KiB-pressed frame"
  else
    ok "single_leaf_root does not call zeros()"
  fi
else
  ok "single_leaf_root does not call zeros()"
fi

exit $fail
