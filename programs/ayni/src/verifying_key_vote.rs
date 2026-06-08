//! Groth16 verifying key for `circuits/member_vote.circom`.
//!
//! PLACEHOLDER — all-zero. Regenerate from the member_vote trusted-setup
//! ceremony (see circuits/README.md). Used for BOTH anonymous member voting
//! (`cast_vote`) and proof-of-personhood at issuance (`issue_membership`), since
//! both are the same inclusion + nullifier proof.
//!
//! `nr_pubinputs` MUST be 4: [nullifier, root, proposalId, choice].

use groth16_solana::groth16::Groth16Verifyingkey;

pub const VERIFYING_KEY_VOTE: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: 4,
    vk_alpha_g1: [0u8; 64],
    vk_beta_g2: [0u8; 128],
    vk_gamme_g2: [0u8; 128],
    vk_delta_g2: [0u8; 128],
    vk_ic: &[[0u8; 64]; 5],
};
