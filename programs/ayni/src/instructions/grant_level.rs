use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::merkle;
use crate::state::{Circle, Lineage, LevelGrant, Membership, Nullifier};

/// Grant a shamanic level to a student along an anonymous, ZK-verified lineage.
///
/// The Groth16 proof attests that some hidden credential in the lineage tree,
/// of level >= `granted_level`, authorized this grant — without revealing the
/// granter. See docs/zk-lineage.md.
pub fn grant_level(
    ctx: Context<GrantLevel>,
    granted_level: u8,
    grantee_commitment: [u8; 32],
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let lineage = &mut ctx.accounts.lineage;
    let membership = &mut ctx.accounts.membership;

    require!(granted_level > membership.level, AyniError::NonIncreasingLevel);

    // Public-signal order must match the circuit: outputs first, then inputs:
    // [nullifier, root, grantedLevel, granteeCommitment].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        lineage.root,
        merkle::field_from_u8(granted_level),
        grantee_commitment,
    ];

    verify_anchored_proof(
        ProofKind::LineageGrant,
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        AyniError::InvalidLineageProof,
    )?;

    // The `nullifier_record` account is created with `init` in the context, so a
    // replayed nullifier makes the transaction fail before reaching here.

    // Append the student's new credential so they can grant in turn; this grows
    // the lineage and updates the on-chain root.
    let leaf = merkle::poseidon2(&grantee_commitment, &merkle::field_from_u8(granted_level))?;
    merkle::insert(lineage, leaf)?;

    let clock = Clock::get()?;
    let grant = &mut ctx.accounts.level_grant;
    grant.membership = membership.key();
    grant.level = granted_level;
    grant.issuer_commitment = nullifier; // anonymous handle for this grant
    grant.granted_at = clock.unix_timestamp;
    grant.bump = ctx.bumps.level_grant;

    membership.level = granted_level;
    Ok(())
}

#[derive(Accounts)]
#[instruction(granted_level: u8, grantee_commitment: [u8; 32], nullifier: [u8; 32])]
pub struct GrantLevel<'info> {
    // Boxed (heap) to keep `try_accounts` within the 4KB BPF stack frame —
    // Lineage/Circle are large (filled_subtrees, 7-seat Council).
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"lineage", circle.key().as_ref()],
        bump = lineage.bump,
    )]
    pub lineage: Box<Account<'info, Lineage>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), grantee_commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Box<Account<'info, Membership>>,

    /// Spent-nullifier marker. `init` fails if it already exists → replay-proof.
    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"nullifier", lineage.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub nullifier_record: Account<'info, Nullifier>,

    #[account(
        init,
        payer = payer,
        space = LevelGrant::SPACE,
        seeds = [b"level", membership.key().as_ref(), &[granted_level]],
        bump
    )]
    pub level_grant: Account<'info, LevelGrant>,

    /// A relayer pays so the granting shaman's wallet never touches the chain,
    /// preserving issuer anonymity (docs/zk-lineage.md — metadata caveat).
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
