use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{AccessPass, Acknowledgment};
use crate::verifying_key_ack::VERIFYING_KEY_ACK;

// Public-signal indices for circuits/ack_disclose.circom (outputs first).
const I_DATE_OK: usize = 0;
const I_COURSE_ACCREDITED: usize = 1;
const I_TEACHER_RECOGNIZED: usize = 2;
const I_ROOT: usize = 3;
const I_CATALOG_ROOT: usize = 13;
const I_TEACHER_SET_ROOT: usize = 15;
pub const ACK_DISCLOSE_PUBLIC_INPUTS: usize = 17;

/// What a gate demands of a disclosure before granting access.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DisclosureGate {
    pub require_date_ok: bool,
    pub require_course_accredited: bool,
    pub require_teacher_recognized: bool,
    /// Trusted, pinned roots the proof's predicate must have been checked against
    /// (a prover could otherwise pass a self-made set root).
    pub expected_catalog_root: [u8; 32],
    pub expected_teacher_set_root: [u8; 32],
}

/// Verify an acknowledgment selective-disclosure proof and, if it satisfies the
/// gate's predicate requirements, mint an `AccessPass` — durable proof the
/// holder is eligible for `gate`, without learning anything they didn't disclose.
pub fn verify_disclosure(
    ctx: Context<VerifyDisclosure>,
    gate: [u8; 32],
    requirements_hash: [u8; 32],
    public_inputs: [[u8; 32]; ACK_DISCLOSE_PUBLIC_INPUTS],
    requirements: DisclosureGate,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let ack = &ctx.accounts.acknowledgment;

    // 0. Bind the policy to the pass: `requirements_hash` (also a PDA seed) must
    //    be the keccak of the actual requirements enforced below. A consumer
    //    derives the AccessPass PDA from the hash of ITS required policy, so a
    //    pass minted under weaker requirements lands at a different PDA.
    let computed = anchor_lang::solana_program::keccak::hashv(&[
        requirements.try_to_vec()?.as_slice()
    ])
    .0;
    require!(computed == requirements_hash, AyniError::GateMismatch);

    // 1. The disclosure must be about THIS on-chain acknowledgment.
    require!(public_inputs[I_ROOT] == ack.root, AyniError::DisclosureProofInvalid);

    // 2. Predicate gating. `ONE` is the field element 1 (a proven boolean output).
    let one = merkle::field_from_u8(1);
    if requirements.require_date_ok {
        require!(public_inputs[I_DATE_OK] == one, AyniError::PredicateNotMet);
    }
    if requirements.require_course_accredited {
        require!(public_inputs[I_COURSE_ACCREDITED] == one, AyniError::PredicateNotMet);
        require!(
            public_inputs[I_CATALOG_ROOT] == requirements.expected_catalog_root,
            AyniError::PredicateNotMet
        );
    }
    if requirements.require_teacher_recognized {
        require!(public_inputs[I_TEACHER_RECOGNIZED] == one, AyniError::PredicateNotMet);
        require!(
            public_inputs[I_TEACHER_SET_ROOT] == requirements.expected_teacher_set_root,
            AyniError::PredicateNotMet
        );
    }

    // 3. The proof itself.
    let mut verifier =
        Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYING_KEY_ACK)
            .map_err(|_| error!(AyniError::DisclosureProofInvalid))?;
    verifier
        .verify()
        .map_err(|_| error!(AyniError::DisclosureProofInvalid))?;

    // 4. Mint the access pass (init => one pass per (gate, policy, acknowledgment)).
    let pass = &mut ctx.accounts.access_pass;
    pass.acknowledgment = ack.key();
    pass.gate = gate;
    pass.requirements_hash = requirements_hash;
    pass.granted_at = Clock::get()?.unix_timestamp;
    pass.bump = ctx.bumps.access_pass;
    Ok(())
}

#[derive(Accounts)]
#[instruction(gate: [u8; 32], requirements_hash: [u8; 32])]
pub struct VerifyDisclosure<'info> {
    pub acknowledgment: Account<'info, Acknowledgment>,

    #[account(
        init,
        payer = payer,
        space = AccessPass::SPACE,
        seeds = [b"access", gate.as_ref(), requirements_hash.as_ref(), acknowledgment.key().as_ref()],
        bump
    )]
    pub access_pass: Account<'info, AccessPass>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
