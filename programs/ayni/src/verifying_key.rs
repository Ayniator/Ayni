//! Groth16 verifying key for `circuits/lineage_grant.circom`.
//!
//! PLACEHOLDER — all-zero. The program will reject every real proof until this
//! file is regenerated from a trusted-setup ceremony:
//!
//!   node scripts/vk_to_rust.js build/verification_key.json \
//!     > programs/ayni/src/verifying_key.rs
//!
//! See circuits/README.md and docs/zk-lineage.md §6.
//!
//! `nr_pubinputs` MUST be 4, matching the public-signal order
//! [nullifier, root, grantedLevel, granteeCommitment] (snarkjs: outputs first).

use groth16_solana::groth16::Groth16Verifyingkey;

pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: 4,
    vk_alpha_g1: [0u8; 64],
    vk_beta_g2: [0u8; 128],
    vk_gamme_g2: [0u8; 128],
    vk_delta_g2: [0u8; 128],
    // One IC point per public input, plus one: nr_pubinputs + 1 = 5.
    vk_ic: &[[0u8; 64]; 5],
};
