# Building & testing Ayni

The program is code-complete but must be built on a machine with the Solana +
Anchor toolchain (not present in this dev container).

## One command

```bash
make setup   # installs Rust, Solana CLI 1.18.26, Anchor 0.30.1, JS deps (idempotent)
make build   # anchor build  -> BPF + IDL + target/types/ayni.ts
make test    # anchor test   -> spins a local validator, runs the no-ZK suites
```

(or run `scripts/setup.sh` / `scripts/build.sh` / `scripts/test.sh` directly.)

After `setup`, ensure the Solana bin dir is on PATH:

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

## What `make test` runs today (no circuits needed)

| Suite | Covers |
|---|---|
| `tests/ayni.ts` | init Circle + member tree + issue membership |
| `tests/resilience.ts` | 7-seat Council: 4-of-7, time-lock, any-seat contest |
| `tests/cosign.ts` | member co-signature & self-recovery (2 guardians) |

These exercise the Council/recovery/membership logic — **the first real
compile-verification** of the 25 instructions. Expect to fix Anchor-0.30 / borsh
details that can't be caught unbuilt (optional accounts, fixed-array args, the
`SetAuthority` enum, etc.).

## ZK suites (next, after a build is green)

`cast_vote`, `grant_level`, `issue_acknowledgment`, `verify_disclosure`,
`prove_personhood` need compiled circuits + trusted-setup keys first:

1. Compile a circuit and run a (single-contributor, for local testing) ceremony —
   see `circuits/README.md`. Start with `member_vote` (simplest).
2. Regenerate the matching `programs/ayni/src/verifying_key*.rs` via
   `scripts/vk_to_rust.js`.
3. Write the ZK test using `app/**/prove.ts` to build proofs.

This is also where the **Poseidon compatibility** (circom ↔ light-poseidon) and
the **snarkjs→groth16-solana byte encodings** get validated for real — see
`SECURITY.md` operational requirements (do not ship placeholder VKs).

## Versions

Solana `1.18.26`, Anchor `0.30.1` (pinned in `scripts/setup.sh` and CI). CI runs
the same `build` + `test` on every push to `solana` (`.github/workflows/ci.yml`).
