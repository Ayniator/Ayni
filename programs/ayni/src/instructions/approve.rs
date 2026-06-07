use anchor_lang::prelude::*;

use crate::council::Proposal;
use crate::errors::AyniError;
use crate::state::Circle;

/// A Council seat adds its approval to a pending proposal. Each seat may approve
/// once (enforced by the approvals bitmask).
pub fn approve(ctx: Context<Approve>) -> Result<()> {
    let circle = &ctx.accounts.circle;
    let seat = ctx.accounts.seat.key();
    let index = circle
        .council
        .seat_of(&seat)
        .ok_or(error!(AyniError::NotCouncilSeat))?;

    let proposal = &mut ctx.accounts.proposal;
    require!(!proposal.executed, AyniError::AlreadyExecuted);
    proposal.add_approval(index)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Approve<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    pub seat: Signer<'info>,
}
