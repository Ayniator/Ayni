use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, MemberProposal, MemberTree};

/// Open a group-conscience proposal for the whole membership to vote on (an idea
/// or a material/documentation change). A Council seat records it (the agenda
/// item raised at a meeting), snapshotting the eligible voter set so the roll
/// can't shift mid-vote. The text lives off-chain; `description_hash` commits to it.
pub fn create_member_proposal(
    ctx: Context<CreateMemberProposal>,
    nonce: u64,
    description_hash: [u8; 32],
    voting_period: i64,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require!(
        circle.council.seat_of(&ctx.accounts.proposer.key()).is_some(),
        AyniError::NotCouncilSeat
    );

    let mt = &ctx.accounts.member_tree;
    let p = &mut ctx.accounts.proposal;
    p.circle = circle.key();
    p.nonce = nonce;
    p.description_hash = description_hash;
    p.member_root = mt.root; // snapshot of the eligible voter set
    p.eligible_count = mt.next_index;
    p.yes = 0;
    p.no = 0;
    p.deadline = Clock::get()?.unix_timestamp + voting_period;
    p.finalized = false;
    p.passed = false;
    p.bump = ctx.bumps.proposal;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateMemberProposal<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle, seeds = [b"members", circle.key().as_ref()], bump = member_tree.bump)]
    pub member_tree: Account<'info, MemberTree>,

    #[account(
        init,
        payer = proposer,
        space = MemberProposal::SPACE,
        seeds = [b"mproposal", circle.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, MemberProposal>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
