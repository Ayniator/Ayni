use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{ChildSeatVote, Circle};

/// Another foundation seat approves a pending child-rotation vote (each seat
/// once, before the validity deadline).
pub fn approve_child_rotation(ctx: Context<ApproveChildRotation>) -> Result<()> {
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
pub struct ApproveChildRotation<'info> {
    pub foundation: Account<'info, Circle>,

    #[account(mut, has_one = foundation)]
    pub vote: Account<'info, ChildSeatVote>,

    pub seat: Signer<'info>,
}
