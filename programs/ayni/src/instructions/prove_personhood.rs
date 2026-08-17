use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::merkle;
use crate::state::{Circle, PersonhoodCredential};

/// Anonymous proof-of-personhood (World ID-style), minting a one-time
/// `PersonhoodCredential` for a Circle. Reuses the member-vote circuit/VK: the
/// human proves their commitment is in the Circle's `personhood_root`, with the
/// Circle-scoped external nullifier `field_from_pubkey(circle)`. The nullifier
/// PDA makes the credential unique per human per Circle; `issue_membership` then
/// consumes it — one human, one membership. Identity is never revealed; a relayer
/// pays so the human's wallet is not linked.
pub fn prove_personhood(
    ctx: Context<ProvePersonhood>,
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let circle = &ctx.accounts.circle;

    // [nullifier, root, proposalId(=circle external nullifier), choice(=1)].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        circle.personhood_root,
        merkle::field_from_pubkey(&circle.key()),
        merkle::field_from_u8(1),
    ];

    verify_anchored_proof(
        ProofKind::MemberVote,
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        AyniError::VoteProofInvalid,
    )?;

    let cred = &mut ctx.accounts.personhood;
    cred.circle = circle.key();
    cred.used = false;
    cred.bump = ctx.bumps.personhood;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct ProvePersonhood<'info> {
    pub circle: Account<'info, Circle>,

    /// Unique per human per Circle (seeded by the personhood nullifier) — `init`
    /// fails on a second attempt by the same human.
    #[account(
        init,
        payer = payer,
        space = PersonhoodCredential::SPACE,
        seeds = [b"personhood", circle.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub personhood: Account<'info, PersonhoodCredential>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
