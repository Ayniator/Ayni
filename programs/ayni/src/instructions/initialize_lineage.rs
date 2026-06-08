use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, Lineage};

/// Create a Circle's lineage tree and seat the World Service genesis credential
/// at the root of authority (typically the highest level, e.g. 255).
pub fn initialize_lineage(
    ctx: Context<InitializeLineage>,
    depth: u8,
    genesis_commitment: [u8; 32],
    genesis_level: u8,
) -> Result<()> {
    // Must match the lineage_grant circuit's compiled depth, or proofs fail.
    require!(depth == merkle::CIRCUIT_DEPTH, AyniError::DepthTooLarge);

    let lineage = &mut ctx.accounts.lineage;
    lineage.circle = ctx.accounts.circle.key();
    lineage.bump = ctx.bumps.lineage;
    merkle::init_empty(lineage, depth)?;

    // Seat the genesis credential: H(genesis_commitment, level) at leaf 0.
    let leaf = merkle::poseidon2(&genesis_commitment, &merkle::field_from_u8(genesis_level))?;
    merkle::insert(lineage, leaf)?;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeLineage<'info> {
    #[account(has_one = authority)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = Lineage::SPACE,
        seeds = [b"lineage", circle.key().as_ref()],
        bump
    )]
    pub lineage: Account<'info, Lineage>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
