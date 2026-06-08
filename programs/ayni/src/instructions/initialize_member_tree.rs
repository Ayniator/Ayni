use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, MemberTree};

/// Create a Circle's member-set tree (the votable population). Members are
/// inserted at `issue_membership`. Run once, after `initialize_circle`.
pub fn initialize_member_tree(ctx: Context<InitializeMemberTree>, depth: u8) -> Result<()> {
    // Must match the member_vote circuit's compiled depth, or vote proofs fail.
    require!(depth == merkle::CIRCUIT_DEPTH, AyniError::DepthTooLarge);
    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.member_tree;
    let t: &mut MemberTree = &mut ctx.accounts.member_tree;
    t.circle = circle_key;
    t.depth = depth;
    t.bump = bump;
    merkle::init_tree(depth, &mut t.next_index, &mut t.root, &mut t.filled_subtrees)
}

#[derive(Accounts)]
pub struct InitializeMemberTree<'info> {
    #[account(has_one = authority)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = MemberTree::SPACE,
        seeds = [b"members", circle.key().as_ref()],
        bump
    )]
    pub member_tree: Account<'info, MemberTree>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
