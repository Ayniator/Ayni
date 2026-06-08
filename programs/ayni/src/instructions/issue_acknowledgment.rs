use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Acknowledgment, Circle, Lineage, Membership, Nullifier};
use crate::verifying_key::VERIFYING_KEY;

/// Issue an acknowledgment credential to a member, attested by an *anonymous*
/// lineage teacher.
///
/// Reuses the lineage circuit/verifying key: the teacher proves they hold a
/// lineage credential of level >= `attest_level`, binding the acknowledgment
/// `root` in the `granteeCommitment` slot. Thus the public-input layout is the
/// same as `grant_level`: [nullifier, lineage.root, attest_level, ack_root].
/// Unlike `grant_level`, this does NOT grow the lineage tree or change levels —
/// it only records the attested credential root.
pub fn issue_acknowledgment(
    ctx: Context<IssueAcknowledgment>,
    ack_root: [u8; 32],
    member_commitment: [u8; 32],
    attest_level: u8,
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let lineage = &ctx.accounts.lineage;

    // Same public-signal order as the lineage circuit (outputs first):
    // [nullifier, root, grantedLevel(=attest_level), granteeCommitment(=ack_root)].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        lineage.root,
        merkle::field_from_u8(attest_level),
        ack_root,
    ];

    let mut verifier =
        Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYING_KEY)
            .map_err(|_| error!(AyniError::InvalidLineageProof))?;
    verifier
        .verify()
        .map_err(|_| error!(AyniError::InvalidLineageProof))?;

    // `ack_nullifier` is created with `init`, so a replayed proof fails here.

    let clock = Clock::get()?;
    let ack = &mut ctx.accounts.acknowledgment;
    ack.circle = ctx.accounts.circle.key();
    ack.member_commitment = member_commitment;
    ack.root = ack_root;
    ack.attest_level = attest_level;
    ack.issued_at = clock.unix_timestamp;
    ack.issuer_attested = true;
    ack.bump = ctx.bumps.acknowledgment;
    Ok(())
}

#[derive(Accounts)]
#[instruction(ack_root: [u8; 32], member_commitment: [u8; 32], attest_level: u8, nullifier: [u8; 32])]
pub struct IssueAcknowledgment<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle, seeds = [b"lineage", circle.key().as_ref()], bump = lineage.bump)]
    pub lineage: Account<'info, Lineage>,

    /// Binds the credential to an existing member of this circle.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), member_commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Account<'info, Membership>,

    #[account(
        init,
        payer = payer,
        space = Acknowledgment::SPACE,
        seeds = [b"ack", circle.key().as_ref(), ack_root.as_ref()],
        bump
    )]
    pub acknowledgment: Account<'info, Acknowledgment>,

    /// Spent-nullifier marker (distinct namespace from level-grant nullifiers).
    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"ack_nullifier", lineage.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub ack_nullifier: Account<'info, Nullifier>,

    /// A relayer pays so the attesting teacher's wallet never touches the chain.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
