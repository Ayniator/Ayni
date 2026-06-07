use anchor_lang::prelude::*;

use crate::council::{ProposalAction, Proposal, COUNCIL_SEATS};
use crate::errors::AyniError;
use crate::state::Circle;

/// A Council seat opens a proposal (seat rotation or wallet migration). The
/// proposer's own approval is recorded immediately.
pub fn propose(ctx: Context<Propose>, nonce: u64, action: ProposalAction) -> Result<()> {
    let circle = &ctx.accounts.circle;
    let seat = ctx.accounts.proposer.key();
    let index = circle
        .council
        .seat_of(&seat)
        .ok_or(error!(AyniError::NotCouncilSeat))?;

    if let ProposalAction::RotateSeat { seat_index, .. } = &action {
        require!((*seat_index as usize) < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
    }

    let proposal = &mut ctx.accounts.proposal;
    proposal.circle = circle.key();
    proposal.nonce = nonce;
    proposal.action = action;
    proposal.approvals = 0;
    proposal.executed = false;
    proposal.created_at = Clock::get()?.unix_timestamp;
    proposal.bump = ctx.bumps.proposal;
    proposal.add_approval(index)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Propose<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = proposer,
        space = Proposal::SPACE,
        seeds = [b"proposal", circle.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
