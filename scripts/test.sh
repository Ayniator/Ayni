#!/usr/bin/env bash
# Run the no-ZK test suites against a fresh local validator.
#
# All current suites are circuit-free and runnable today:
#   tests/ayni.ts        — init Circle + member tree + issue membership
#   tests/resilience.ts  — 7-seat Council: 4-of-7, time-lock, contest
#   tests/cosign.ts      — member co-signature & self-recovery (2 guardians)
#
# ZK suites (cast_vote / grant_level / verify_disclosure / prove_personhood)
# need compiled circuits + trusted-setup keys first — see circuits/README.md.
set -euo pipefail
anchor test
