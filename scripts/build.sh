#!/usr/bin/env bash
# Build the `ayni` Anchor program (BPF) + generate the IDL and TS types.
set -euo pipefail
anchor build
echo "==> Built. IDL + types under target/ (target/types/ayni.ts)."
