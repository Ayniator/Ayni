use anchor_lang::prelude::*;

use crate::state::{Circle, MemberTree, RecentRoots};

/// F54a — permissionless crank: record the MemberTree's CURRENT root into the
/// Circle's recent-roots ring buffer. A prover runs this right before proving,
/// so the root they prove against stays acceptable even if an admission lands
/// while their proof is in flight (the defect this fixes: verification against
/// a single live root meant any concurrent insertion invalidated every
/// in-flight proof). Copies verified on-chain state only, so anyone may crank
/// it — there is nothing to forge.
pub fn note_root(ctx: Context<NoteRoot>) -> Result<()> {
    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.recent_roots;
    let rr = &mut ctx.accounts.recent_roots;
    if rr.circle == Pubkey::default() {
        // Freshly created by init_if_needed — bind it.
        rr.circle = circle_key;
        rr.epoch = 0;
        rr.epoch_started_at = 0;
        rr.index = 0;
        rr.bump = bump;
    }
    rr.push(ctx.accounts.member_tree.root);
    Ok(())
}

#[derive(Accounts)]
pub struct NoteRoot<'info> {
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    #[account(
        init_if_needed,
        payer = caller,
        space = RecentRoots::SPACE,
        seeds = [b"roots", circle.key().as_ref()],
        bump
    )]
    pub recent_roots: Box<Account<'info, RecentRoots>>,

    /// Anyone (pays the one-time PDA rent on first crank; a relayer may pay so
    /// the prover-to-be is not named by the crank either).
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
