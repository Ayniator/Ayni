use anchor_lang::prelude::*;

use crate::council::COUNCIL_SEATS;
use crate::errors::AyniError;
use crate::state::{ChildSeatVote, Circle};

const MIN_VALIDITY: i64 = 24 * 60 * 60; // 1 day
const MAX_VALIDITY: i64 = 90 * 24 * 60 * 60; // 90 days

/// A foundation seat opens a vote to rotate a CHILD Circle's 7 seats. The vote
/// runs among the FOUNDATION's Council (4-of-7) and is valid for `validity_secs`
/// (1–90 days). The proposer's own approval is recorded immediately.
pub fn propose_child_rotation(
    ctx: Context<ProposeChildRotation>,
    _nonce: u64,
    new_seats: [Pubkey; COUNCIL_SEATS],
    validity_secs: i64,
) -> Result<()> {
    require!(
        validity_secs >= MIN_VALIDITY && validity_secs <= MAX_VALIDITY,
        AyniError::InvalidVotingPeriod
    );

    let foundation = &ctx.accounts.foundation;
    // Proposer must hold a seat in the foundation.
    let idx = foundation
        .council
        .seat_of(&ctx.accounts.proposer.key())
        .ok_or(error!(AyniError::NotCouncilSeat))?;

    // The foundation (the World Service root) governs its whole federation and
    // may rotate any Circle's seats — EXCEPT itself. Refusing `child == foundation`
    // is what makes the root permanently un-rotatable/un-deletable on-chain.
    require!(ctx.accounts.child.key() != foundation.key(), AyniError::Unauthorized);

    // New seat set: every seat filled and distinct.
    for i in 0..COUNCIL_SEATS {
        require!(new_seats[i] != Pubkey::default(), AyniError::InvalidSeatIndex);
        for j in (i + 1)..COUNCIL_SEATS {
            require!(new_seats[i] != new_seats[j], AyniError::DuplicateSeat);
        }
    }

    let now = Clock::get()?.unix_timestamp;
    let v = &mut ctx.accounts.vote;
    v.foundation = foundation.key();
    v.child = ctx.accounts.child.key();
    v.nonce = _nonce;
    v.new_seats = new_seats;
    v.approvals = 1u8 << idx; // proposer approves
    v.created_at = now;
    v.expires_at = now + validity_secs;
    v.executed = false;
    v.bump = ctx.bumps.vote;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ProposeChildRotation<'info> {
    pub foundation: Account<'info, Circle>,

    /// The target Circle. It MUST be a direct child of `foundation`
    /// (`child.parent == foundation`) — enforced here, not just documented.
    /// Without it, a caller-supplied `foundation` they seat 4-of-7 themselves
    /// could rotate ANY Circle's Council. `parent` is immutable after creation.
    #[account(constraint = child.parent == foundation.key() @ AyniError::Unauthorized)]
    pub child: Account<'info, Circle>,

    #[account(
        init,
        payer = proposer,
        space = ChildSeatVote::SPACE,
        seeds = [b"childvote", child.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub vote: Account<'info, ChildSeatVote>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
