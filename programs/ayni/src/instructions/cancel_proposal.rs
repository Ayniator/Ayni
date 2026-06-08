use anchor_lang::prelude::*;

use crate::council::Proposal;
use crate::errors::AyniError;
use crate::state::Circle;

/// Any single Council seat may cancel a pending proposal before it executes —
/// the contest tripwire. One honest seat is enough to halt a suspicious wallet
/// migration during its time-lock window; it must then be re-proposed. Favours
/// safety over liveness for irreversible recovery.
pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
    let circle = &ctx.accounts.circle;
    let seat = ctx.accounts.seat.key();
    circle
        .council
        .seat_of(&seat)
        .ok_or(error!(AyniError::NotCouncilSeat))?;

    let proposal = &mut ctx.accounts.proposal;
    require!(!proposal.executed, AyniError::AlreadyExecuted);
    require!(!proposal.cancelled, AyniError::ProposalCancelled);
    proposal.cancelled = true;
    Ok(())
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    pub seat: Signer<'info>,
}
