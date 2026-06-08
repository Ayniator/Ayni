# Ayni circuits — build & trusted setup

Two circuits:

- **`lineage_grant.circom`** → `verifying_key.rs` compiled into the `ayni`
  program (on-chain verification of level grants). See `../docs/zk-lineage.md`.
  This VK is **also reused** by `issue_acknowledgment` (issuer-anonymous
  attestation), so acknowledgment issuance needs no separate ceremony.
- **`ack_disclose.circom`** → its own verifying key, used to verify holder
  selective-disclosure proofs (off-chain, or on-chain with a separate
  `ack_disclose` VK). See `../docs/acknowledgments.md`. Run the same compile +
  ceremony steps below, substituting `ack_disclose` for `lineage_grant`.

## Prerequisites

```
npm install            # pulls circomlib, snarkjs
# install circom 2.x:  https://docs.circom.io/getting-started/installation/
```

## 1. Compile the circuit

```
circom circuits/lineage_grant.circom \
  --r1cs --wasm --sym \
  -l node_modules \
  -o build/
```

Produces `build/lineage_grant.r1cs`, `build/lineage_grant_js/lineage_grant.wasm`.

## 2. Powers of Tau (phase 1 — circuit-independent, reuse a public one)

```
# A depth-20 circuit fits comfortably under 2^16 constraints.
snarkjs powersoftau new bn128 16 build/pot16_0.ptau -v
snarkjs powersoftau contribute build/pot16_0.ptau build/pot16_1.ptau --name="ayni-1" -v
snarkjs powersoftau prepare phase2 build/pot16_1.ptau build/pot16_final.ptau -v
```

## 3. Phase-2 ceremony (circuit-specific)

```
snarkjs groth16 setup build/lineage_grant.r1cs build/pot16_final.ptau build/lineage_0.zkey
snarkjs zkey contribute build/lineage_0.zkey build/lineage_final.zkey --name="ayni-2" -v
snarkjs zkey export verificationkey build/lineage_final.zkey build/verification_key.json
```

> For production this MUST be a multi-party ceremony (each Circle / World Service
> contributing). A single-contributor key is fine only for local testing.

## 4. Generate `verifying_key.rs`

Convert the snarkjs verifying key into the Rust constant the program embeds:

```
node scripts/vk_to_rust.js build/verification_key.json \
  > programs/ayni/src/verifying_key.rs
```

(`scripts/vk_to_rust.js` emits a `groth16_solana::groth16::Groth16Verifyingkey`
literal — note that the on-chain side negates `vk_alpha_g1`/handles `g2` byte
order; the script applies the same conventions as `app/lineage/prove.ts`.)

## 5. Produce a proof for `grant_level`

```
ts-node app/lineage/prove.ts
```

See `app/lineage/prove.ts` for assembling the witness (secret, level, Merkle
path) and formatting `proof_a/b/c` + public inputs into instruction args.
