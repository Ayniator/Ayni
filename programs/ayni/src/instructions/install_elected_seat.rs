use anchor_lang::prelude::*;

use crate::council::COUNCIL_SEATS;
use crate::errors::AyniError;
use crate::state::{Circle, MemberProposal, SeatElection};

/// Install the winner of a passed seat election into the Council. Permissionless
/// once the linked member proposal has finalized as passed (the group already
/// decided). One-shot, and the candidate must not already hold another seat.
pub fn install_elected_seat(ctx: Context<InstallElectedSeat>) -> Result<()> {
    let e = &mut ctx.accounts.election;
    require!(!e.installed, AyniError::AlreadyExecuted);
    require!(e.proposal == ctx.accounts.proposal.key(), AyniError::Unauthorized);

    let p = &ctx.accounts.proposal;
    require!(p.finalized, AyniError::VotingNotEnded);
    require!(p.passed, AyniError::ThresholdNotMet);

    let idx = e.seat_index as usize;
    require!(idx < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
    require!(e.candidate != Pubkey::default(), AyniError::InvalidSeatIndex);

    let council = &mut ctx.accounts.circle.council;
    // Uniqueness: no wallet may hold two seats.
    for (i, s) in council.seats.iter().enumerate() {
        if i != idx {
            require!(*s != e.candidate, AyniError::DuplicateSeat);
        }
    }
    council.seats[idx] = e.candidate;
    e.installed = true;
    Ok(())
}

#[derive(Accounts)]
pub struct InstallElectedSeat<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle, constraint = proposal.key() == election.proposal @ AyniError::Unauthorized)]
    pub proposal: Account<'info, MemberProposal>,

    #[account(mut, has_one = circle)]
    pub election: Account<'info, SeatElection>,

    pub caller: Signer<'info>,
}
