//! Groth16 verifying key for `circuits/ack_disclose.circom`.
//!
//! PLACEHOLDER — all-zero. Regenerate from the ack_disclose trusted-setup
//! ceremony (see circuits/README.md):
//!
//!   node scripts/vk_to_rust.js build/ack_verification_key.json \
//!     | sed 's/VERIFYING_KEY/VERIFYING_KEY_ACK/' \
//!     > programs/ayni/src/verifying_key_ack.rs
//!
//! `nr_pubinputs` MUST be 17, matching the public-signal order
//! [dateOk, courseAccredited, teacherRecognized, root, revealP, revealC,
//!  revealX, revealD, valueP, valueC, valueX, valueD, dateLowerBound,
//!  catalogRoot, enableCatalog, teacherSetRoot, enableTeacherSet].

use groth16_solana::groth16::Groth16Verifyingkey;

pub const VERIFYING_KEY_ACK: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: 17,
    vk_alpha_g1: [0u8; 64],
    vk_beta_g2: [0u8; 128],
    vk_gamme_g2: [0u8; 128],
    vk_delta_g2: [0u8; 128],
    // nr_pubinputs + 1 = 18 IC points.
    vk_ic: &[[0u8; 64]; 18],
};
