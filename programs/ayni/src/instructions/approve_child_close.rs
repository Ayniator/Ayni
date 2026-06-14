use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{ChildCloseVote, Circle};

/// Another foundation seat approves a pending delete-Circle vote.
pub fn approve_child_close(ctx: Context<ApproveChildClose>) -> Result<()> {
    let idx = ctx
        .accounts
        .foundation
        .council
        .seat_of(&ctx.accounts.seat.key())
        .ok_or(error!(AyniError::NotCouncilSeat))?;
    let v = &mut ctx.accounts.vote;
    require!(!v.executed, AyniError::AlreadyExecuted);
    require!(Clock::get()?.unix_timestamp < v.expires_at, AyniError::VotingClosed);
    let bit = 1u8 << idx;
    require!(v.approvals & bit == 0, AyniError::AlreadyApproved);
    v.approvals |= bit;
    Ok(())
}

#[derive(Accounts)]
pub struct ApproveChildClose<'info> {
    pub foundation: Account<'info, Circle>,
    #[account(mut, has_one = foundation)]
    pub vote: Account<'info, ChildCloseVote>,
    pub seat: Signer<'info>,
}
