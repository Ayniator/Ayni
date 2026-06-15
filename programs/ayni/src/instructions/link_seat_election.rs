use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::council::COUNCIL_SEATS;
use crate::errors::AyniError;
use crate::state::{Circle, MemberProposal, SeatElection};

/// Canonical election commitment: H("AHA-elect" || seat_index || candidate).
/// The member proposal must carry this as its `description_hash`, so members are
/// provably voting on exactly this (seat, candidate) pair.
pub fn election_hash(seat_index: u8, candidate: &Pubkey) -> [u8; 32] {
    hashv(&[b"AHA-elect", &[seat_index], candidate.as_ref()]).to_bytes()
}

/// Mark an existing member proposal as a seat election. Permissionless: the hash
/// binding (the proposal's `description_hash` must equal `election_hash`) is what
/// makes it trustless — only the (seat_index, candidate) the proposal committed
/// to can be linked. PDA: ["election", proposal].
pub fn link_seat_election(ctx: Context<LinkSeatElection>, seat_index: u8, candidate: Pubkey) -> Result<()> {
    require!((seat_index as usize) < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
    require!(
        ctx.accounts.proposal.description_hash == election_hash(seat_index, &candidate),
        AyniError::Unauthorized
    );
    let e = &mut ctx.accounts.election;
    e.circle = ctx.accounts.circle.key();
    e.proposal = ctx.accounts.proposal.key();
    e.seat_index = seat_index;
    e.candidate = candidate;
    e.installed = false;
    e.bump = ctx.bumps.election;
    Ok(())
}

#[derive(Accounts)]
pub struct LinkSeatElection<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle)]
    pub proposal: Account<'info, MemberProposal>,

    #[account(
        init,
        payer = payer,
        space = SeatElection::SPACE,
        seeds = [b"election", proposal.key().as_ref()],
        bump
    )]
    pub election: Account<'info, SeatElection>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
