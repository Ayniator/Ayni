use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{LevelGrant, Membership};

pub fn grant_level(
    ctx: Context<GrantLevel>,
    level: u8,
    issuer_commitment: [u8; 32],
    lineage_proof: Vec<u8>,
) -> Result<()> {
    let membership = &mut ctx.accounts.membership;
    require!(level > membership.level, AyniError::NonIncreasingLevel);

    // TODO(ayni): verify `lineage_proof` in zero-knowledge — that
    // `issuer_commitment` belongs to a member holding level >= `level`, whose
    // own grant chains back to the World Service root lineage, WITHOUT revealing
    // the issuer's identity. Verify a Groth16 proof via the alt_bn128 syscalls
    // (e.g. groth16-solana / Light Protocol). The placeholder below only checks
    // that *some* proof was supplied.
    require!(!lineage_proof.is_empty(), AyniError::InvalidLineageProof);

    let clock = Clock::get()?;
    let grant = &mut ctx.accounts.level_grant;
    grant.membership = membership.key();
    grant.level = level;
    grant.issuer_commitment = issuer_commitment;
    grant.granted_at = clock.unix_timestamp;
    grant.bump = ctx.bumps.level_grant;

    membership.level = level;
    Ok(())
}

#[derive(Accounts)]
#[instruction(level: u8)]
pub struct GrantLevel<'info> {
    #[account(mut)]
    pub membership: Account<'info, Membership>,

    #[account(
        init,
        payer = payer,
        space = LevelGrant::SPACE,
        seeds = [b"level", membership.key().as_ref(), &[level]],
        bump
    )]
    pub level_grant: Account<'info, LevelGrant>,

    /// A relayer pays so the granting shaman's wallet never touches the chain,
    /// preserving issuer anonymity (see IMPLEMENTATION.md — metadata caveat).
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
