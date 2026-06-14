use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{ChildCloseVote, Circle};

const MIN_VALIDITY: i64 = 24 * 60 * 60;
const MAX_VALIDITY: i64 = 90 * 24 * 60 * 60;

/// A foundation seat opens a 4-of-7 vote to DELETE (close) a federation Circle,
/// valid `validity_secs` (1–90 days). The proposer's approval is recorded.
pub fn propose_child_close(ctx: Context<ProposeChildClose>, _nonce: u64, validity_secs: i64) -> Result<()> {
    require!(
        validity_secs >= MIN_VALIDITY && validity_secs <= MAX_VALIDITY,
        AyniError::InvalidVotingPeriod
    );
    let f = &ctx.accounts.foundation;
    let idx = f
        .council
        .seat_of(&ctx.accounts.proposer.key())
        .ok_or(error!(AyniError::NotCouncilSeat))?;
    // The foundation (the World Service root) may close any Circle in its
    // federation EXCEPT itself. Refusing `child == foundation` is what makes the
    // root permanently un-deletable on-chain — "the root of all circles" stands.
    require!(ctx.accounts.child.key() != f.key(), AyniError::Unauthorized);

    let now = Clock::get()?.unix_timestamp;
    let v = &mut ctx.accounts.vote;
    v.foundation = f.key();
    v.child = ctx.accounts.child.key();
    v.nonce = _nonce;
    v.approvals = 1u8 << idx;
    v.created_at = now;
    v.expires_at = now + validity_secs;
    v.executed = false;
    v.bump = ctx.bumps.vote;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ProposeChildClose<'info> {
    pub foundation: Account<'info, Circle>,
    pub child: Account<'info, Circle>,

    #[account(
        init,
        payer = proposer,
        space = ChildCloseVote::SPACE,
        seeds = [b"childclose", child.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub vote: Account<'info, ChildCloseVote>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
